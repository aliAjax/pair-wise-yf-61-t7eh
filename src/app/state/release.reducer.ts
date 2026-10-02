import { createReducer, on } from '@ngrx/store';
import type {
  Actor, AuditEntry, Device, DeviceClaim, Gateway, QueueSlot, Receipt, ReceiptStatus,
  RegionCapacity, ReleaseBatch, ReleaseState
} from './release.models';
import {
  approveBatch, clearNotice, createBatch, dismissConflict, enqueueDevices, pauseBatch,
  reconcileReceipt, reportReceipt, resumeBatch, rollbackBatch, telemetryTick, updateBatchModels
} from './release.actions';

/* ---------------------------------- 种子数据 ---------------------------------- */

const REGIONS: RegionCapacity[] = [
  { region: '华东', capacity: 6 },
  { region: '华南', capacity: 5 },
  { region: '新加坡', capacity: 4 }
];
const MODELS = ['GW-X100', 'GW-X200', 'GW-T40'];

const GATEWAY_SEED: Array<[string, string, string, string, number]> = [
  ['g-edge-a', '华东·杭州边缘网关A组', '华东', 'GW-X200', 6],
  ['g-edge-b', '华东·苏州边缘网关B组', '华东', 'GW-X100', 5],
  ['g-plant-a', '华南·东莞工业采集组', '华南', 'GW-T40', 7],
  ['g-plant-b', '华南·佛山工业采集组', '华南', 'GW-X100', 4],
  ['g-clinic', '新加坡·远程诊疗终端组', '新加坡', 'GW-X100', 5]
];

function seedDevices(): Device[] {
  const devices: Device[] = [];
  for (const [gatewayId, , region, model, count] of GATEWAY_SEED) {
    for (let i = 1; i <= count; i++) {
      devices.push({
        id: `${gatewayId}-d${i}`,
        name: `${model}-${String(i).padStart(2, '0')}`,
        gatewayId,
        region,
        model,
        state: 'idle',
        // 每组固定 2 台弱网设备，用于演示补报
        weakNetwork: i > count - 2,
        progress: 0,
        installedBatchId: null,
        installedVersion: null,
        resultBatchIds: []
      });
    }
  }
  return devices;
}

const seedGateways = (): Gateway[] =>
  GATEWAY_SEED.map(([id, name, region, model]) => ({ id, name, region, model }));

function seedState(): ReleaseState {
  const now = new Date().toISOString();
  const demo: ReleaseBatch = {
    id: 'batch-demo',
    name: '边缘网关安全补丁 3.0.0',
    firmware: '3.0.0',
    rollbackVersion: '2.9.2',
    region: '华东',
    models: ['GW-X100', 'GW-X200'],
    rolloutPercent: 30,
    failureThreshold: 30,
    status: 'approved',
    quota: 0,
    seq: 0,
    createdAt: now,
    updatedAt: now
  };
  return {
    version: 2,
    models: [...MODELS],
    regions: REGIONS.map((item) => ({ ...item })),
    gateways: seedGateways(),
    devices: seedDevices(),
    batches: [demo],
    slots: [],
    claims: [],
    receipts: [],
    conflicts: [],
    pendingReports: [],
    audits: [{ id: crypto.randomUUID(), at: now, actor: '系统', message: '批次「边缘网关安全补丁 3.0.0」完成兼容性检查，等待开始发布' }],
    seqCounter: 0,
    notice: null
  };
}

const STORAGE_KEY = 'firmware-release-v2';
function loadInitial(): ReleaseState {
  const fallback = seedState();
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as ReleaseState | null;
    // 结构版本不一致则丢弃旧状态，避免过期状态被误用
    if (!stored || stored.version !== 2) return fallback;
    return stored;
  } catch {
    return fallback;
  }
}
const initialState = loadInitial();

/* ---------------------------------- 工具函数 ---------------------------------- */

let tick = 0;
function nextSeq(state: ReleaseState): number {
  return state.seqCounter + 1;
}
function auditEntry(actor: string, message: string): AuditEntry {
  return { id: crypto.randomUUID(), at: new Date().toISOString(), actor, message };
}
function withAudit(state: ReleaseState, actor: string, message: string): ReleaseState {
  return { ...state, audits: [auditEntry(actor, message), ...state.audits] };
}
function withNotice(state: ReleaseState, notice: string): ReleaseState {
  return { ...state, notice };
}

