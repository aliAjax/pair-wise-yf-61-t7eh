import { createFeatureSelector, createSelector } from '@ngrx/store';
import type { ReleaseState } from './release.models';

export const selectRelease = createFeatureSelector<ReleaseState>('release');
export const selectGroups = createSelector(selectRelease, (state) => state.groups);
export const selectBatches = createSelector(selectRelease, (state) => state.batches);
export const selectAudits = createSelector(selectRelease, (state) => state.audits);
export const selectActor = createSelector(selectRelease, (state) => state.actor);
export const selectCapacities = createSelector(selectRelease, (state) => state.capacities);
export const selectReceipts = createSelector(selectRelease, (state) => state.receipts);
export const selectModels = createSelector(selectRelease, (state) => state.models);
export const selectConflicts = createSelector(selectRelease, (state) => state.conflicts);
export const selectPendingVerification = createSelector(selectReceipts, (receipts) => receipts.filter((r) => r.status === 'pending_verification'));
export const selectFailedReceipts = createSelector(selectReceipts, (receipts) => receipts.filter((r) => r.status === 'failed'));
export const selectReceiptsByBatch = (id: string) => createSelector(selectReceipts, (receipts) => receipts.filter((r) => r.batchId === id));
