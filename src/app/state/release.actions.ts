import { createAction, props } from '@ngrx/store';
import type { Actor, DeviceModel, DeviceReceipt, ReleaseBatch } from './release.models';

export const setActor = createAction('[Release] Set actor', props<{ actor: Actor }>());
export const createBatch = createAction('[Release] Create batch', props<{ batch: ReleaseBatch }>());
export const approveBatch = createAction('[Release] Approve batch', props<{ id: string; actor: Actor }>());
export const pauseBatch = createAction('[Release] Pause batch', props<{ id: string; actor: Actor }>());
export const resumeBatch = createAction('[Release] Resume batch', props<{ id: string; actor: Actor }>());
export const startRollback = createAction('[Release] Start rollback', props<{ id: string; actor: Actor }>());
export const telemetryTick = createAction('[Release] Telemetry tick');
export const reportReceipt = createAction('[Release] Report receipt', props<{ receipt: DeviceReceipt }>());
export const retryReceipt = createAction('[Release] Retry receipt', props<{ id: string }>());
export const dismissReceipt = createAction('[Release] Dismiss receipt', props<{ id: string }>());
export const submitBatch = createAction('[Release] Submit batch', props<{ id: string; baseVersion: number; actor: Actor }>());
export const simulateExternalSubmit = createAction('[Release] Simulate external submit', props<{ id: string }>());
export const updateModelList = createAction('[Release] Update model list', props<{ models: DeviceModel[] }>());
export const dismissConflict = createAction('[Release] Dismiss conflict', props<{ id: string }>());