/** 区域运维只能处理本区；发布负责人不受限 */
function regionAllowed(actor: Actor, region: string): boolean {
  return actor.role === 'owner' || actor.region === region;
}
function denied(state: ReleaseState, actor: Actor, action: string, region: string): ReleaseState {
  const msg = `权限拦截：${actor.name} 尝试${action}「${region}」批次，仅${actor.region ? `本区（${actor.region}）` : '发布负责人'}可操作`;
  return withNotice(withAudit(state, actor.name, msg), `无权限：区域运维只能处理${actor.region}批次，跨区紧急回滚请由发布负责人执行`);
}

function eligibleDevices(state: ReleaseState, batch: ReleaseBatch): Device[] {
  return state.devices.filter(
    (device) => device.region === batch.region
      && batch.models.includes(device.model)
      && !device.resultBatchIds.includes(batch.id)
  );
}
/**
 * 批次名额：符合区域与型号清单、未装过本批次的设备 × 灰度比例。
 * 名额是计划数：型号清单一变立即重算，已装上的设备保留（不占新名额）。
 * 当前是否还有空闲设备可入选，由提交时的占用/冲突校验决定。
 */
function computeQuota(state: ReleaseState, batch: ReleaseBatch): number {
  return Math.max(0, Math.round(eligibleDevices(state, batch).length * batch.rolloutPercent / 100));
}
function claimedByBatch(state: ReleaseState, batchId: string): DeviceClaim[] {
  return state.claims.filter((claim) => claim.batchId === batchId);
}

/* ---------------------------------- 队列调度 ---------------------------------- */

/**
 * 按区域容量调度排队位：
 * - 紧急回滚 priority=0 始终排在普通发布前，立即插队
 * - 回滚插队占满区域容量时，其他批次已下发的设备退回队列重排（rollback 触发时处理）
 */
function schedule(state: ReleaseState): { slots: QueueSlot[]; devices: Device[]; launched: Array<{ slot: QueueSlot; kind: QueueSlot['kind'] }> } {
  let slots = state.slots.map((slot) => ({ ...slot }));
  const devices = state.devices.map((device) => ({ ...device }));
  const batchById = new Map(state.batches.map((batch) => [batch.id, batch]));
  const launched: Array<{ slot: QueueSlot; kind: QueueSlot['kind'] }> = [];

  // 清理失效位：批次已不存在，或已停止批次的普通发布位（草稿/审批/发布中的排队位保留）
  slots = slots.filter((slot) => {
    const batch = batchById.get(slot.batchId);
    if (!batch) return false;
    if (slot.kind === 'rollout' && (batch.status === 'paused' || batch.status === 'rolled_back' || batch.status === 'completed')) return false;
    return devices.some((device) => device.id === slot.deviceId);
  });

  const inFlight = new Map<string, number>();
  for (const region of state.regions) inFlight.set(region.region, 0);
  for (const device of devices) {
    // 只统计仍有有效占用的在途设备（回滚释放 claim 后卡住的 dispatching 不占名额）
    const hasClaim = state.claims.some((claim) => claim.deviceId === device.id);
    if (hasClaim && (device.state === 'dispatching' || device.state === 'rolling_back')) {
      inFlight.set(device.region, (inFlight.get(device.region) ?? 0) + 1);
    }
  }

  const byRegion = new Map<string, QueueSlot[]>();
  for (const slot of slots) {
    byRegion.set(slot.region, [...(byRegion.get(slot.region) ?? []), slot]);
  }

  const launchedIds = new Set<string>();
  const remain: QueueSlot[] = [];
  for (const region of state.regions) {
    const queued = (byRegion.get(region.region) ?? [])
      .sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    let used = inFlight.get(region.region) ?? 0;
    for (const slot of queued) {
      if (used < region.capacity) {
        const device = devices.find((item) => item.id === slot.deviceId);
        if (!device || (slot.kind === 'rollout' && device.state !== 'claimed') || (slot.kind === 'rollback' && device.state !== 'idle')) {
          remain.push(slot); // 设备状态位已失效（例如型号变更释放了排队名额）
          continue;
        }
        device.state = slot.kind === 'rollback' ? 'rolling_back' : 'dispatching';
        device.progress = 0;
        used += 1;
        launchedIds.add(slot.id);
        launched.push({ slot: { ...slot }, kind: slot.kind });
      } else {
        remain.push(slot); // 容量已满，排队等待
      }
    }
  }
  // 容量外未处理区域（理论上 regions 已全覆盖）的槽位保留
  for (const slot of slots) {
    if (!launchedIds.has(slot.id) && !remain.some((item) => item.id === slot.id)) remain.push(slot);
  }
  return { slots: remain, devices, launched };
}

