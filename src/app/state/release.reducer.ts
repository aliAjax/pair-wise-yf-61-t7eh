import { createReducer, on } from '@ngrx/store';
import { canApprove, canCreate, canPause, canResume, canRollback } from './release.models';
import type { AuditEntry, DeviceGroup, DeviceModel, DeviceReceipt, ReceiptKind, ReleaseBatch, ReleaseState, SubmitConflict } from './release.models';
import { approveBatch, createBatch, dismissConflict, dismissReceipt, pauseBatch, reportReceipt, resumeBatch, retryReceipt, setActor, simulateExternalSubmit, startRollback, submitBatch, telemetryTick, updateModelList } from './release.actions';

function seedDevices(groupId: string): string[] {
  return Array.from({ length: 10 }, (_, i) => `dev-${groupId}-${String(i + 1).padStart(3, '0')}`);
}

const initialGroups: DeviceGroup[] = [
  { id: 'g-edge', name: '华东边缘网关', region: '华东', count: 680, compatible: true, offlineGateways: 4 },
  { id: 'g-plant', name: '工业采集终端', region: '华南', count: 1240, compatible: false, offlineGateways: 12 },
  { id: 'g-clinic', name: '远程诊疗终端', region: '新加坡', count: 310, compatible: true, offlineGateways: 2 }
];

const initialModels: DeviceModel[] = [
  { id: 'm-edge-x1', name: '边缘网关 X1', region: '华东', groupId: 'g-edge', planned: 420, installed: 380, delivered: 30 },
  { id: 'm-edge-x2', name: '边缘网关 X2', region: '华东', groupId: 'g-edge', planned: 260, installed: 0, delivered: 0 },
  { id: 'm-plant-p1', name: '采集终端 P1', region: '华南', groupId: 'g-plant', planned: 800, installed: 0, delivered: 0 },
  { id: 'm-plant-p2', name: '采集终端 P2', region: '华南', groupId: 'g-plant', planned: 440, installed: 0, delivered: 0 },
  { id: 'm-clinic-c1', name: '诊疗终端 C1', region: '新加坡', groupId: 'g-clinic', planned: 310, installed: 0, delivered: 0 }
];

const initialCapacities = [
  { region: '华东', capacityPerTick: 18 },
  { region: '华南', capacityPerTick: 12 },
  { region: '新加坡', capacityPerTick: 8 }
];

const now = new Date().toISOString();
const initialBatches: ReleaseBatch[] = [
  { id: 'batch-demo', name: '边缘网关安全补丁 2.8.1', firmware: '2.8.1', rollbackVersion: '2.7.9', groupId: 'g-edge', region: '华东', rolloutPercent: 20, failureThreshold: 5, status: 'approved', priority: 10, progress: 0, downloaded: 0, failed: 0, queued: 0, version: 1, devices: seedDevices('g-edge'), lastChangedDevices: [], updatedAt: now }
];

const initialAudits: AuditEntry[] = [
  { id: 'audit-1', at: now, actor: '发布负责人', message: '批次 batch-demo 完成兼容性检查并进入已审批' }
];

const initialActor = { role: 'owner' as const, region: '华东', name: '发布负责人' };

const STORAGE_KEY = 'firmware-release-v2';
const fallback: ReleaseState = { groups: initialGroups, batches: initialBatches, receipts: [], models: initialModels, capacities: initialCapacities, actor: initialActor, conflicts: [], audits: initialAudits };

function audit(audits: AuditEntry[], actor: string, message: string): AuditEntry[] {
  return [{ id: crypto.randomUUID(), at: new Date().toISOString(), actor, message }, ...audits];
}

/**
 * 设备回执处理：
 * - 同批次同设备同类型的重复回执只算一次
 * - 已停批次（暂停/回滚）的回执退回待核对
 * - 失败回执计入批次失败数
 */
function applyReceipt(receipts: DeviceReceipt[], batch: ReleaseBatch, receipt: DeviceReceipt): { receipts: DeviceReceipt[]; duplicate: boolean } {
  const dup = receipts.some((r) => r.batchId === receipt.batchId && r.deviceId === receipt.deviceId && r.kind === receipt.kind && r.status !== 'pending_verification');
  if (dup) return { receipts, duplicate: true };
  if (batch.status === 'paused' || batch.status === 'rolled_back') {
    return { receipts: [{ ...receipt, status: 'pending_verification' }, ...receipts], duplicate: false };
  }
  if (receipt.kind === 'failed') batch.failed += 1;
  return { receipts: [{ ...receipt, status: 'counted' }, ...receipts], duplicate: false };
}

