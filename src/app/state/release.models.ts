export type Role = 'owner' | 'ops';
export type BatchStatus = 'draft' | 'approved' | 'running' | 'paused' | 'completed' | 'rolled_back';
export type DeviceState = 'idle' | 'claimed' | 'dispatching' | 'installed' | 'failed' | 'rolling_back';
export type SlotKind = 'rollout' | 'rollback';
export type ReceiptKind = SlotKind;
export type ReceiptStatus = 'accepted' | 'duplicate' | 'retry_failed' | 'pending_review';

export interface Actor {
  role: Role;
  name: string;
  region: string | null; // 发布负责人为 null，区域运维绑定本区
}

export interface Gateway {
  id: string;
  name: string;
  region: string;
  model: string;
}

export interface RegionCapacity {
  region: string;
  /** 同时下发（含回滚）设备数上限 */
  capacity: number;
}

export interface Device {
  id: string;
  name: string;
  gatewayId: string;
  region: string;
  model: string;
  state: DeviceState;
  /** 设备级下发进度，弱网下推进更慢，用于模拟弱网补报 */
  weakNetwork: boolean;
  progress: number;
  /** 成功安装的批次；已装上的结果在型号清单变更后保留 */
  installedBatchId: string | null;
  installedVersion: string | null;
  /** 已产生过安装结果（成功或失败）的批次集合：型号重算名额时不再计入 */
  resultBatchIds: string[];
}

export interface ReleaseBatch {
  id: string;
  name: string;
  firmware: string;
  rollbackVersion: string;
  region: string;
  /** 允许的型号清单；清单变化后未下发名额立即重算，已装上的保留 */
  models: string[];
  rolloutPercent: number;
  failureThreshold: number;
  status: BatchStatus;
  /** 最近一次按型号清单 + 灰度比例重算后的名额 */
  quota: number;
  seq: number;
  createdAt: string;
  updatedAt: string;
}

/** 区域下发队列中的一个下发位（单设备） */
export interface QueueSlot {
  id: string;
  batchId: string;
  deviceId: string;
  region: string;
  kind: SlotKind;
  /** 0 = 紧急回滚（始终在队首），1 = 普通发布 */
  priority: number;
  /** 同优先级 FIFO 的序号 */
  seq: number;
  enqueuedAt: string;
}

/** 设备→批次的占用关系，先到先得（乐观锁） */
export interface DeviceClaim {
  deviceId: string;
  batchId: string;
}

export interface Receipt {
  id: string;
  /** 同设备同批次同结果只算一次的去重键 */
  key: string;
  batchId: string;
  deviceId: string;
  region: string;
  kind: ReceiptKind;
  outcome: 'success' | 'failure';
  status: ReceiptStatus;
  weakNetwork: boolean;
  attempts: number;
  at: string;
  note?: string;
}

export interface ConflictPanel {
  id: string;
  actor: string;
  batchId: string;
  batchName: string;
  deviceIds: string[];
  at: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  message: string;
}

export interface ReleaseState {
  version: 2;
  models: string[];
  regions: RegionCapacity[];
  gateways: Gateway[];
  devices: Device[];
  batches: ReleaseBatch[];
  slots: QueueSlot[];
  claims: DeviceClaim[];
  receipts: Receipt[];
  conflicts: ConflictPanel[];
  /** 待补报的弱网回执：按设备重试 */
  pendingReports: { key: string; batchId: string; deviceId: string; kind: ReceiptKind; outcome: 'success' | 'failure'; weakNetwork: boolean; attempts: number }[];
  audits: AuditEntry[];
  seqCounter: number;
  notice: string | null;
}