/* ---------------------------------- 回执处理 ---------------------------------- */

function receiptExists(receipts: Receipt[], key: string): boolean {
  return receipts.some((item) => item.key === key && (item.status === 'accepted' || item.status === 'pending_review'));
}

function acceptReceipt(state: ReleaseState, input: {
  key: string; batchId: string; deviceId: string; kind: Receipt['kind'];
  outcome: 'success' | 'failure'; weakNetwork: boolean; attempts: number;
}): { state: ReleaseState; status: ReceiptStatus } {
  const { key, batchId, deviceId, kind, outcome, weakNetwork, attempts } = input;
  // 重复补报只算一次
  if (receiptExists(state.receipts, key)) {
    return {
      state: withNotice(state, `设备 ${deviceId} 的回执重复上报，已按一次计数（批次 ${batchId}）`),
      status: 'duplicate'
    };
  }
  const device = state.devices.find((item) => item.id === deviceId);
  const batch = state.batches.find((item) => item.id === batchId);
  const region = device?.region ?? batch?.region ?? '未知区域';
  // 已停批次（暂停/已回滚）的安装回执不能直接入账，退回待核对；回滚回执始终入账
  const batchStopped = kind === 'rollout' && !!batch && (batch.status === 'paused' || batch.status === 'rolled_back');
  const status: ReceiptStatus = batchStopped ? 'pending_review' : 'accepted';

  let devices = state.devices;
  let claims = state.claims;
  if (status === 'accepted') {
    devices = state.devices.map((item) => {
      if (item.id !== deviceId) return item;
      if (kind === 'rollback') {
        return {
          ...item,
          state: 'idle', progress: 100,
          installedBatchId: outcome === 'success' ? null : item.installedBatchId,
          installedVersion: outcome === 'success' ? null : item.installedVersion
        };
      }
      return outcome === 'success'
        ? {
            ...item, state: 'installed', progress: 100, installedBatchId: batchId,
            installedVersion: batch?.firmware ?? item.installedVersion,
            resultBatchIds: item.resultBatchIds.includes(batchId) ? item.resultBatchIds : [...item.resultBatchIds, batchId]
          }
        : {
            ...item, state: 'failed', progress: 100,
            resultBatchIds: item.resultBatchIds.includes(batchId) ? item.resultBatchIds : [...item.resultBatchIds, batchId]
          };
    });
    // 安装失败/回滚结束后释放占用，设备可再被其他批次提交
    claims = state.claims.filter((claim) => !(claim.deviceId === deviceId && (outcome === 'failure' || kind === 'rollback')));
  }

  const receipt: Receipt = {
    id: crypto.randomUUID(), key, batchId, deviceId, region, kind, outcome, status,
    weakNetwork, attempts, at: new Date().toISOString(),
    note: status === 'pending_review' ? '回执到达时批次已停止，退回待核对' : undefined
  };
  return {
    state: {
      ...state,
      devices,
      claims,
      receipts: [receipt, ...state.receipts]
    },
    status
  };
}

/* ---------------------------------- Reducer ---------------------------------- */