/** 区域下发容量分配：紧急回滚批次优先，其余批次按优先级重排，超出容量的设备排队 */
function allocateCapacity(state: ReleaseState, batches: ReleaseBatch[]): { batches: ReleaseBatch[]; receipts: DeviceReceipt[]; audits: AuditEntry[] } {
  const now = new Date().toISOString();
  let receipts = [...state.receipts];
  let audits = state.audits;

  for (const cap of state.capacities) {
    const group = state.groups.find((g) => g.region === cap.region);
    const regionBatches = batches
      .filter((b) => b.region === cap.region && ['approved', 'queued', 'running', 'rollback'].includes(b.status))
      .sort((a, b) => a.priority - b.priority || a.updatedAt.localeCompare(b.updatedAt));
    let remaining = cap.capacityPerTick;
    for (const b of regionBatches) {
      const target = Math.round((group?.count ?? 0) * b.rolloutPercent / 100);
      const need = Math.max(0, target - b.downloaded);
      const alloc = Math.min(need, remaining);
      remaining -= alloc;
      b.downloaded += alloc;
      b.queued = need - alloc;
      if (need > 0) {
        if (alloc > 0) b.status = b.status === 'rollback' ? 'rollback' : 'running';
        else b.status = b.status === 'rollback' ? 'rollback' : 'queued';
      }
      b.progress = target ? Math.round(b.downloaded / target * 100) : 0;

      // 弱网补报：为已下发设备生成回执，可能重复、可能失败
      if (b.downloaded > 0) {
        const reportCount = b.status === 'rollback' ? 2 : 3;
        for (let i = 0; i < reportCount; i += 1) {
          const deviceId = b.devices[Math.floor(Math.random() * b.devices.length)];
          const roll = Math.random();
          const kind: ReceiptKind = roll < 0.12 ? 'failed' : roll < 0.72 ? 'downloaded' : 'installed';
          const receipt: DeviceReceipt = { id: crypto.randomUUID(), batchId: b.id, deviceId, region: b.region, kind, status: 'counted', retryCount: 0, reportedAt: now };
          const result = applyReceipt(receipts, b, receipt);
          receipts = result.receipts;
          if (result.duplicate) {
            audits = audit(audits, '系统', `批次 ${b.name} 设备 ${deviceId} 重复回执已忽略`);
          } else if (result.receipts[0]?.status === 'pending_verification') {
            audits = audit(audits, '系统', `批次 ${b.name} 已停止，设备 ${deviceId} 回执退回待核对`);
          }
        }
      }

      const failureRate = b.downloaded ? b.failed / b.downloaded * 100 : 0;
      if (b.status === 'running' && failureRate > b.failureThreshold) {
        b.status = 'paused';
        audits = audit(audits, '系统', `批次 ${b.name} 失败率 ${failureRate.toFixed(1)}% 超过阈值 ${b.failureThreshold}%，已自动暂停`);
      }
      if (target > 0 && b.downloaded >= target) {
        if (b.status === 'rollback') {
          b.status = 'rolled_back';
          b.queued = 0;
          audits = audit(audits, '系统', `批次 ${b.name} 紧急回滚完成`);
        } else if (b.status === 'running') {
          b.status = 'completed';
          b.queued = 0;
        }
      }
    }
  }
  return { batches, receipts, audits };
}

function normalize(raw: unknown): ReleaseState {
  if (!raw || typeof raw !== 'object') return fallback;
  const s = raw as Partial<ReleaseState>;
  return {
    groups: s.groups?.length ? s.groups : fallback.groups,
    batches: s.batches?.length
      ? s.batches.map((b) => ({
          ...b,
          region: b.region ?? fallback.groups.find((g) => g.id === b.groupId)?.region ?? '华东',
          priority: b.priority ?? 10,
          queued: b.queued ?? 0,
          version: b.version ?? 1,
          devices: b.devices?.length ? b.devices : seedDevices(b.groupId),
          lastChangedDevices: b.lastChangedDevices ?? []
        }))
      : fallback.batches,
    receipts: s.receipts ?? [],
    models: s.models?.length ? s.models : fallback.models,
    capacities: s.capacities?.length ? s.capacities : fallback.capacities,
    actor: s.actor ?? fallback.actor,
    conflicts: s.conflicts ?? [],
    audits: s.audits?.length ? s.audits : fallback.audits
  };
}

const stored = typeof localStorage === 'undefined' ? null : (JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as unknown);
const initialState = normalize(stored);

