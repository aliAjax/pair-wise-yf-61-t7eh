import { createFeatureSelector, createSelector } from '@ngrx/store';
import type { ReleaseBatch, ReleaseState } from './release.models';

export const selectRelease = createFeatureSelector<ReleaseState>('release');
export const selectModels = createSelector(selectRelease, (state) => state.models);
export const selectRegions = createSelector(selectRelease, (state) => state.regions);
export const selectGateways = createSelector(selectRelease, (state) => state.gateways);
export const selectDevices = createSelector(selectRelease, (state) => state.devices);
export const selectBatches = createSelector(selectRelease, (state) => state.batches);
export const selectSlots = createSelector(selectRelease, (state) => state.slots);
export const selectClaims = createSelector(selectRelease, (state) => state.claims);
export const selectReceipts = createSelector(selectRelease, (state) => state.receipts);
export const selectConflicts = createSelector(selectRelease, (state) => state.conflicts);
export const selectAudits = createSelector(selectRelease, (state) => state.audits);
export const selectPendingReports = createSelector(selectRelease, (state) => state.pendingReports);
export const selectNotice = createSelector(selectRelease, (state) => state.notice);

export interface BatchView extends ReleaseBatch {
  installed: number;
  failed: number;
  pendingReview: number;
  queued: number;
  dispatching: number;
  claimed: number;
  progress: number;
}

export const selectBatchViews = createSelector(
  selectRelease,
  (state): BatchView[] => state.batches.map((batch) => {
    const claimIds = new Set(state.claims.filter((c) => c.batchId === batch.id).map((c) => c.deviceId));
    const accepted = state.receipts.filter((r) => r.batchId === batch.id && r.kind === 'rollout' && r.status === 'accepted');
    const installed = accepted.filter((r) => r.outcome === 'success').length;
    const failed = accepted.filter((r) => r.outcome === 'failure').length;
    const dispatching = state.devices.filter((d) => d.state === 'dispatching' && claimIds.has(d.id)).length;
    const queued = state.slots.filter((s) => s.batchId === batch.id && s.kind === 'rollout').length;
    return {
      ...batch,
      installed,
      failed,
      pendingReview: state.receipts.filter((r) => r.batchId === batch.id && r.status === 'pending_review').length,
      queued,
      dispatching,
      claimed: state.devices.filter((d) => d.state === 'claimed' && claimIds.has(d.id)).length,
      progress: batch.quota ? Math.min(100, Math.round(installed / batch.quota * 100)) : 0
    };
  })
);

export interface RegionUsage {
  region: string;
  capacity: number;
  rolloutInFlight: number;
  rollbackInFlight: number;
  queued: number;
}

export const selectRegionUsage = createSelector(
  selectRelease,
  (state): RegionUsage[] => state.regions.map(({ region, capacity }) => ({
    region,
    capacity,
    rolloutInFlight: state.devices.filter((d) => d.region === region && d.state === 'dispatching').length,
    rollbackInFlight: state.devices.filter((d) => d.region === region && d.state === 'rolling_back').length,
    queued: state.slots.filter((s) => s.region === region).length
  }))
);

/** 队列视图：回滚插队排最前，标注同优先级 FIFO 顺序 */
export const selectQueueView = createSelector(
  selectRelease,
  (state) => [...state.slots]
    .sort((a, b) => a.priority - b.priority || a.seq - b.seq)
    .map((slot) => {
      const device = state.devices.find((d) => d.id === slot.deviceId);
      const batch = state.batches.find((b) => b.id === slot.batchId);
      return {
        ...slot,
        deviceName: device?.name ?? slot.deviceId,
        batchName: batch?.name ?? slot.batchId,
        gatewayId: device?.gatewayId ?? ''
      };
    })
);