export const releaseReducer = createReducer(
  initialState,

  on(clearNotice, (state) => ({ ...state, notice: null })),

  on(createBatch, (state, { actor, name, firmware, rollbackVersion, region, models, rolloutPercent, failureThreshold, deviceIds }) => {
    if (!regionAllowed(actor, region)) return denied(state, actor, '创建', region);
    if (!name || !firmware || models.length === 0 || deviceIds.length === 0) {
      return withNotice(state, '请填写批次名称、目标版本、型号并至少选择一台设备');
    }

    const seq = nextSeq(state);
    const now = new Date().toISOString();
    const batch: ReleaseBatch = {
      id: crypto.randomUUID(),
      name, firmware, rollbackVersion, region, models: [...models],
      rolloutPercent, failureThreshold,
      status: 'draft', quota: 0, seq,
      createdAt: now, updatedAt: now
    };

    // 只收本区 + 型号匹配 + 未对本批次产生过结果（成功或失败）的设备
    const scoped = deviceIds.filter((id) => {
      const device = state.devices.find((item) => item.id === id);
      return device && device.region === region && models.includes(device.model) && !device.resultBatchIds.includes(batch.id);
    });
    // 两人同时提交同一批设备：只让先到的一版生效
    const conflictIds = scoped.filter((id) => state.claims.some((claim) => claim.deviceId === id));
    const freeIds = scoped.filter((id) => !conflictIds.includes(id));

    let next: ReleaseState = {
      ...state,
      batches: [batch, ...state.batches],
      seqCounter: seq
    };
    next = computeAndEnqueue(next, batch.id, freeIds);
    if (conflictIds.length) {
      next = {
        ...next,
        conflicts: [{
          id: crypto.randomUUID(),
          actor: actor.name,
          batchId: batch.id,
          batchName: name,
          deviceIds: conflictIds,
          at: now
        }, ...next.conflicts]
      };
      next = withNotice(next, `提交冲突：${conflictIds.length} 台设备已被先到的批次占用，已列入冲突设备`);
    }
    return withAudit(next, actor.name, `创建批次「${name}」（${region}，型号 ${models.join('/')}）：入选 ${freeIds.length} 台，冲突 ${conflictIds.length} 台`);
  }),

  on(approveBatch, (state, { id, actor }) => {
    const batch = state.batches.find((item) => item.id === id);
    if (!batch) return state;
    if (!regionAllowed(actor, batch.region)) return denied(state, actor, '审批', batch.region);
    if (batch.status !== 'draft') return withNotice(state, '仅草稿批次可审批');
    return withAudit(
      { ...state, batches: state.batches.map((item) => item.id === id ? { ...item, status: 'approved', updatedAt: new Date().toISOString() } : item) },
      actor.name, `批次「${batch.name}」审批通过`
    );
  }),

  on(pauseBatch, (state, { id, actor }) => {
    const batch = state.batches.find((item) => item.id === id);
    if (!batch) return state;
    if (!regionAllowed(actor, batch.region)) return denied(state, actor, '暂停', batch.region);
    if (batch.status !== 'running') return withNotice(state, '仅发布中的批次可暂停');
    // 排队位退回（保留设备占用，继续时重新排队）；下发中的设备等其回执
    const slots = state.slots.filter((slot) => !(slot.batchId === id && slot.kind === 'rollout'));
    return withAudit(
      { ...state, batches: state.batches.map((item) => item.id === id ? { ...item, status: 'paused', updatedAt: new Date().toISOString() } : item), slots },
      actor.name, `批次「${batch.name}」已暂停，未下发设备退回排队`
    );
  }),

  on(resumeBatch, (state, { id, actor }) => {
    const batch = state.batches.find((item) => item.id === id);
    if (!batch) return state;
    if (!regionAllowed(actor, batch.region)) return denied(state, actor, '继续', batch.region);
    if (batch.status !== 'approved' && batch.status !== 'paused') return withNotice(state, '批次当前状态不可开始/继续');

    let next: ReleaseState = {
      ...state,
      batches: state.batches.map((item) => item.id === id ? { ...item, status: 'running', updatedAt: new Date().toISOString() } : item)
    };
    // 暂停后继续：把仍是 claimed 的占用设备重新入队（下发中的不重复入队）
    const claimed = next.claims
      .filter((claim) => claim.batchId === id)
      .map((claim) => next.devices.find((device) => device.id === claim.deviceId))
      .filter((device): device is Device => !!device && device.state === 'claimed');
    if (claimed.length) {
      let seq = next.seqCounter;
      const now = new Date().toISOString();
      const slots = [...next.slots];
      for (const device of claimed) {
        if (slots.some((slot) => slot.deviceId === device.id && slot.batchId === id)) continue;
        seq += 1;
        slots.push({ id: crypto.randomUUID(), batchId: id, deviceId: device.id, region: device.region, kind: 'rollout', priority: 1, seq, enqueuedAt: now });
      }
      next = { ...next, slots, seqCounter: seq };
    }
    const scheduled = schedule(next);
    next = { ...next, slots: scheduled.slots, devices: scheduled.devices };
    return withAudit(next, actor.name, `批次「${batch.name}」开始/继续发布，${claimed.length} 台重新排队`);
  }),

  on(rollbackBatch, (state, { id, actor }) => {
    const batch = state.batches.find((item) => item.id === id);
    if (!batch) return state;
    // 跨区紧急回滚仅发布负责人
    if (!regionAllowed(actor, batch.region)) return denied(state, actor, '紧急回滚', batch.region);
    if (batch.status === 'rolled_back' || batch.status === 'draft') return withNotice(state, '该批次当前状态不可回滚');

    const now = new Date().toISOString();
    let devices = state.devices.map((device) => ({ ...device }));
    let claims = state.claims.map((claim) => ({ ...claim }));
    const region = batch.region;

    // 让其他批次的在途下发立即让位：退回报错终态并退回队列重排
    const preempted: Device[] = [];
    for (const device of devices) {
      if (device.region !== region || device.state !== 'dispatching') continue;
      const claim = claims.find((item) => item.deviceId === device.id);
      if (claim && claim.batchId !== id) preempted.push(device);
    }
    const slots = state.slots.filter((slot) => {
      if (slot.kind !== 'rollout' || slot.region !== region) return true;
      const device = devices.find((item) => item.id === slot.deviceId);
      return !!device && !preempted.some((item) => item.id === device.id);
    });
    let seq = state.seqCounter;
    for (const device of preempted) {
      device.state = 'claimed';
      device.progress = 0;
      seq += 1;
      slots.push({ id: crypto.randomUUID(), batchId: state.claims.find((c) => c.deviceId === device.id)!.batchId, deviceId: device.id, region, kind: 'rollout', priority: 1, seq, enqueuedAt: now });
    }

    // 本批次设备：成功装上的需要回滚；失败/排队中的直接释放
    const rollbackDevices = devices.filter((device) =>
      device.region === region && device.installedBatchId === id);
    for (const device of devices) {
      if (device.region !== region) continue;
      const claimedHere = claims.some((claim) => claim.deviceId === device.id && claim.batchId === id);
      if (claimedHere && device.state === 'claimed') {
        // 排队中的设备取消发布、立即释放
        device.state = 'idle';
        device.progress = 0;
      }
    }
    claims = claims.filter((claim) => {
      if (claim.batchId !== id) return true;
      const device = devices.find((item) => item.id === claim.deviceId);
      // 保留：在途下发/回滚；释放：排队取消与即将重新占用的已装上设备
      return !!device && (device.state === 'dispatching' || device.state === 'rolling_back');
    });
    // 移除本批次普通排队位
    const slots2 = slots.filter((slot) => !(slot.batchId === id && slot.kind === 'rollout'));
    for (const device of rollbackDevices) {
      seq += 1;
      // 回滚优先级 0，序号也压到最低，保证立刻插队
      slots2.push({ id: crypto.randomUUID(), batchId: id, deviceId: device.id, region, kind: 'rollback', priority: 0, seq, enqueuedAt: now });
      const target = devices.find((item) => item.id === device.id)!;
      target.state = 'idle'; // schedule 需要从 idle 进入 rolling_back
      if (!claims.some((claim) => claim.deviceId === device.id && claim.batchId === id)) {
        claims.push({ deviceId: device.id, batchId: id });
      }
    }

    let next: ReleaseState = {
      ...state,
      devices,
      claims,
      slots: slots2,
      seqCounter: seq,
      batches: state.batches.map((item) => item.id === id ? { ...item, status: 'rolled_back', updatedAt: now } : item)
    };
    const scheduled = schedule(next);
    next = { ...next, slots: scheduled.slots, devices: scheduled.devices };
    next = withNotice(next, `紧急回滚已插队：${rollbackDevices.length} 台回滚优先下发，${preempted.length} 台其他批次设备退回重排`);
    return withAudit(next, actor.name, `批次「${batch.name}」紧急回滚：${rollbackDevices.length} 台插队回滚，${preempted.length} 台让位重排`);
  }),

  on(enqueueDevices, (state, { batchId, actor, deviceIds }) => {
    const batch = state.batches.find((item) => item.id === batchId);
    if (!batch) return state;
    if (!regionAllowed(actor, batch.region)) return denied(state, actor, '追加设备到', batch.region);
    if (batch.status !== 'running') return withNotice(state, '仅发布中的批次可追加设备');
    const scoped = deviceIds.filter((id) => {
      const device = state.devices.find((item) => item.id === id);
      return device && device.region === batch.region && batch.models.includes(device.model) && !device.resultBatchIds.includes(batchId);
    });
    const conflictIds = scoped.filter((id) => state.claims.some((claim) => claim.deviceId === id));
    const freeIds = scoped.filter((id) => !conflictIds.includes(id));
    let next = computeAndEnqueue(state, batchId, freeIds);
    if (conflictIds.length) {
      next = {
        ...next,
        conflicts: [{ id: crypto.randomUUID(), actor: actor.name, batchId, batchName: batch.name, deviceIds: conflictIds, at: new Date().toISOString() }, ...next.conflicts]
      };
      next = withNotice(next, `提交冲突：${conflictIds.length} 台设备已被先到的批次占用`);
    }
    if (!freeIds.length && !conflictIds.length) next = withNotice(next, '没有符合区域与型号条件的可追加设备');
    return withAudit(next, actor.name, `批次「${batch.name}」追加提交 ${scoped.length} 台：入选 ${freeIds.length} 台，冲突 ${conflictIds.length} 台`);
  }),

  on(updateBatchModels, (state, { id, actor, models }) => {
    const batch = state.batches.find((item) => item.id === id);
    if (!batch) return state;
    if (!regionAllowed(actor, batch.region)) return denied(state, actor, '修改型号清单', batch.region);
    if (batch.status === 'rolled_back' || batch.status === 'completed') return withNotice(state, '已结束批次的型号清单不可修改');

    const before = batch.quota;
    const updated: ReleaseBatch = { ...batch, models: [...models], updatedAt: new Date().toISOString() };
    let next: ReleaseState = {
      ...state,
      batches: state.batches.map((item) => item.id === id ? updated : item)
    };
    const quota = computeQuota(next, updated);
    next = { ...next, batches: next.batches.map((item) => item.id === id ? { ...item, quota } : item) };

    // 型号不再匹配的占用：未下发（claimed/排队）立即释放；已装上的保留结果
    const batchClaims = claimedByBatch(next, id);
    const releaseIds = new Set<string>();
    for (const claim of batchClaims) {
      const device = next.devices.find((item) => item.id === claim.deviceId);
      if (!device) continue;
      if (device.state === 'claimed' && !models.includes(device.model)) releaseIds.add(device.id);
    }
    // 名额缩小：超出新名额的排队设备也释放（取队尾，最后入队的先退）
    const claimedDevices = next.devices.filter((device) =>
      device.region === batch.region && models.includes(device.model)
      && next.claims.some((claim) => claim.deviceId === device.id && claim.batchId === id)
      && device.state === 'claimed');
    const overflow = Math.max(0, claimedDevices.length - quota);
    if (overflow > 0) {
      const queuedOrder = next.slots
        .filter((slot) => slot.batchId === id && slot.kind === 'rollout')
        .sort((a, b) => b.seq - a.seq)
        .map((slot) => slot.deviceId);
      // 队尾先退；队列位缺失时用剩余 claimed 设备兜底，保证名额一定收敛
      for (const deviceId of queuedOrder) {
        if (releaseIds.size >= overflow) break;
        releaseIds.add(deviceId);
      }
      for (const device of claimedDevices) {
        if (releaseIds.size >= overflow) break;
        if (!releaseIds.has(device.id)) releaseIds.add(device.id);
      }
    }

    if (releaseIds.size) {
      next = {
        ...next,
        devices: next.devices.map((device) => releaseIds.has(device.id) ? { ...device, state: 'idle', progress: 0 } : device),
        claims: next.claims.filter((claim) => !(claim.batchId === id && releaseIds.has(claim.deviceId))),
        slots: next.slots.filter((slot) => !(slot.batchId === id && releaseIds.has(slot.deviceId)))
      };
    }
    const scheduled = schedule(next);
    next = { ...next, slots: scheduled.slots, devices: scheduled.devices };
    next = withNotice(next, `型号清单已变更：未下发名额 ${before} → ${quota} 立即重算，已装上的设备结果保留`);
    return withAudit(next, actor.name, `批次「${batch.name}」型号清单变更为 ${models.join('/')}，名额 ${before} → ${quota}，释放 ${releaseIds.size} 台未下发设备`);
  }),

  on(reportReceipt, (state, { receipt }) => {
    const result = acceptReceipt(state, {
      key: receipt.key, batchId: receipt.batchId, deviceId: receipt.deviceId,
      kind: receipt.kind, outcome: receipt.outcome, weakNetwork: receipt.weakNetwork, attempts: 1
    });
    return result.state;
  }),

  on(reconcileReceipt, (state, { id, actor, accept }) => {
    const receipt = state.receipts.find((item) => item.id === id);
    if (!receipt || receipt.status !== 'pending_review') return state;
    if (!accept) {
      const rejected = state.receipts.map((item) => item.id === id
        ? { ...item, status: 'retry_failed' as ReceiptStatus, note: '值班核对后驳回：回执与现场状态不符，按设备重试' }
        : item);
      // 驳回后按设备重试：重新生成补报任务
      const pending = state.pendingReports.some((item) => item.key === receipt.key)
        ? state.pendingReports
        : [...state.pendingReports, { key: `${receipt.key}:retry`, batchId: receipt.batchId, deviceId: receipt.deviceId, kind: receipt.kind, outcome: receipt.outcome, weakNetwork: true, attempts: 1 }];
      return withAudit({ ...state, receipts: rejected, pendingReports: pending }, actor.name, `回执 ${receipt.deviceId} 核对驳回，已按设备重新补报`);
    }
    // 核对通过：正式入账
    const accepted = state.receipts.map((item) => item.id === id ? { ...item, status: 'accepted' as ReceiptStatus, note: '值班核对通过' } : item);
    let devices = state.devices;
    let claims = state.claims;
    const batch = state.batches.find((item) => item.id === receipt.batchId);
    if (receipt.kind === 'rollback') {
      devices = devices.map((device) => device.id === receipt.deviceId
        ? { ...device, state: 'idle', progress: 100, installedBatchId: receipt.outcome === 'success' ? null : device.installedBatchId, installedVersion: receipt.outcome === 'success' ? null : device.installedVersion }
        : device);
      claims = claims.filter((claim) => claim.deviceId !== receipt.deviceId);
    } else {
      devices = devices.map((device) => {
        if (device.id !== receipt.deviceId) return device;
        const resultBatchIds = device.resultBatchIds.includes(receipt.batchId) ? device.resultBatchIds : [...device.resultBatchIds, receipt.batchId];
        return receipt.outcome === 'success'
          ? { ...device, state: 'installed', progress: 100, installedBatchId: receipt.batchId, installedVersion: batch?.firmware ?? device.installedVersion, resultBatchIds }
          : { ...device, state: 'failed', progress: 100, resultBatchIds };
      });
      if (receipt.outcome === 'failure') claims = claims.filter((claim) => claim.deviceId !== receipt.deviceId);
    }
    const scheduled = schedule({ ...state, devices, claims, receipts: accepted, slots: state.slots });
    return withAudit(
      { ...state, devices: scheduled.devices, claims, receipts: accepted, slots: scheduled.slots },
      actor.name, `回执 ${receipt.deviceId}（${receipt.kind === 'rollback' ? '回滚' : '安装'}${receipt.outcome === 'success' ? '成功' : '失败'}）核对通过并入账`
    );
  }),

  on(dismissConflict, (state, { id }) => ({ ...state, conflicts: state.conflicts.filter((item) => item.id !== id) })),

  on(telemetryTick, (state) => {
    tick += 1;
    let devices = state.devices.map((device) => ({ ...device }));
    const receipts = [...state.receipts];
    let pendingReports = state.pendingReports.map((item) => ({ ...item }));
    const batchMap = new Map(state.batches.map((batch) => [batch.id, batch]));
    const newAudits: AuditEntry[] = [];
    let notice = state.notice;

    /* 1) 在途设备推进；完成后上报回执（弱网设备回执进入补报队列） */
    const finishing: Array<{ deviceId: string; batchId: string; kind: 'rollout' | 'rollback'; outcome: 'success' | 'failure'; weakNetwork: boolean }> = [];
    devices = devices.map((device) => {
      if (device.state !== 'dispatching' && device.state !== 'rolling_back') return device;
      const claim = state.claims.find((item) => item.deviceId === device.id);
      if (!claim) return { ...device, state: 'idle', progress: 0 }; // 无主在途设备回收
      const speed = device.weakNetwork ? 12 : 30;
      const progress = Math.min(100, device.progress + speed + Math.floor(Math.random() * 14));
      if (progress < 100) return { ...device, progress };
      const failure = Math.random() < (device.weakNetwork ? 0.18 : 0.08);
      finishing.push({ deviceId: device.id, batchId: claim.batchId, kind: device.state === 'rolling_back' ? 'rollback' : 'rollout', outcome: failure ? 'failure' : 'success', weakNetwork: device.weakNetwork });
      return { ...device, progress: 100 };
    });

    let work: ReleaseState = { ...state, devices };
    for (const done of finishing) {
      const key = `${done.batchId}:${done.deviceId}:${done.kind}:${done.outcome}`;
      if (receiptExists(work.receipts, key)) continue;
      if (done.weakNetwork) {
        // 弱网：首次上报大概率失败，进入按设备重试
        pendingReports.push({ key, batchId: done.batchId, deviceId: done.deviceId, kind: done.kind, outcome: done.outcome, weakNetwork: true, attempts: 0 });
      } else {
        const result = acceptReceipt(work, { key, batchId: done.batchId, deviceId: done.deviceId, kind: done.kind, outcome: done.outcome, weakNetwork: false, attempts: 1 });
        work = result.state;
        if (result.status === 'pending_review') notice = `设备 ${done.deviceId} 的回执到达时批次已停止，已退回待核对`;
      }
    }

    /* 2) 弱网补报：按设备重试，重复只算一次；每次尝试有概率继续失败 */
    const stillPending: typeof pendingReports = [];
    for (const report of pendingReports) {
      const attempts = report.attempts + 1;
      if (receiptExists(work.receipts, report.key)) continue; // 重传的重复回执，只算一次
      if (Math.random() < 0.55) {
        const result = acceptReceipt(work, { ...report, attempts });
        work = result.state;
        if (result.status === 'pending_review') notice = `设备 ${report.deviceId} 补报成功，但批次已停止，回执退回待核对`;
        else if (result.status !== 'duplicate') notice = `设备 ${report.deviceId} 弱网补报成功（第 ${attempts} 次尝试）`;
      } else {
        stillPending.push({ ...report, attempts });
      }
    }
    pendingReports = stillPending;

    /* 3) 完成设备移出槽位并按区域容量继续调度（回滚永远优先） */
    const scheduled = schedule({ ...work, pendingReports });
    work = { ...work, slots: scheduled.slots, devices: scheduled.devices, pendingReports };

    /* 4) 失败率超阈值自动暂停；安装数达名额则完成 */
    work = {
      ...work,
      batches: work.batches.map((batch) => {
        if (batch.status !== 'running') return batch;
        const acceptedReceipts = work.receipts.filter((r) => r.batchId === batch.id && r.kind === 'rollout' && r.status === 'accepted');
        const installed = acceptedReceipts.filter((r) => r.outcome === 'success').length;
        const failed = acceptedReceipts.filter((r) => r.outcome === 'failure').length;
        const total = installed + failed;
        const rate = total ? failed / total * 100 : 0;
        if (rate > batch.failureThreshold && failed >= 2) {
          newAudits.push(auditEntry('系统', `批次「${batch.name}」失败率 ${rate.toFixed(0)}% 超过阈值 ${batch.failureThreshold}%，自动暂停`));
          return { ...batch, status: 'paused' as const, updatedAt: new Date().toISOString() };
        }
        if (batch.quota > 0 && installed >= batch.quota) {
          newAudits.push(auditEntry('系统', `批次「${batch.name}」已达名额 ${batch.quota} 台，发布完成`));
          return { ...batch, status: 'completed' as const, updatedAt: new Date().toISOString() };
        }
        return batch;
      })
    };

    return { ...work, audits: [...newAudits, ...work.audits], notice };
  })
);

