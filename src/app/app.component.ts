import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { TranslocoPipe } from '@jsverse/transloco';
import { approveBatch, createBatch, dismissConflict, dismissReceipt, pauseBatch, reportReceipt, resumeBatch, retryReceipt, setActor, simulateExternalSubmit, startRollback, submitBatch, telemetryTick, updateModelList } from './state/release.actions';
import { selectActor, selectAudits, selectBatches, selectCapacities, selectConflicts, selectFailedReceipts, selectGroups, selectModels, selectPendingVerification, selectReceipts, selectRelease } from './state/release.selectors';
import { canApprove, canCreate, canPause, canResume, canRollback } from './state/release.models';
import type { Actor, DeviceModel, DeviceReceipt, ReleaseBatch } from './state/release.models';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, ScrollingModule, MatButtonModule, MatCardModule, MatChipsModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MatSelectModule, TranslocoPipe],
  template: `
    <header class="hero">
      <div><span class="eyebrow">OTA CONTROL</span><h1>{{ 'title' | transloco }}</h1><p>{{ 'subtitle' | transloco }}</p></div>
      <div class="actor-box">
        <span class="actor-label">当前身份</span>
        <div class="actor-roles">
          <button type="button" *ngFor="let r of roleOptions" [class.active]="actor().role === r.role" (click)="setRole(r.role)">{{ r.label }}</button>
        </div>
        <mat-select *ngIf="actor().role === 'regional_ops'" [ngModel]="actor().region" (ngModelChange)="setRegion($event)">
          <mat-option *ngFor="let r of regions" [value]="r">{{ r }}</mat-option>
        </mat-select>
      </div>
    </header>

    <main>
      <section class="stats">
        <mat-card appearance="outlined"><span>批次数</span><strong>{{ batches().length }}</strong></mat-card>
        <mat-card appearance="outlined"><span>排队设备</span><strong>{{ totalQueued() }}</strong></mat-card>
        <mat-card appearance="outlined"><span>待核对回执</span><strong>{{ pendingVerification().length }}</strong></mat-card>
        <mat-card appearance="outlined"><span>审计记录</span><strong>{{ audits().length }}</strong></mat-card>
      </section>

      <section class="grid">
        <mat-card appearance="outlined">
          <mat-card-header><mat-card-title>{{ 'newBatch' | transloco }}</mat-card-title></mat-card-header>
          <mat-card-content class="form-grid">
            <mat-form-field><mat-label>批次名称</mat-label><input matInput [(ngModel)]="draft.name"></mat-form-field>
            <mat-form-field><mat-label>目标版本</mat-label><input matInput [(ngModel)]="draft.firmware"></mat-form-field>
            <mat-form-field><mat-label>回滚版本</mat-label><input matInput [(ngModel)]="draft.rollbackVersion"></mat-form-field>
            <mat-form-field>
              <mat-label>设备分组</mat-label>
              <mat-select [(ngModel)]="draft.groupId">
                <mat-option *ngFor="let group of groups()" [value]="group.id" [disabled]="!group.compatible">{{ group.name }} · {{ group.region }}</mat-option>
              </mat-select>
            </mat-form-field>
            <mat-form-field><mat-label>灰度比例 %</mat-label><input matInput type="number" [(ngModel)]="draft.rolloutPercent"></mat-form-field>
            <mat-form-field><mat-label>失败阈值 %</mat-label><input matInput type="number" [(ngModel)]="draft.failureThreshold"></mat-form-field>
            <div class="region-note">区域：{{ selectedGroupRegion() }}<span *ngIf="!canCreateFor(selectedGroupRegion())">（当前身份无权在该区域建批次）</span></div>
            <button mat-flat-button color="primary" [disabled]="!canCreateFor(selectedGroupRegion())" (click)="create()">创建兼容批次</button>
          </mat-card-content>
        </mat-card>

        <mat-card appearance="outlined" class="batch-panel">
          <mat-card-header><mat-card-title>{{ 'batches' | transloco }}</mat-card-title></mat-card-header>
          <mat-card-content>
            <cdk-virtual-scroll-viewport itemSize="196" class="viewport">
              <article class="batch" *cdkVirtualFor="let batch of batches()">
                <div class="row">
                  <div><b>{{ batch.name }}</b><small>{{ batch.firmware }} → 回滚 {{ batch.rollbackVersion }} · {{ batch.region }} · v{{ batch.version }}</small></div>
                  <mat-chip-set>
                    <mat-chip highlighted>{{ batch.status }}</mat-chip>
                    <mat-chip *ngIf="batch.queued > 0">排队 {{ batch.queued }}</mat-chip>
                    <mat-chip *ngIf="batch.priority === 0" color="warn" highlighted>紧急优先</mat-chip>
                  </mat-chip-set>
                </div>
                <mat-progress-bar mode="determinate" [value]="batch.progress"></mat-progress-bar>
                <div class="row"><span>{{ batch.downloaded }} 台已更新 · 失败 {{ batch.failed }}<ng-container *ngIf="batch.queued > 0"> · 排队 {{ batch.queued }}</ng-container></span><span>{{ batch.progress }}%</span></div>
                <div class="actions">
                  <button mat-stroked-button *ngIf="batch.status === 'draft'" [disabled]="!canApproveBatch(batch)" (click)="approve(batch.id)">审批</button>
                  <button mat-stroked-button *ngIf="batch.status === 'approved' || batch.status === 'queued'" [disabled]="!canResumeBatch(batch)" (click)="resume(batch.id)">开始发布</button>
                  <button mat-stroked-button *ngIf="batch.status === 'running'" [disabled]="!canPauseBatch(batch)" (click)="pause(batch.id)">暂停</button>
                  <button mat-stroked-button *ngIf="batch.status === 'paused'" [disabled]="!canResumeBatch(batch)" (click)="resume(batch.id)">继续</button>
                  <button mat-flat-button color="warn" [disabled]="batch.status === 'completed' || batch.status === 'rolled_back' || !canRollbackBatch(batch)" (click)="rollback(batch.id)">紧急回滚</button>
                  <button mat-stroked-button (click)="report(batch.id)">补报回执</button>
                  <button mat-stroked-button (click)="submit(batch.id, batch.version)">提交变更</button>
                  <button mat-stroked-button (click)="externalSubmit(batch.id)">模拟他人先提交</button>
                </div>
                <p class="denied" *ngIf="!canOperateBatch(batch) && actor().role !== 'owner'">
                  <mat-icon>lock</mat-icon>
                  <span *ngIf="actor().role === 'operator'">值班人员仅可暂停异常批次</span>
                  <span *ngIf="actor().role === 'regional_ops' && actor().region !== batch.region">跨区批次仅可查看；跨区紧急回滚需发布负责人执行</span>
                </p>
              </article>
            </cdk-virtual-scroll-viewport>
          </mat-card-content>
        </mat-card>
      </section>

      <section class="grid">
        <mat-card appearance="outlined">
          <mat-card-header><mat-card-title>区域容量与排队</mat-card-title></mat-card-header>
          <mat-card-content>
            <div class="region-cap" *ngFor="let cap of capacities()">
              <div class="row"><b>{{ cap.region }}</b><span>容量 {{ cap.capacityPerTick }}/轮 · 排队 {{ queuedInRegion(cap.region) }} 台</span></div>
              <mat-progress-bar mode="determinate" [value]="queuePercent(cap.region)"></mat-progress-bar>
              <div class="mini-chips">
                <span class="mini" *ngFor="let b of batchesInRegion(cap.region)">{{ b.name }} · {{ b.status }}<em *ngIf="b.queued > 0">（排队 {{ b.queued }}）</em></span>
              </div>
            </div>
          </mat-card-content>
        </mat-card>

        <mat-card appearance="outlined">
          <mat-card-header><mat-card-title>设备回执 · 弱网补报</mat-card-title></mat-card-header>
          <mat-card-content>
            <div class="receipt-section" *ngIf="pendingVerification().length">
              <h4>待核对 · 已停批次回执退回</h4>
              <div class="receipt" *ngFor="let r of pendingVerification()">
                <span class="mono">{{ r.deviceId }}</span><span>{{ r.kind }}</span><mat-chip color="warn" highlighted>待核对</mat-chip>
                <button mat-button (click)="dismissReceipt(r.id)">核对完成</button>
              </div>
            </div>
            <div class="receipt-section" *ngIf="failedReceipts().length">
              <h4>补报失败 · 按设备重试</h4>
              <div class="receipt" *ngFor="let r of failedReceipts()">
                <span class="mono">{{ r.deviceId }}</span><span>{{ r.kind }}</span><span>已重试 {{ r.retryCount }} 次</span>
                <button mat-stroked-button (click)="retry(r.id)">重试</button>
              </div>
            </div>
            <div class="receipt-section">
              <h4>最近回执 · 重复只算一次</h4>
              <div class="receipt" *ngFor="let r of countedReceipts">
                <span class="mono">{{ r.deviceId }}</span><span>{{ r.kind }}</span><mat-chip>已计入</mat-chip>
              </div>
              <p class="hint" *ngIf="!countedReceipts.length">暂无回执，等待设备弱网补报</p>
            </div>
          </mat-card-content>
        </mat-card>
      </section>

      <section class="grid">
        <mat-card appearance="outlined">
          <mat-card-header><mat-card-title>型号清单 · 名额重算</mat-card-title></mat-card-header>
          <mat-card-content>
            <p class="hint">型号清单变更后：未下发名额立即重算，已安装设备保留结果</p>
            <table class="model-table">
              <thead><tr><th>型号</th><th>区域</th><th>计划</th><th>已安装</th><th>已下发</th><th>待下发</th><th></th></tr></thead>
              <tbody>
                <tr *ngFor="let m of modelDrafts; let i = index">
                  <td>{{ m.name }}</td>
                  <td>{{ m.region }}</td>
                  <td><input type="number" class="num" [(ngModel)]="m.planned"></td>
                  <td>{{ m.installed }}</td>
                  <td>{{ m.delivered }}</td>
                  <td>{{ pending(m) }}</td>
                  <td><button mat-icon-button (click)="removeModel(i)"><mat-icon>delete</mat-icon></button></td>
                </tr>
              </tbody>
            </table>
            <div class="add-model">
              <input [(ngModel)]="newModelName" placeholder="新型号名称">
              <mat-select [(ngModel)]="newModelRegion"><mat-option *ngFor="let r of regions" [value]="r">{{ r }}</mat-option></mat-select>
              <input type="number" class="num" [(ngModel)]="newModelPlanned" placeholder="计划名额">
              <button mat-stroked-button (click)="addModel()">添加型号</button>
            </div>
            <button mat-flat-button color="primary" (click)="applyModels()">应用型号清单并重算名额</button>
          </mat-card-content>
        </mat-card>

        <mat-card appearance="outlined">
          <mat-card-header><mat-card-title>并发提交冲突</mat-card-title></mat-card-header>
          <mat-card-content>
            <p class="hint" *ngIf="!conflicts().length">两人同时提交同一批设备时，先到的一版生效，后到者看到冲突设备</p>
            <div class="conflict" *ngFor="let c of conflicts()">
              <div class="row"><b>{{ c.batchName }}</b><span>{{ c.actor }} · v{{ c.attemptedVersion }} → v{{ c.currentVersion }}</span></div>
              <div class="chips"><mat-chip *ngFor="let d of c.conflictingDevices" color="warn" highlighted>{{ d }}</mat-chip></div>
              <button mat-button (click)="dismiss(c.id)">知道了</button>
            </div>
          </mat-card-content>
        </mat-card>
      </section>

      <mat-card appearance="outlined">
        <mat-card-header><mat-card-title>{{ 'audit' | transloco }}</mat-card-title></mat-card-header>
        <mat-card-content class="audit-list"><div class="audit" *ngFor="let item of audits()"><span>{{ item.at | date:'MM-dd HH:mm:ss' }}</span><b>{{ item.actor }}</b><p>{{ item.message }}</p></div></mat-card-content>
      </mat-card>
    </main>
  `,
  styles: [`
    :host { display:block; min-height:100vh; background:#edf4f5; }
    .hero { padding:36px max(24px,6vw) 28px; color:#fff; background:linear-gradient(125deg,#053b46,#0f6f6c 62%,#2a9d8f); display:flex; justify-content:space-between; gap:24px; align-items:end; flex-wrap:wrap; }
    .hero h1 { margin:8px 0; font-size:clamp(30px,4vw,52px); letter-spacing:-.04em; } .hero p { margin:0; opacity:.8 } .eyebrow { letter-spacing:.2em; font-size:12px; opacity:.7 }
    .actor-box { display:flex; flex-direction:column; gap:8px; align-items:flex-end; }
    .actor-label { font-size:12px; opacity:.7; letter-spacing:.1em; }
    .actor-roles { display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end; }
    .actor-roles button { border:1px solid rgba(255,255,255,.4); background:transparent; color:#fff; padding:6px 12px; border-radius:999px; cursor:pointer; font-size:13px; }
    .actor-roles button.active { background:#fff; color:#0f6f6c; font-weight:600; }
    .actor-box mat-select { width:200px; }
    main { padding:22px max(18px,5vw) 60px; display:grid; gap:20px; } .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; } .stats span { display:block;color:#607d86 } .stats strong { font-size:30px }
    .grid { display:grid; grid-template-columns:minmax(300px,.8fr) minmax(420px,1.2fr); gap:20px; } .form-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; padding-top:16px }
    .region-note { grid-column:1/-1; font-size:13px; color:#607d86; } .region-note span { color:#c62828; }
    .viewport { height:620px; } .batch { min-height:180px; border-bottom:1px solid #dde7e8; padding:12px 4px; display:grid; gap:10px } .row { display:flex;justify-content:space-between;gap:12px;align-items:center } small { display:block;color:#71858c } .actions { display:flex;gap:8px;flex-wrap:wrap }
    .denied { display:flex; align-items:center; gap:6px; margin:0; font-size:12px; color:#b26a00; background:#fff4e5; padding:6px 10px; border-radius:6px; } .denied mat-icon { font-size:16px; width:16px; height:16px; }
    .audit-list { max-height:320px; overflow:auto } .audit { display:grid;grid-template-columns:120px 110px 1fr;border-bottom:1px solid #e5ecee;padding:10px 4px } .audit p { margin:0 }
    .hint { font-size:13px; color:#607d86; margin:0 0 10px; }
    .region-cap { padding:10px 0; border-bottom:1px solid #e5ecee; display:grid; gap:6px; }
    .mini-chips { display:flex; flex-wrap:wrap; gap:6px; } .mini { font-size:12px; background:#eef3f4; padding:3px 8px; border-radius:999px; color:#455a64; } .mini em { color:#c62828; font-style:normal; }
    .receipt-section { margin-bottom:14px; } .receipt-section h4 { margin:8px 0; font-size:13px; color:#0f6f6c; }
    .receipt { display:flex; align-items:center; gap:10px; padding:6px 4px; border-bottom:1px solid #eef2f3; font-size:13px; } .mono { font-family:ui-monospace, monospace; color:#37474f; }
    .model-table { width:100%; border-collapse:collapse; font-size:13px; } .model-table th { text-align:left; color:#607d86; font-weight:500; padding:6px 4px; border-bottom:1px solid #dde7e8; } .model-table td { padding:6px 4px; border-bottom:1px solid #eef2f3; } .model-table .num { width:80px; }
    .add-model { display:flex; gap:8px; align-items:center; margin:12px 0; flex-wrap:wrap; } .add-model input { border:1px solid #cfd8dc; border-radius:6px; padding:6px 8px; font-size:13px; } .add-model .num { width:90px; } .add-model mat-select { width:140px; }
    .conflict { padding:10px 0; border-bottom:1px solid #eef2f3; display:grid; gap:6px; } .chips { display:flex; flex-wrap:wrap; gap:6px; }
    @media(max-width:900px){ .hero{align-items:flex-start;flex-direction:column}.stats{grid-template-columns:1fr 1fr}.grid{grid-template-columns:1fr}.form-grid{grid-template-columns:1fr}.audit{grid-template-columns:1fr}.viewport{height:400px} }
  `]
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly store = inject(Store);
  readonly actor = toSignal(this.store.select(selectActor), { requireSync: true });
  readonly groups = toSignal(this.store.select(selectGroups), { requireSync: true });
  readonly batches = toSignal(this.store.select(selectBatches), { requireSync: true });
  readonly audits = toSignal(this.store.select(selectAudits), { requireSync: true });
  readonly capacities = toSignal(this.store.select(selectCapacities), { requireSync: true });
  readonly receipts = toSignal(this.store.select(selectReceipts), { requireSync: true });
  readonly models = toSignal(this.store.select(selectModels), { requireSync: true });
  readonly conflicts = toSignal(this.store.select(selectConflicts), { requireSync: true });
  readonly pendingVerification = toSignal(this.store.select(selectPendingVerification), { requireSync: true });
  readonly failedReceipts = toSignal(this.store.select(selectFailedReceipts), { requireSync: true });

  private timer?: number;
  draft = { name: '', firmware: '3.0.0', rollbackVersion: '2.9.2', groupId: 'g-edge', rolloutPercent: 10, failureThreshold: 3 };
  modelDrafts: DeviceModel[] = [];
  newModelName = '';
  newModelRegion = '华东';
  newModelPlanned = 100;

  readonly roleOptions = [
    { role: 'owner' as const, label: '发布负责人（全部区域）' },
    { role: 'regional_ops' as const, label: '区域运维（仅本区）' },
    { role: 'operator' as const, label: '值班人员（仅暂停）' }
  ];
  readonly regions = ['华东', '华南', '新加坡'];

  ngOnInit() {
    this.timer = window.setInterval(() => this.store.dispatch(telemetryTick()), 1400);
    this.modelDrafts = this.models().map((item) => ({ ...item }));
    this.store.select(selectRelease).subscribe((state) => localStorage.setItem('firmware-release-v2', JSON.stringify(state)));
  }
  ngOnDestroy() { if (this.timer) window.clearInterval(this.timer); }

  setRole(role: Actor['role']) {
    const current = this.actor();
    const name = role === 'owner' ? '发布负责人' : role === 'regional_ops' ? `区域运维·${current.region}` : '值班人员';
    this.store.dispatch(setActor({ actor: { role, region: current.region, name } }));
  }
  setRegion(region: string) {
    this.store.dispatch(setActor({ actor: { role: 'regional_ops', region, name: `区域运维·${region}` } }));
  }

  selectedGroupRegion() { return this.groups().find((g) => g.id === this.draft.groupId)?.region ?? '华东'; }
  canCreateFor(region: string) { return canCreate(this.actor(), region); }
  canApproveBatch(b: ReleaseBatch) { return canApprove(this.actor(), b); }
  canPauseBatch(b: ReleaseBatch) { return canPause(this.actor(), b); }
  canResumeBatch(b: ReleaseBatch) { return canResume(this.actor(), b); }
  canRollbackBatch(b: ReleaseBatch) { return canRollback(this.actor(), b); }
  canOperateBatch(b: ReleaseBatch) { const a = this.actor(); return canApprove(a, b) || canPause(a, b) || canResume(a, b) || canRollback(a, b); }

  create() {
    if (!this.draft.name || !this.draft.firmware || !this.draft.groupId) return;
    const region = this.selectedGroupRegion();
    if (!canCreate(this.actor(), region)) return;
    const batch: ReleaseBatch = {
      ...this.draft,
      region,
      id: crypto.randomUUID(),
      status: 'draft',
      priority: 10,
      progress: 0,
      downloaded: 0,
      failed: 0,
      queued: 0,
      version: 1,
      devices: Array.from({ length: 10 }, (_, i) => `dev-${this.draft.groupId}-${String(i + 1).padStart(3, '0')}`),
      lastChangedDevices: [],
      updatedAt: new Date().toISOString()
    };
    this.store.dispatch(createBatch({ batch }));
    this.draft = { ...this.draft, name: '' };
  }
  approve(id: string) { this.store.dispatch(approveBatch({ id, actor: this.actor() })); }
  pause(id: string) { this.store.dispatch(pauseBatch({ id, actor: this.actor() })); }
  resume(id: string) { this.store.dispatch(resumeBatch({ id, actor: this.actor() })); }
  rollback(id: string) { this.store.dispatch(startRollback({ id, actor: this.actor() })); }
  submit(id: string, baseVersion: number) { this.store.dispatch(submitBatch({ id, baseVersion, actor: this.actor() })); }
  externalSubmit(id: string) { this.store.dispatch(simulateExternalSubmit({ id })); }
  retry(id: string) { this.store.dispatch(retryReceipt({ id })); }
  dismiss(id: string) { this.store.dispatch(dismissConflict({ id })); }
  dismissReceipt(id: string) { this.store.dispatch(dismissReceipt({ id })); }
  report(batchId: string) {
    const batch = this.batches().find((b) => b.id === batchId);
    if (!batch) return;
    const deviceId = batch.devices[Math.floor(Math.random() * batch.devices.length)];
    const kinds = ['downloaded', 'installed', 'failed'] as const;
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const receipt: DeviceReceipt = { id: crypto.randomUUID(), batchId, deviceId, region: batch.region, kind, status: 'counted', retryCount: 0, reportedAt: new Date().toISOString() };
    this.store.dispatch(reportReceipt({ receipt }));
  }

  pending(m: DeviceModel) { return Math.max(0, m.planned - m.installed - m.delivered); }
  removeModel(i: number) { this.modelDrafts = this.modelDrafts.filter((_, idx) => idx !== i); }
  addModel() {
    if (!this.newModelName) return;
    const groupId = this.groups().find((g) => g.region === this.newModelRegion)?.id ?? '';
    this.modelDrafts = [...this.modelDrafts, { id: crypto.randomUUID(), name: this.newModelName, region: this.newModelRegion, groupId, planned: this.newModelPlanned, installed: 0, delivered: 0 }];
    this.newModelName = '';
  }
  applyModels() { this.store.dispatch(updateModelList({ models: this.modelDrafts.map((m) => ({ ...m })) })); }

  totalQueued() { return this.batches().reduce((sum, b) => sum + b.queued, 0); }
  queuedInRegion(region: string) { return this.batches().filter((b) => b.region === region).reduce((sum, b) => sum + b.queued, 0); }
  batchesInRegion(region: string) { return this.batches().filter((b) => b.region === region && !['draft', 'completed', 'rolled_back'].includes(b.status)); }
  queuePercent(region: string) {
    const cap = this.capacities().find((c) => c.region === region)?.capacityPerTick ?? 1;
    return Math.min(100, this.queuedInRegion(region) / cap * 100);
  }

  get countedReceipts() { return this.receipts().filter((r) => r.status === 'counted').slice(0, 8); }
}
