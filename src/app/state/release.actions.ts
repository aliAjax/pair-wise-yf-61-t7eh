import { createAction, props } from '@ngrx/store';
import type { Actor, Receipt } from './release.models';

/** 创建批次（草稿，先到先得校验设备占用与型号名额） */
export const createBatch = createAction(
  '[Release] Create batch',
  props<{ actor: Actor; name: string; firmware: string; rollbackVersion: string; region: string; models: string[]; rolloutPercent: number; failureThreshold: number; deviceIds: string[] }>()
);
export const approveBatch = createAction('[Release] Approve batch', props<{ id: string; actor: Actor }>());
export const pauseBatch = createAction('[Release] Pause batch', props<{ id: string; actor: Actor }>());
export const resumeBatch = createAction('[Release] Resume batch', props<{ id: string; actor: Actor }>());
/** 紧急回滚：发布负责人可跨区，区域运维仅限本区；立即插队并让其他批次重排 */
export const rollbackBatch = createAction('[Release] Rollback batch', props<{ id: string; actor: Actor }>());

/** 运行中的批次追加设备；超额排队，冲突设备进冲突面板 */
export const enqueueDevices = createAction(
  '[Release] Enqueue devices',
  props<{ batchId: string; actor: Actor; deviceIds: string[] }>()
);

/** 型号清单变更：未下发名额立即重算，已装上的保留 */
export const updateBatchModels = createAction(
  '[Release] Update batch models',
  props<{ id: string; actor: Actor; models: string[] }>()
);

/** 弱网补报回执（模拟设备侧上报，重复只算一次） */
export const reportReceipt = createAction('[Release] Report receipt', props<{ receipt: Omit<Receipt, 'id' | 'status' | 'attempts'> }>());
/** 值班人员核对已停批次的回执 */
export const reconcileReceipt = createAction('[Release] Reconcile receipt', props<{ id: string; actor: Actor; accept: boolean }>());
export const dismissConflict = createAction('[Release] Dismiss conflict panel', props<{ id: string }>());
export const clearNotice = createAction('[Release] Clear notice');

export const telemetryTick = createAction('[Release] Telemetry tick');