/* --------------------------- 创建/追加共用的入队逻辑 --------------------------- */

function computeAndEnqueue(state: ReleaseState, batchId: string, freeDeviceIds: string[]): ReleaseState {
  const batch = state.batches.find((item) => item.id === batchId);
  if (!batch) return state;
  // 名额立即按当前型号清单重算（已装上的不占名额）
  const quota = computeQuota(state, batch);
  const now = new Date().toISOString();
  const selected = freeDeviceIds.slice(0, quota);

  let seq = state.seqCounter;
  const claims: DeviceClaim[] = [...state.claims];
  const slots = [...state.slots];
  for (const deviceId of selected) {
    claims.push({ deviceId, batchId });
    seq += 1;
    // 草稿/审批态先排队，开始发布时调度器才会真正下发
    slots.push({ id: crypto.randomUUID(), batchId, deviceId, region: batch.region, kind: 'rollout', priority: 1, seq, enqueuedAt: now });
  }

  let next: ReleaseState = {
    ...state,
    claims,
    slots,
    seqCounter: seq,
    devices: state.devices.map((device) => selected.includes(device.id) ? { ...device, state: 'claimed' as const } : device),
    batches: state.batches.map((item) => item.id === batchId ? { ...item, quota, updatedAt: now } : item)
  };

  if (batch.status === 'running') {
    const scheduled = schedule(next);
    next = { ...next, slots: scheduled.slots, devices: scheduled.devices };
  }
  const inFlightOrQueued = next.slots.filter((slot) => slot.batchId === batchId).length
    + next.devices.filter((device) => (device.state === 'dispatching' || device.state === 'rolling_back')
      && next.claims.some((claim) => claim.deviceId === device.id && claim.batchId === batchId)).length;
  return { ...next, notice: `名额 ${quota} 台，本次占用 ${selected.length} 台；区域容量外设备自动排队（当前队列/在途 ${inFlightOrQueued} 台）` };
}
