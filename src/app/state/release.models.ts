export type BatchStatus = 'draft' | 'approved' | 'queued' | 'running' | 'paused' | 'rollback' | 'completed' | 'rolled_back';

export type ActorRole = 'owner' | 'regional_ops' | 'operator';

export interface Actor {
  role: ActorRole;
  region: string;
  name: string;
}

export interface DeviceGroup {
  id: string;
  name: string;
  region: string;
  count: number;
  compatible: boolean;
  offlineGateways: number;
}

export interface DeviceModel {
  id: string;
  name: string;
  region: string;
  groupId: string;
  planned: number;
  installed: number;
  delivered: number;
}

export type ReceiptKind = 'downloaded' | 'installed' | 'failed';
export type ReceiptStatus = 'counted' | 'failed' | 'pending_verification';

export interface DeviceReceipt {
  id: string;
  batchId: string;
  deviceId: string;
  region: string;
  kind: ReceiptKind;
  status: ReceiptStatus;
  retryCount: number;
  reportedAt: string;
}

export interface SubmitConflict {
  id: string;
  batchId: string;
  batchName: string;
  actor: string;
  attemptedVersion: number;
  currentVersion: number;
  conflictingDevices: string[];
  at: string;
}

export interface ReleaseBatch {
  id: string;
  name: string;
  firmware: string;
  rollbackVersion: string;
  groupId: string;
  region: string;
  rolloutPercent: number;
  failureThreshold: number;
  status: BatchStatus;
  priority: number;
  progress: number;
  downloaded: number;
  failed: number;
  queued: number;
  version: number;
  devices: string[];
  lastChangedDevices: string[];
  updatedAt: string;
}

export interface RegionCapacity {
  region: string;
  capacityPerTick: number;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  message: string;
}

export interface ReleaseState {
  groups: DeviceGroup[];
  batches: ReleaseBatch[];
  receipts: DeviceReceipt[];
  models: DeviceModel[];
  capacities: RegionCapacity[];
  actor: Actor;
  conflicts: SubmitConflict[];
  audits: AuditEntry[];
}

/** 发布负责人可跨区；区域运维仅限本区；值班人员不可建批次 */
export function canCreate(actor: Actor, region: string): boolean {
  if (actor.role === 'owner') return true;
  if (actor.role === 'operator') return false;
  return actor.region === region;
}

export function canApprove(actor: Actor, batch: ReleaseBatch): boolean {
  if (actor.role === 'owner') return true;
  if (actor.role === 'operator') return false;
  return actor.region === batch.region;
}

export function canPause(actor: Actor, batch: ReleaseBatch): boolean {
  if (actor.role === 'owner') return true;
  if (actor.role === 'operator') return true;
  return actor.region === batch.region;
}

export function canResume(actor: Actor, batch: ReleaseBatch): boolean {
  if (actor.role === 'owner') return true;
  if (actor.role === 'operator') return false;
  return actor.region === batch.region;
}

/** 跨区紧急回滚仅发布负责人可执行 */
export function canRollback(actor: Actor, batch: ReleaseBatch): boolean {
  if (actor.role === 'owner') return true;
  if (actor.role === 'operator') return false;
  return actor.region === batch.region;
}
