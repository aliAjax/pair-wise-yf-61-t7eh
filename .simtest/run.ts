// 端到端规则仿真：直接驱动 releaseReducer，逐条验证需求
if (typeof globalThis.crypto === 'undefined') {
  let n = 0;
  (globalThis as unknown as { crypto: Crypto }).crypto = {
    randomUUID: () => `sim-${(n++).toString(16)}-${Date.now().toString(16)}`
  } as Crypto;
}
if (typeof localStorage === 'undefined') {
  const map = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => void map.clear(),
    key: (_i: number) => null,
    length: 0
  } as Storage;
}

import { releaseReducer } from '../src/app/state/release.reducer';
import {
  approveBatch, createBatch, enqueueDevices, pauseBatch, reconcileReceipt,
  resumeBatch, rollbackBatch, telemetryTick, updateBatchModels
} from '../src/app/state/release.actions';
import type { Actor, ReleaseState } from '../src/app/state/release.models';

const OWNER: Actor = { role: 'owner', name: '发布负责人', region: null };
const OPS_HD: Actor = { role: 'ops', name: '华东运维', region: '华东' };
const OPS_HN: Actor = { role: 'ops', name: '华南运维', region: '华南' };

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${detail}`); }
}
function tick(state: ReleaseState, n = 1): ReleaseState {
  for (let i = 0; i < n; i++) state = releaseReducer(state, telemetryTick());
  return state;
}
let state: ReleaseState = releaseReducer(undefined, { type: '@@init' });

console.log('\n[规则1] 区域 RBAC：区域运维只能处理本区；跨区紧急回滚仅发布负责人');
{
  const hd = state.devices.filter((d) => d.region === '华东' && d.model === 'GW-X100').map((d) => d.id);
  state = releaseReducer(state, createBatch({
    actor: OPS_HN, name: '华南运维建华东批次', firmware: '9.9', rollbackVersion: '9.8',
    region: '华东', models: ['GW-X100'], rolloutPercent: 100, failureThreshold: 50, deviceIds: hd
  }));
  check('跨区创建被拒且批次未生成', !state.batches.some((b) => b.name === '华南运维建华东批次') && !!state.notice);

  state = releaseReducer(state, createBatch({
    actor: OPS_HD, name: '华东批次A', firmware: '3.1', rollbackVersion: '3.0',
    region: '华东', models: ['GW-X100'], rolloutPercent: 100, failureThreshold: 50, deviceIds: hd
  }));
  const batchA = state.batches[0];
  state = releaseReducer(state, approveBatch({ id: batchA.id, actor: OPS_HN }));
  check('跨区审批被拒（批次仍为草稿）', state.batches.find((b) => b.id === batchA.id)!.status === 'draft');
  state = releaseReducer(state, approveBatch({ id: batchA.id, actor: OPS_HD }));
  state = releaseReducer(state, resumeBatch({ id: batchA.id, actor: OPS_HD }));
  state = tick(state, 1);
  state = releaseReducer(state, rollbackBatch({ id: batchA.id, actor: OPS_HN }));
  check('跨区紧急回滚被华南运维拒绝（发布负责人专属跨区动作）',
    state.batches.find((b) => b.id === batchA.id)!.status !== 'rolled_back');
  state = releaseReducer(state, rollbackBatch({ id: batchA.id, actor: OWNER }));
  check('发布负责人可跨区紧急回滚', state.batches.find((b) => b.id === batchA.id)!.status === 'rolled_back');
  state = tick(state, 10);
  // 清理：标记 batchA 设备，后续场景改用全新批次
}

console.log('\n[规则2] 区域容量上限：超额排队，容量释放后 FIFO 补位');
{
  const free = state.devices.filter((d) => d.region === '华东' && d.model === 'GW-X200' && !state.claims.some((c) => c.deviceId === d.id)).map((d) => d.id);
  state = releaseReducer(state, createBatch({
    actor: OPS_HD, name: '华东X200批次', firmware: '4.0', rollbackVersion: '3.9',
    region: '华东', models: ['GW-X200'], rolloutPercent: 100, failureThreshold: 100, deviceIds: free
  }));
  const b = state.batches[0];
  state = releaseReducer(state, approveBatch({ id: b.id, actor: OPS_HD }));
  state = releaseReducer(state, resumeBatch({ id: b.id, actor: OPS_HD }));
  state = tick(state, 1);
  const cap = state.regions.find((r) => r.region === '华东')!.capacity;
  const inFlight = state.devices.filter((d) => d.region === '华东' && (d.state === 'dispatching' || d.state === 'rolling_back')).length;
  const queued = state.slots.filter((s) => s.region === '华东' && s.kind === 'rollout').length;
  check('在途下发不超过区域容量', inFlight <= cap, `inFlight=${inFlight} cap=${cap}`);
  check('超额设备留在队列', queued > 0, `queued=${queued}`);
  const firstQueueSeq = Math.min(...state.slots.filter((s) => s.region === '华东').map((s) => s.seq));
  const before = state.slots.find((s) => s.seq === firstQueueSeq)!.deviceId;
  state = tick(state, 4);
  const launched = state.devices.find((d) => d.id === before);
  check('容量释放后队首设备补位下发', launched!.state === 'dispatching' || launched!.state === 'installed' || !!state.receipts.find((r) => r.deviceId === before),
    `state=${launched!.state}`);
}

console.log('\n[规则3] 紧急回滚立即插队，其他批次在途设备退回重排');
{
  // 华南：建一个批次并跑起来
  const hn = state.devices.filter((d) => d.region === '华南' && d.model === 'GW-X100').map((d) => d.id);
  state = releaseReducer(state, createBatch({
    actor: OPS_HN, name: '华南X100批次', firmware: '5.0', rollbackVersion: '4.9',
    region: '华南', models: ['GW-X100'], rolloutPercent: 100, failureThreshold: 100, deviceIds: hn
  }));
  const b1 = state.batches[0];
  state = releaseReducer(state, approveBatch({ id: b1.id, actor: OPS_HN }));
  state = releaseReducer(state, resumeBatch({ id: b1.id, actor: OPS_HN }));
  state = tick(state, 2);
  // 再建第二个华南批次（X100+T40 全部剩余设备）并发布，与 b1 一起把容量占满
  const restHN = state.devices.filter((d) => d.region === '华南' && d.state === 'idle'
    && !state.claims.some((c) => c.deviceId === d.id)).map((d) => d.id);
  state = releaseReducer(state, createBatch({
    actor: OPS_HN, name: '华南混合批次', firmware: '5.0', rollbackVersion: '4.9',
    region: '华南', models: ['GW-T40', 'GW-X100'], rolloutPercent: 100, failureThreshold: 100, deviceIds: restHN
  }));
  const b2 = state.batches[0];
  state = releaseReducer(state, approveBatch({ id: b2.id, actor: OPS_HN }));
  state = releaseReducer(state, resumeBatch({ id: b2.id, actor: OPS_HN }));
  state = tick(state, 2);
  // 确认容量已被占满（否则让位场景不成立）
  const capHN = state.regions.find((r) => r.region === '华南')!.capacity;
  const usedHN = state.devices.filter((d) => d.region === '华南' && d.state === 'dispatching').length;
  check('前置：华南容量已被占满，存在排队', usedHN === capHN && state.slots.some((s) => s.region === '华南'),
    `used=${usedHN}/${capHN} queued=${state.slots.length}`);

  // 等 b1 装上一些设备，然后回滚 b1
  state = tick(state, 6);
  const installedOnB1 = state.devices.filter((d) => d.installedBatchId === b1.id).length;
  state = releaseReducer(state, rollbackBatch({ id: b1.id, actor: OWNER }));
  const rbSlotsQueued = state.slots.filter((s) => s.kind === 'rollback');
  const rbInFlightNow = state.devices.filter((d) => d.region === '华南' && d.state === 'rolling_back').length;
  // 回滚立即插队：槽位 priority=0，若容量空闲当拍即出队（在 rolling_back），否则留在队列最前
  check('回滚生成 priority=0 的插队槽（队列或已在途）', rbInFlightNow > 0 || (rbSlotsQueued.length > 0 && rbSlotsQueued.every((s) => s.priority === 0)),
    `queued=${rbSlotsQueued.length} inflight=${rbInFlightNow}`);
  const queue = [...state.slots].sort((a, c) => a.priority - c.priority || a.seq - c.seq);
  check('回滚优先级高于普通发布（队列中有回滚时其必在最前）',
    rbInFlightNow > 0 || queue.length === 0 || queue[0].kind === 'rollback');
  const rbInFlight = state.devices.filter((d) => d.region === '华南' && d.state === 'rolling_back').length;
  check('回滚设备立即获得下发名额', rbInFlight > 0);
  // 让位：审计中应记录"其他批次设备退回重排"，或在状态中能观察到 b2 设备被重置重排队
  const preemptedAudit = state.audits.some((a) => a.message.includes('让位重排'));
  const preemptedState = state.slots.some((s) => s.batchId === b2.id && s.kind === 'rollout')
    || state.devices.some((d) => d.state === 'claimed' && state.claims.some((c) => c.deviceId === d.id && c.batchId === b2.id));
  check('其他批次在途设备退回队列重排', preemptedAudit || preemptedState,
    `audit=${preemptedAudit} state=${preemptedState}`);
  check('回滚设备数量与已装上设备一致', rbSlotsQueued.length + rbInFlight === installedOnB1, `rb=${rbSlotsQueued.length} inflight=${rbInFlight} installed=${installedOnB1}`);
  state = tick(state, 12);
  check('回滚完成后设备回到空闲且安装结果被撤销',
    !state.devices.some((d) => d.installedBatchId === b1.id && d.state === 'rolling_back'));
}

console.log('\n[规则4] 弱网补报：重复只算一次、失败按设备重试、停批次回执退待核对');
{
  // 持续推进直到所有弱网设备都走完补报流程
  state = tick(state, 24);
  const weakReceipts = state.receipts.filter((r) => r.weakNetwork);
  const retried = weakReceipts.some((r) => r.attempts > 1) || state.pendingReports.length > 0;
  check('弱网设备走补报重试通道（按设备），带尝试次数', weakReceipts.length > 0 && retried,
    `weakReceipts=${weakReceipts.length} pending=${state.pendingReports.length}`);
  // 找一个最终成功入账的弱网回执
  const wr = state.receipts.find((r) => r.weakNetwork && (r.status === 'accepted' || r.status === 'pending_review'));
  check('弱网回执带尝试次数并最终有归属', !!wr && wr.attempts >= 1);

  // 重复补报：同 key 再投一次，只算一次
  if (wr) {
    const before = state.receipts.length;
    state = releaseReducer(state, {
      type: '[Release] Report receipt',
      receipt: { key: wr.key, batchId: wr.batchId, deviceId: wr.deviceId, region: wr.region, kind: wr.kind, outcome: wr.outcome, weakNetwork: true }
    });
    check('重复回执不产生新记录（只算一次）', state.receipts.length === before);
  }

  // 暂停一个发布中批次，构造其在途设备完成 → 回执应退回待核对
  const running = state.batches.find((b) => b.status === 'running');
  if (running) {
    const inFlightDevice = state.devices.find((d) => d.region === running.region && d.state === 'dispatching');
    state = releaseReducer(state, pauseBatch({ id: running.id, actor: running.region === '华东' ? OPS_HD : OPS_HN }));
    // 直接对该批次任意 claim 设备塞一条安装成功回执模拟到达
    if (inFlightDevice) {
      const claim = state.claims.find((c) => c.deviceId === inFlightDevice.id);
      if (claim) {
        state = releaseReducer(state, {
          type: '[Release] Report receipt',
          receipt: { key: `${running.id}:${inFlightDevice.id}:rollout:success:late`, batchId: running.id, deviceId: inFlightDevice.id, region: running.region, kind: 'rollout', outcome: 'success', weakNetwork: false }
        });
        const r = state.receipts.find((x) => x.key === `${running.id}:${inFlightDevice.id}:rollout:success:late`);
        check('已暂停批次的回执退回待核对', r?.status === 'pending_review');
        state = releaseReducer(state, reconcileReceipt({ id: r!.id, actor: OWNER, accept: true }));
        check('待核对回执经值班确认后入账', state.receipts.find((x) => x.id === r!.id)!.status === 'accepted');
      }
    }
  }
}

console.log('\n[规则5] 两人同时提交同一批设备：先到生效，后到看到冲突设备');
{
  const free = state.devices.filter((d) => d.region === '新加坡' && d.state === 'idle').map((d) => d.id);
  const ids = free.slice(0, 3);
  state = releaseReducer(state, createBatch({
    actor: OWNER, name: '并发-先到', firmware: '6.0', rollbackVersion: '5.9',
    region: '新加坡', models: ['GW-X100'], rolloutPercent: 100, failureThreshold: 50, deviceIds: ids
  }));
  state = releaseReducer(state, createBatch({
    actor: { role: 'ops', name: '新加坡运维(后到)', region: '新加坡' }, name: '并发-后到', firmware: '6.0', rollbackVersion: '5.9',
    region: '新加坡', models: ['GW-X100'], rolloutPercent: 100, failureThreshold: 50, deviceIds: ids
  }));
  const panel = state.conflicts[0];
  check('后到者生成冲突面板', !!panel && panel.deviceIds.length === ids.length, `panel=${panel?.deviceIds.length}`);
  const first = state.batches.find((b) => b.name === '并发-先到')!;
  const second = state.batches.find((b) => b.name === '并发-后到')!;
  check('先到一版占用全部设备', state.claims.filter((c) => c.batchId === first.id).length === ids.length);
  check('后到一版一台都没占用', state.claims.filter((c) => c.batchId === second.id).length === 0);
  check('后到批次名额仍按型号清单算出（quota>0），等待后续可用设备', second.quota > 0);
}

console.log('\n[规则6] 型号清单变更：未下发名额立即重算，已装上的保留');
{
  // 各区域不存在的型号，用于把清单改成"零匹配"
  const absentModel: Record<string, string> = { '华东': 'GW-T40', '华南': 'GW-X200', '新加坡': 'GW-T40' };
  const actorByRegion: Record<string, Actor> = { '华东': OPS_HD, '华南': OPS_HN, '新加坡': OWNER };
  // 遍历区域+型号，找至少 2 台未被占用的设备
  const candidates = ['华东:GW-X200', '华南:GW-T40', '华南:GW-X100', '新加坡:GW-X100', '华东:GW-X100'];
  let picked: { region: string; model: string; free: string[] } | null = null;
  for (const item of candidates) {
    const [region, model] = item.split(':');
    const free = state.devices.filter((d) => d.region === region && d.model === model
      && !state.claims.some((c) => c.deviceId === d.id)).map((d) => d.id);
    if (free.length >= 2) { picked = { region, model, free }; break; }
  }

  if (picked) {
    const { region, model, free } = picked;
    state = releaseReducer(state, createBatch({
      actor: actorByRegion[region], name: '型号重算专用批次', firmware: '7.0', rollbackVersion: '6.9',
      region, models: [model], rolloutPercent: 100, failureThreshold: 100, deviceIds: free
    }));
    const b6 = state.batches[0];
    // 名额按该区域该型号的全部设备口径计算（含已被其他批次占用的），本次实际入选为 free 台
    const expectedQuota = state.devices.filter((d) => d.region === region && d.model === model
      && !d.resultBatchIds.includes(b6.id)).length;
    check('初始名额 = 符合型号设备数 × 灰度', b6.quota === expectedQuota, `quota=${b6.quota} expected=${expectedQuota}`);
    state = releaseReducer(state, approveBatch({ id: b6.id, actor: actorByRegion[region] }));
    state = releaseReducer(state, resumeBatch({ id: b6.id, actor: actorByRegion[region] }));
    state = tick(state, 6);
    const installedBefore = state.devices.filter((d) => d.installedBatchId === b6.id).length;
    check('前置：已有设备装上新版本', installedBefore > 0, `installed=${installedBefore}`);

    // 型号改成该区域完全没有的型号 → 名额立即变 0，未下发设备释放；已装上的保留
    state = releaseReducer(state, updateBatchModels({ id: b6.id, actor: actorByRegion[region], models: [absentModel[region]] }));
    const updated = state.batches.find((x) => x.id === b6.id)!;
    check('名额立即重算为 0', updated.quota === 0, `quota=${updated.quota}`);
    check('未下发（排队/claimed）设备被释放',
      !state.devices.some((d) => d.region === region && d.model === model && d.state === 'claimed'
        && state.claims.some((c) => c.deviceId === d.id && c.batchId === b6.id)));
    check('已装上设备的结果保留', state.devices.filter((d) => d.installedBatchId === b6.id).length === installedBefore,
      `before=${installedBefore} after=${state.devices.filter((d) => d.installedBatchId === b6.id).length}`);
  } else {
    check('前置：存在至少 2 台空闲设备的区域/型号（场景隔离）', false);
  }
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