export const releaseReducer = createReducer(
  initialState,
  on(setActor, (state, { actor }) => ({
    ...state,
    actor,
    audits: audit(state.audits, actor.name, `切换身份：${actor.role === 'owner' ? '发布负责人（全部区域）' : actor.role === 'regional_ops' ? `区域运维（${actor.region}）` : '值班人员（仅暂停）'}`)
  })),
  on(createBatch, (state, { batch }) => {
    if (!canCreate(state.actor, batch.region)) {
      return { ...state, audits: audit(state.audits, state.actor.name, `越权拒绝：${state.actor.role === 'operator' ? '值班人员不能创建批次' : `区域运维只能创建本区（${state.actor.region}）批次`}`) };
    }
    return { ...state, batches: [batch, ...state.batches], audits: audit(state.audits, state.actor.name, `创建批次 ${batch.name}`) };
  }),
  on(approveBatch, (state, { id, actor }) => {
    const batch = state.batches.find((b) => b.id === id);
    if (!batch) return state;
    if (!canApprove(actor, batch)) {
      return { ...state, audits: audit(state.audits, actor.name, `越权拒绝：批次 ${batch.name} 审批未授权${actor.role === 'operator' ? '（值班人员无审批权）' : '（仅可审批本区批次）'}`) };
    }
    return { ...state, batches: state.batches.map((b) => (b.id === id ? { ...b, status: 'approved', updatedAt: new Date().toISOString() } : b)), audits: audit(state.audits, actor.name, `批次 ${batch.name} 审批通过`) };
  }),
  on(pauseBatch, (state, { id, actor }) => {
    const batch = state.batches.find((b) => b.id === id);
    if (!batch) return state;
    if (!canPause(actor, batch)) {
      return { ...state, audits: audit(state.audits, actor.name, `越权拒绝：批次 ${batch.name} 暂停未授权（仅可暂停本区批次）`) };
    }
    return { ...state, batches: state.batches.map((b) => (b.id === id ? { ...b, status: 'paused', updatedAt: new Date().toISOString() } : b)), audits: audit(state.audits, actor.name, `批次 ${batch.name} 已暂停`) };
  }),
  on(resumeBatch, (state, { id, actor }) => {
    const batch = state.batches.find((b) => b.id === id);
    if (!batch) return state;
    if (!canResume(actor, batch)) {
      return { ...state, audits: audit(state.audits, actor.name, `越权拒绝：批次 ${batch.name} 恢复未授权${actor.role === 'operator' ? '（值班人员无恢复权）' : '（仅可恢复本区批次）'}`) };
    }
    return { ...state, batches: state.batches.map((b) => (b.id === id ? { ...b, status: 'running', updatedAt: new Date().toISOString() } : b)), audits: audit(state.audits, actor.name, `批次 ${batch.name} 恢复发布`) };
  }),
  on(startRollback, (state, { id, actor }) => {
    const batch = state.batches.find((b) => b.id === id);
    if (!batch) return state;
    if (!canRollback(actor, batch)) {
      return { ...state, audits: audit(state.audits, actor.name, `越权拒绝：批次 ${batch.name} 跨区紧急回滚需发布负责人执行`) };
    }
    // 紧急回滚立刻插队：回滚批次优先级置 0，同区其他在途批次未下发设备全部重排
    const batches = state.batches.map((b) => {
      if (b.id === id) return { ...b, status: 'rollback' as const, priority: 0, updatedAt: new Date().toISOString() };
      if (b.region === batch.region && (b.status === 'running' || b.status === 'queued' || b.status === 'approved')) {
        const group = state.groups.find((g) => g.id === b.groupId);
        const target = Math.round((group?.count ?? 0) * b.rolloutPercent / 100);
        return { ...b, queued: Math.max(0, target - b.downloaded) };
      }
      return b;
    });
    return { ...state, batches, audits: audit(state.audits, actor.name, `批次 ${batch.name} 紧急回滚已插队，同区其他批次重排`) };
  }),
  on(telemetryTick, (state) => {
    const result = allocateCapacity(state, state.batches.map((b) => ({ ...b })));
    return { ...state, batches: result.batches, receipts: result.receipts, audits: result.audits };
  }),
  on(reportReceipt, (state, { receipt }) => {
    const batch = state.batches.find((b) => b.id === receipt.batchId);
    if (!batch) return state;
    const result = applyReceipt(state.receipts, batch, receipt);
    let audits = state.audits;
    if (result.duplicate) audits = audit(audits, '系统', `批次 ${batch.name} 设备 ${receipt.deviceId} 重复回执已忽略`);
    else if (result.receipts[0]?.status === 'pending_verification') audits = audit(audits, '系统', `批次 ${batch.name} 已停止，设备 ${receipt.deviceId} 回执退回待核对`);
    return { ...state, receipts: result.receipts, audits };
  }),
  on(retryReceipt, (state, { id }) => {
    const receipt = state.receipts.find((r) => r.id === id);
    if (!receipt || receipt.status !== 'failed') return state;
    const batch = state.batches.find((b) => b.id === receipt.batchId);
    const success = receipt.retryCount >= 1 || Math.random() < 0.6;
    const receipts = state.receipts.map((r) => (r.id === id ? { ...r, retryCount: r.retryCount + 1, status: (success ? 'counted' : 'failed') as DeviceReceipt['status'], reportedAt: new Date().toISOString() } : r));
    let batches = state.batches;
    if (success && receipt.kind === 'failed' && batch && batch.status !== 'paused' && batch.status !== 'rolled_back') {
      batches = state.batches.map((b) => (b.id === batch.id ? { ...b, failed: b.failed + 1 } : b));
    }
    return { ...state, batches, receipts, audits: audit(state.audits, '系统', success ? `设备 ${receipt.deviceId} 补报成功` : `设备 ${receipt.deviceId} 补报仍失败，可再次重试`) };
  }),
  on(dismissReceipt, (state, { id }) => ({ ...state, receipts: state.receipts.filter((r) => r.id !== id) })),
  on(submitBatch, (state, { id, baseVersion, actor }) => {
    const batch = state.batches.find((b) => b.id === id);
    if (!batch) return state;
    if (batch.version !== baseVersion) {
      // 后到者看到冲突设备：先到的一版已生效
      const conflict: SubmitConflict = {
        id: crypto.randomUUID(),
        batchId: id,
        batchName: batch.name,
        actor: actor.name,
        attemptedVersion: baseVersion,
        currentVersion: batch.version,
        conflictingDevices: batch.lastChangedDevices.length ? batch.lastChangedDevices : batch.devices.slice(0, 3),
        at: new Date().toISOString()
      };
      return { ...state, conflicts: [conflict, ...state.conflicts], audits: audit(state.audits, actor.name, `提交冲突：批次 ${batch.name} 已被先到提交更新至 v${batch.version}，后到者看到冲突设备 ${conflict.conflictingDevices.join('、')}`) };
    }
    return { ...state, batches: state.batches.map((b) => (b.id === id ? { ...b, version: b.version + 1, lastChangedDevices: [], updatedAt: new Date().toISOString() } : b)), audits: audit(state.audits, actor.name, `批次 ${batch.name} 提交生效（v${batch.version + 1}）`) };
  }),
  on(simulateExternalSubmit, (state, { id }) => {
    const batch = state.batches.find((b) => b.id === id);
    if (!batch) return state;
    const removed = batch.devices[0];
    const added = `dev-${batch.groupId}-${Math.floor(100 + Math.random() * 900)}`;
    const devices = [added, ...batch.devices.slice(1)];
    return { ...state, batches: state.batches.map((b) => (b.id === id ? { ...b, version: b.version + 1, devices, lastChangedDevices: [removed, added], updatedAt: new Date().toISOString() } : b)), audits: audit(state.audits, '另一会话', `批次 ${batch.name} 先到提交生效（v${batch.version + 1}），冲突设备 ${removed}、${added}`) };
  }),
  on(dismissConflict, (state, { id }) => ({ ...state, conflicts: state.conflicts.filter((c) => c.id !== id) })),
  on(updateModelList, (state, { models }) => {
    // 型号清单变更：已安装/已下发保留结果，未下发名额立即重算（pending = planned - installed - delivered）
    const retained: string[] = [];
    const newModels: DeviceModel[] = models.map((m) => {
      const existing = state.models.find((x) => x.id === m.id);
      return { ...m, installed: existing?.installed ?? 0, delivered: existing?.delivered ?? 0 };
    });
    for (const old of state.models) {
      if (!models.find((m) => m.id === old.id) && old.installed > 0) {
        retained.push(`${old.name}（${old.installed} 台已安装保留结果）`);
      }
    }
    let message = '型号清单变更：未下发名额已立即重算';
    if (retained.length) message += `；${retained.join('，')}`;
    return { ...state, models: newModels, audits: audit(state.audits, '发布负责人', message) };
  })
);
