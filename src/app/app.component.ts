import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  approveBatch, clearNotice, createBatch, dismissConflict, enqueueDevices, pauseBatch,
  reconcileReceipt, resumeBatch, rollbackBatch, telemetryTick, updateBatchModels
} from './state/release.actions';
import {
  selectAudits, selectBatchViews, selectClaims, selectConflicts, selectDevices,
  selectModels, selectNotice, selectPendingReports, selectQueueView, selectReceipts,
  selectRegionUsage, selectRegions
} from './state/release.selectors';
import type { Actor, BatchStatus, Device, Role } from './state/release.models';

const STATUS_LABEL: Record<BatchStatus, string> = {
  draft: '草稿', approved: '已审批', running: '发布中', paused: '已暂停', completed: '已完成', rolled_back: '已回滚'
};
const DEVICE_STATE_LABEL: Record<Device['state'], string> = {
  idle: '空闲', claimed: '已占用排队', dispatching: '下发中', installed: '已装上', failed: '安装失败', rolling_back: '回滚中'
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, ScrollingModule, MatButtonModule, MatCardModule, MatChipsModule, MatFormFieldModule, MatInputModule, MatProgressBarModule, MatSelectModule, MatTableModule, TranslocoPipe],
  template: `
    <header class="hero">
      <div>
        <span class="eyebrow">OTA CONTROL · REGION ISOLATED</span>
        <h1>{{ 'title' | transloco }}</h1>
        <p>区域隔离发布 · 容量排队 · 紧急回滚插队 · 弱网补报去重 · 型号名额重算</p>
      </div>
      <div class="actor-box">
        <mat-form-field appearance="outline" class="role-field">
          <mat-label>当前角色</mat-label>
          <mat-select [ngModel]="actor().role" (ngModelChange)="setRole($event)">
            <mat-option value="owner">发布负责人（可跨区回滚）</mat-option>
            <mat-option value="ops">区域运维（仅限本区）</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" class="role-field" *ngIf="actor().role === 'ops'">
          <mat-label>负责区域</mat-label>
          <mat-select [ngModel]="actor().region" (ngModelChange)="setRegion($event)">
            <mat-option *ngFor="let r of regions$ | async" [value]="r.region">{{ r.region }}</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-chip-set>
          <mat-chip highlighted>{{ actor().name }}<span *ngIf="actor().region"> · {{ actor().region }}</span></mat-chip>
        </mat-chip-set>
      </div>
    </header>

    <main>
      <div class="notice" *ngIf="notice$ | async as notice">
        <span>{{ notice }}</span>
        <button mat-stroked-button (click)="clearNotice()">知道了</button>
      </div>

      <section class="stats">
        <mat-card appearance="outlined"><span>发布批次</span><strong>{{ (batchViews$ | async)?.length ?? 0 }}</strong></mat-card>
        <mat-card appearance="outlined"><span>待核对回执</span><strong>{{ pendingReviewCount() }}</strong></mat-card>
        <mat-card appearance="outlined"><span>排队设备</span><strong>{{ (queue$ | async)?.length ?? 0 }}</strong></mat-card>
        <mat-card appearance="outlined"><span>弱网补报重试中</span><strong>{{ (pending$ | async)?.length ?? 0 }}</strong></mat-card>
      </section>

      <!-- 区域容量 -->
      <section class="capacity-grid">
        <mat-card appearance="outlined" *ngFor="let usage of usage$ | async">
          <div class="cap-head"><b>{{ usage.region }}</b>
            <span class="cap-num">{{ usage.rolloutInFlight + usage.rollbackInFlight }}/{{ usage.capacity }}</span>
          </div>
          <mat-progress-bar mode="determinate"
            [value]="usage.capacity ? (usage.rolloutInFlight + usage.rollbackInFlight) / usage.capacity * 100 : 0"
            [color]="usage.rolloutInFlight + usage.rollbackInFlight >= usage.capacity ? 'warn' : 'primary'"></mat-progress-bar>
          <div class="cap-detail">
            <span>普通下发 {{ usage.rolloutInFlight }}</span>
            <span class="rb" *ngIf="usage.rollbackInFlight > 0">回滚插队 {{ usage.rollbackInFlight }}</span>
            <span>排队 {{ usage.queued }}</span>
          </div>
        </mat-card>
      </section>

      <section class="grid">
        <!-- 创建批次 -->
        <mat-card appearance="outlined">
          <mat-card-header><mat-card-title>{{ 'newBatch' | transloco }}</mat-card-title>
            <mat-card-subtitle>同设备并发提交时先到先得，后到者只看到冲突设备</mat-card-subtitle>
          </mat-card-header>
          <mat-card-content class="form-grid">
            <mat-form-field><mat-label>批次名称</mat-label><input matInput [(ngModel)]="draft.name"></mat-form-field>
            <mat-form-field><mat-label>目标版本</mat-label><input matInput [(ngModel)]="draft.firmware"></mat-form-field>
            <mat-form-field><mat-label>回滚版本</mat-label><input matInput [(ngModel)]="draft.rollbackVersion"></mat-form-field>
            <mat-form-field>
              <mat-label>发布区域</mat-label>
              <mat-select [(ngModel)]="draft.region">
                <mat-option *ngFor="let r of regions$ | async" [value]="r.region">{{ r.region }}（容量 {{ r.capacity }}）</mat-option>
              </mat-select>
            </mat-form-field>
            <mat-form-field>
              <mat-label>兼容型号清单</mat-label>
              <mat-select [(ngModel)]="draft.models" multiple>
                <mat-option *ngFor="let m of models$ | async" [value]="m">{{ m }}</mat-option>
              </mat-select>
            </mat-form-field>
            <div class="inline-num">
              <mat-form-field><mat-label>灰度比例 %</mat-label><input matInput type="number" [(ngModel)]="draft.rolloutPercent"></mat-form-field>
              <mat-form-field><mat-label>失败阈值 %</mat-label><input matInput type="number" [(ngModel)]="draft.failureThreshold"></mat-form-field>
            </div>
            <mat-form-field class="full">
              <mat-label>提交设备（本区 + 型号匹配；已占用设备会产生冲突面板）</mat-label>
              <mat-select [(ngModel)]="draft.deviceIds" multiple>
                <mat-option *ngFor="let device of devices$ | async" [value]="device.id"
                  [disabled]="device.region !== draft.region || !draft.models.includes(device.model)">
                  {{ device.name }} · {{ device.region }} · {{ device.model }}
                  <span class="tag weak" *ngIf="device.weakNetwork">弱网</span>
                  <span class="tag busy" *ngIf="isClaimed(device)">已占用</span>
                  <span class="tag done" *ngIf="device.installedBatchId">已装</span>
                </mat-option>
              </mat-select>
            </mat-form-field>
            <div class="actions full">
              <button mat-flat-button color="primary" (click)="create()">创建批次</button>
              <button mat-stroked-button color="accent" (click)="createConcurrent()"
                title="模拟两人同时提交当前所选设备：先到一版生效，后到一版只得到冲突设备">
                模拟两人同时提交
              </button>
              <small class="hint">名额 = 符合型号清单设备数 × 灰度比例（已装上的不占名额）；超出区域容量的设备自动排队</small>
            </div>
          </mat-card-content>
        </mat-card>

        <!-- 批次列表 -->
        <mat-card appearance="outlined" class="batch-panel">
          <mat-card-header><mat-card-title>{{ 'batches' | transloco }}</mat-card-title></mat-card-header>
          <mat-card-content>
            <cdk-virtual-scroll-viewport itemSize="268" class="viewport">
              <article class="batch" *cdkVirtualFor="let view of batchViews$ | async">
                <div class="row">
                  <div>
                    <b>{{ view.name }}</b>
                    <small>{{ view.region }} · {{ view.firmware }} → 回滚 {{ view.rollbackVersion }} · 型号 {{ view.models.join('/') }}</small>
                  </div>
                  <mat-chip [color]="view.status === 'paused' || view.status === 'rolled_back' ? 'warn' : 'primary'" highlighted>
                    {{ statusLabel(view.status) }}
                  </mat-chip>
                </div>
                <mat-progress-bar mode="determinate" [value]="view.progress"></mat-progress-bar>
                <div class="row metrics">
                  <span>名额 <b>{{ view.quota }}</b></span>
                  <span>已装上 <b>{{ view.installed }}</b></span>
                  <span>失败 <b>{{ view.failed }}</b></span>
                  <span>下发中 <b>{{ view.dispatching }}</b></span>
                  <span>排队 <b>{{ view.queued }}</b></span>
                  <span>占用待发 <b>{{ view.claimed }}</b></span>
                  <span class="rb" *ngIf="view.pendingReview">待核对 <b>{{ view.pendingReview }}</b></span>
                  <span>{{ view.progress }}%</span>
                </div>

                <div class="model-edit">
                  <span>型号清单（变更后未下发名额立即重算）：</span>
                  <mat-form-field appearance="outline" class="model-select">
                    <mat-select [ngModel]="view.models" multiple (ngModelChange)="changeModels(view.id, $event)">
                      <mat-option *ngFor="let m of models$ | async" [value]="m">{{ m }}</mat-option>
                    </mat-select>
                  </mat-form-field>
                </div>

                <div class="actions">
                  <button mat-stroked-button *ngIf="view.status === 'draft'" (click)="approve(view.id)"
                    [disabled]="!can(view.region)" [title]="permReason(view.region)">{{ can(view.region) ? '审批' : '跨区无权审批' }}</button>
                  <button mat-stroked-button *ngIf="view.status === 'approved'" (click)="resume(view.id)"
                    [disabled]="!can(view.region)" [title]="permReason(view.region)">开始发布</button>
                  <button mat-stroked-button *ngIf="view.status === 'running'" (click)="pause(view.id)"
                    [disabled]="!can(view.region)" [title]="permReason(view.region)">暂停</button>
                  <button mat-stroked-button *ngIf="view.status === 'paused'" (click)="resume(view.id)"
                    [disabled]="!can(view.region)" [title]="permReason(view.region)">继续（重排队）</button>
                  <button mat-flat-button color="warn"
                    *ngIf="view.status !== 'completed' && view.status !== 'rolled_back' && view.status !== 'draft'"
                    (click)="rollback(view.id)" [disabled]="!can(view.region)"
                    [title]="actor().role === 'ops' && !can(view.region) ? '跨区紧急回滚仅发布负责人可执行' : '回滚立即插队并让其他批次重排'">
                    紧急回滚{{ actor().role === 'ops' && !can(view.region) ? '（跨区需发布负责人）' : '' }}
                  </button>
                </div>

                <div class="enroll" *ngIf="view.status === 'running'">
                  <mat-form-field appearance="outline" class="enroll-select">
                    <mat-label>追加本区设备（超额自动排队）</mat-label>
                    <mat-select multiple [ngModel]="enrollSelection[view.id] || []"
                      (ngModelChange)="setEnroll(view.id, $event)">
                      <mat-option *ngFor="let device of enrollCandidates(view.id, view.region, view.models)" [value]="device.id">
                        {{ device.name }} · {{ device.model }} · {{ deviceStateLabel(device.state) }}
                        <span class="tag weak" *ngIf="device.weakNetwork">弱网</span>
                      </mat-option>
                    </mat-select>
                  </mat-form-field>
                  <button mat-stroked-button color="primary"
                    (click)="enroll(view.id)" [disabled]="!can(view.region) || !(enrollSelection[view.id]?.length)">
                    提交设备
                  </button>
                </div>
              </article>
            </cdk-virtual-scroll-viewport>
          </mat-card-content>
        </mat-card>
      </section>

      <!-- 下发队列 -->
      <mat-card appearance="outlined">
        <mat-card-header><mat-card-title>区域下发队列</mat-card-title>
          <mat-card-subtitle>紧急回滚始终在队首；同优先级按提交时间 FIFO；容量释放后自动补位</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
          <div class="queue" *ngIf="(queue$ | async)?.length; else emptyQueue">
            <div class="queue-row" *ngFor="let slot of queue$ | async"
              [class.rollback]="slot.kind === 'rollback'">
              <span class="pos">#{{ slot.seq }}</span>
              <mat-chip [highlighted]="slot.kind === 'rollback'" [color]="slot.kind === 'rollback' ? 'warn' : 'primary'">
                {{ slot.kind === 'rollback' ? '紧急回滚' : '普通发布' }}
              </mat-chip>
              <b>{{ slot.deviceName }}</b>
              <span>{{ slot.batchName }}</span>
              <span class="dim">{{ slot.region }}</span>
            </div>
          </div>
          <ng-template #emptyQueue><p class="dim">队列为空</p></ng-template>
        </mat-card-content>
      </mat-card>

      <section class="lower-grid">
        <!-- 回执 -->
        <mat-card appearance="outlined">
          <mat-card-header><mat-card-title>设备回执</mat-card-title>
            <mat-card-subtitle>弱网补报按设备重试，重复回执只算一次；已停批次的回执退回待核对</mat-card-subtitle>
          </mat-card-header>
          <mat-card-content>
            <div class="pending-reports" *ngIf="(pending$ | async)?.length">
              <h4>弱网补报重试（按设备）</h4>
              <div class="pr-row" *ngFor="let p of pending$ | async">
                <span class="tag weak">弱网</span>
                <b>{{ deviceName(p.deviceId) }}</b>
                <span>{{ p.kind === 'rollback' ? '回滚' : '安装' }}{{ p.outcome === 'success' ? '成功' : '失败' }}</span>
                <span class="dim">已尝试 {{ p.attempts }} 次</span>
              </div>
            </div>
            <div class="receipt review" *ngFor="let r of receipts$ | async | slice:0:30">
              <div class="receipt-main">
                <span class="tag weak" *ngIf="r.weakNetwork">弱网补报</span>
                <b>{{ deviceName(r.deviceId) }}</b>
                <span>{{ r.kind === 'rollback' ? '回滚' : '安装' }}{{ r.outcome === 'success' ? '成功' : '失败' }}</span>
                <mat-chip highlighted [color]="receiptColor(r.status)">{{ receiptStatusLabel(r.status) }}</mat-chip>
                <span class="dim">第 {{ r.attempts }} 次</span>
              </div>
              <div class="actions" *ngIf="r.status === 'pending_review'">
                <small class="hint">{{ r.note }}</small>
                <button mat-stroked-button color="primary" (click)="review(r.id, true)">核对无误，入账</button>
                <button mat-stroked-button color="warn" (click)="review(r.id, false)">驳回，按设备重试</button>
              </div>
            </div>
          </mat-card-content>
        </mat-card>

        <!-- 冲突面板 -->
        <mat-card appearance="outlined">
          <mat-card-header><mat-card-title>并发提交冲突</mat-card-title>
            <mat-card-subtitle>同一批设备只让先到的一版生效，后到者在此看到冲突设备</mat-card-subtitle>
          </mat-card-header>
          <mat-card-content>
            <div class="conflict" *ngFor="let panel of conflicts$ | async">
              <div class="row">
                <div><b>{{ panel.batchName }}</b><small>后到提交人：{{ panel.actor }} · {{ panel.at | date:'MM-dd HH:mm:ss' }}</small></div>
                <button mat-stroked-button (click)="dismiss(panel.id)">关闭</button>
              </div>
              <div class="conflict-devices">
                <mat-chip *ngFor="let id of panel.deviceIds" highlighted color="warn">{{ deviceName(id) }}</mat-chip>
              </div>
            </div>
            <p class="dim" *ngIf="!(conflicts$ | async)?.length">暂无冲突</p>
          </mat-card-content>
        </mat-card>
      </section>

      <mat-card appearance="outlined">
        <mat-card-header><mat-card-title>{{ 'audit' | transloco }}</mat-card-title></mat-card-header>
        <mat-card-content class="audit-list">
          <div class="audit" *ngFor="let item of audits$ | async | slice:0:40">
            <span>{{ item.at | date:'MM-dd HH:mm:ss' }}</span><b>{{ item.actor }}</b><p>{{ item.message }}</p>
          </div>
        </mat-card-content>
      </mat-card>
    </main>
  `,
  styles: [`
    :host { display:block; min-height:100vh; background:#edf4f5; }
    .hero { padding:30px max(24px,6vw) 24px; color:#fff; background:linear-gradient(125deg,#053b46,#0f6f6c 62%,#2a9d8f); display:flex; justify-content:space-between; gap:24px; align-items:flex-end; flex-wrap:wrap; }
    .hero h1 { margin:8px 0; font-size:clamp(26px,3.4vw,44px); letter-spacing:-.04em; } .hero p { margin:0; opacity:.85 }
    .eyebrow { letter-spacing:.2em; font-size:12px; opacity:.7 }
    .actor-box { display:flex; gap:10px; align-items:center; flex-wrap:wrap; min-width:300px; max-width:480px; }
    .role-field { width:200px; } :ng-deep .role-field .mat-mdc-form-field-subscript-space { display:none; }
    main { padding:20px max(18px,5vw) 60px; display:grid; gap:18px; }
    .notice { display:flex; justify-content:space-between; align-items:center; gap:12px; background:#fff4e5; border:1px solid #f0b95c; color:#7a4f00; padding:10px 16px; border-radius:10px; }
    .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; }
    .stats .mat-mdc-card { padding:14px 18px; } .stats span { display:block;color:#607d86 } .stats strong { font-size:28px }
    .capacity-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }
    .cap-head { display:flex; justify-content:space-between; margin-bottom:8px; } .cap-num { color:#0f6f6c; font-weight:700; }
    .cap-detail { display:flex; gap:14px; margin-top:8px; font-size:12px; color:#607d86; flex-wrap:wrap; } .rb { color:#c62828; font-weight:600; }
    .grid { display:grid; grid-template-columns:minmax(320px,.9fr) minmax(440px,1.1fr); gap:18px; }
    .form-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; padding-top:14px; }
    .inline-num { display:contents; } .full { grid-column:1 / -1; }
    .hint { color:#8a9ba2; font-size:12px; }
    .viewport { height:560px; } .batch { min-height:252px; border-bottom:1px solid #dde7e8; padding:14px 4px; display:grid; gap:10px; }
    .row { display:flex;justify-content:space-between;gap:12px;align-items:center } small { display:block;color:#71858c }
    .metrics { font-size:13px; color:#476068; flex-wrap:wrap; gap:8px 16px; } .metrics b { color:#0f6f6c; }
    .actions { display:flex;gap:8px;flex-wrap:wrap;align-items:center; }
    .model-edit { display:flex; align-items:center; gap:10px; font-size:12px; color:#607d86; flex-wrap:wrap; }
    .model-select { width:260px; }
    .enroll { display:flex; gap:10px; align-items:center; } .enroll-select { flex:1; }
    .tag { display:inline-block; font-size:11px; padding:0 6px; border-radius:8px; margin-left:6px; }
    .tag.weak { background:#fdecec; color:#c62828; } .tag.busy { background:#fff3e0; color:#e65100; } .tag.done { background:#e8f5e9; color:#2e7d32; }
    .queue { display:grid; gap:6px; max-height:260px; overflow:auto; }
    .queue-row { display:flex; align-items:center; gap:12px; padding:6px 8px; border-radius:8px; background:#f6fafb; }
    .queue-row.rollback { background:#fdecea; border:1px solid #f5c2bc; }
    .pos { width:44px; color:#90a4a9; font-size:12px; } .dim { color:#90a4a9; font-size:12px; }
    .lower-grid { display:grid; grid-template-columns:1.2fr .8fr; gap:18px; }
    .pending-reports { background:#fff8f0; border:1px solid #f0d9b5; border-radius:8px; padding:8px 12px; margin-bottom:10px; }
    .pending-reports h4 { margin:6px 0; font-size:13px; } .pr-row { display:flex; gap:10px; align-items:center; padding:4px 0; font-size:13px; flex-wrap:wrap; }
    .receipt { border-bottom:1px solid #e5ecee; padding:8px 2px; display:grid; gap:6px; }
    .receipt.review .receipt-main { align-items:center; } .receipt-main { display:flex; gap:10px; align-items:center; flex-wrap:wrap; font-size:13px; }
    .conflict { border:1px solid #f5c2bc; background:#fdf6f5; border-radius:8px; padding:10px; margin-bottom:10px; }
    .conflict-devices { display:flex; gap:6px; flex-wrap:wrap; margin-top:8px; }
    .audit-list { max-height:340px; overflow:auto } .audit { display:grid;grid-template-columns:130px 110px 1fr;border-bottom:1px solid #e5ecee;padding:9px 4px;font-size:13px } .audit p { margin:0 }
    @media(max-width:960px){ .hero{align-items:flex-start;flex-direction:column}.stats{grid-template-columns:1fr 1fr}.capacity-grid{grid-template-columns:1fr}.grid,.lower-grid{grid-template-columns:1fr}.form-grid{grid-template-columns:1fr}.audit{grid-template-columns:1fr}.viewport{height:440px} }
  `]
})
export class AppComponent implements OnInit, OnDestroy {
  readonly store = inject(Store);
  readonly regions$ = this.store.select(selectRegions);
  readonly models$ = this.store.select(selectModels);
  readonly devices$ = this.store.select(selectDevices);
  readonly batchViews$ = this.store.select(selectBatchViews);
  readonly queue$ = this.store.select(selectQueueView);
  readonly receipts$ = this.store.select(selectReceipts);
  readonly conflicts$ = this.store.select(selectConflicts);
  readonly audits$ = this.store.select(selectAudits);
  readonly pending$ = this.store.select(selectPendingReports);
  readonly notice$ = this.store.select(selectNotice);
  readonly usage$ = this.store.select(selectRegionUsage);
  private readonly claimedIds = signal<Set<string>>(new Set());

  readonly actor = signal<Actor>({ role: 'owner', name: '发布负责人', region: null });
  readonly pendingReviewCount = signal(0);
  draft = {
    name: '', firmware: '3.1.0', rollbackVersion: '3.0.0', region: '华东',
    models: ['GW-X100', 'GW-X200'], rolloutPercent: 40, failureThreshold: 30, deviceIds: [] as string[]
  };
  enrollSelection: Record<string, string[]> = {};
  private deviceMap = new Map<string, Device>();
  private timer?: number;

  ngOnInit() {
    this.timer = window.setInterval(() => this.store.dispatch(telemetryTick()), 1500);
    this.devices$.subscribe((devices) => {
      this.deviceMap = new Map(devices.map((device) => [device.id, device]));
    });
    this.store.select(selectClaims).subscribe((claims) => this.claimedIds.set(new Set(claims.map((claim) => claim.deviceId))));
    this.store.select(selectReceipts).subscribe((receipts) => {
      this.pendingReviewCount.set(receipts.filter((receipt) => receipt.status === 'pending_review').length);
    });
  }
  ngOnDestroy() { if (this.timer) window.clearInterval(this.timer); }

  /* ---------------- 角色与权限 ---------------- */

  setRole(role: Role) {
    if (role === 'owner') this.actor.set({ role: 'owner', name: '发布负责人', region: null });
    else this.actor.set({ role: 'ops', name: '华东运维', region: this.actor().region ?? '华东' });
  }
  setRegion(region: string) {
    this.actor.set({ role: 'ops', name: `${region}运维`, region });
  }
  can(region: string): boolean {
    const actor = this.actor();
    return actor.role === 'owner' || actor.region === region;
  }
  permReason(region: string): string {
    return this.can(region) ? '' : `区域运维只能处理本区（${this.actor().region}）批次，「${region}」无权操作`;
  }

  /* ---------------- 标签 ---------------- */

  statusLabel(status: BatchStatus): string { return STATUS_LABEL[status]; }
  deviceStateLabel(state: Device['state']): string { return DEVICE_STATE_LABEL[state]; }
  deviceName(id: string): string { return this.deviceMap.get(id)?.name ?? id; }
  isClaimed(device: Device): boolean {
    return this.claimedIds().has(device.id);
  }
  receiptStatusLabel(status: string): string {
    return ({ accepted: '已入账', duplicate: '重复忽略', retry_failed: '驳回重试', pending_review: '待核对' } as Record<string, string>)[status] ?? status;
  }
  receiptColor(status: string): 'primary' | 'warn' | 'accent' {
    return status === 'pending_review' ? 'warn' : status === 'duplicate' ? 'accent' : 'primary';
  }

  /* ---------------- 派生展示 ---------------- */

  enrollCandidates(batchId: string, region: string, models: string[]): Device[] {
    return [...this.deviceMap.values()].filter((device) =>
      device.region === region
      && models.includes(device.model)
      && !device.resultBatchIds.includes(batchId)
      && device.state !== 'dispatching' && device.state !== 'rolling_back'
    );
  }

  /* ---------------- 操作 ---------------- */

  private buildPayload(actor: Actor, suffix: string) {
    return {
      actor,
      name: this.draft.name || `批次 ${new Date().toLocaleTimeString()}${suffix}`,
      firmware: this.draft.firmware,
      rollbackVersion: this.draft.rollbackVersion,
      region: this.draft.region,
      models: [...this.draft.models],
      rolloutPercent: Number(this.draft.rolloutPercent) || 0,
      failureThreshold: Number(this.draft.failureThreshold) || 0,
      deviceIds: [...this.draft.deviceIds]
    };
  }

  create() {
    if (!this.draft.deviceIds.length || !this.draft.models.length) return;
    this.store.dispatch(createBatch(this.buildPayload(this.actor(), '')));
    this.draft = { ...this.draft, name: '', deviceIds: [] };
  }

  /** 两人同时提交同一批设备：两次 dispatch 在同一事件循环内串行处理，先到一版占用，后到一版冲突 */
  createConcurrent() {
    if (!this.draft.deviceIds.length || !this.draft.models.length) return;
    const first = this.actor();
    const second: Actor = first.role === 'owner'
      ? { role: 'ops', name: `${this.draft.region}运维（后到）`, region: this.draft.region }
      : { role: 'owner', name: '发布负责人（后到）', region: null };
    this.store.dispatch(createBatch(this.buildPayload(first, '（先到）')));
    this.store.dispatch(createBatch(this.buildPayload(second, '（后到）')));
    this.draft = { ...this.draft, name: '', deviceIds: [] };
  }

  approve(id: string) { this.store.dispatch(approveBatch({ id, actor: this.actor() })); }
  pause(id: string) { this.store.dispatch(pauseBatch({ id, actor: this.actor() })); }
  resume(id: string) { this.store.dispatch(resumeBatch({ id, actor: this.actor() })); }
  rollback(id: string) { this.store.dispatch(rollbackBatch({ id, actor: this.actor() })); }

  setEnroll(batchId: string, ids: string[]) { this.enrollSelection = { ...this.enrollSelection, [batchId]: ids }; }
  enroll(batchId: string) {
    const deviceIds = this.enrollSelection[batchId];
    if (!deviceIds?.length) return;
    this.store.dispatch(enqueueDevices({ batchId, actor: this.actor(), deviceIds }));
    this.enrollSelection = { ...this.enrollSelection, [batchId]: [] };
  }

  changeModels(batchId: string, models: string[]) {
    this.store.dispatch(updateBatchModels({ id: batchId, actor: this.actor(), models }));
  }

  review(id: string, accept: boolean) {
    this.store.dispatch(reconcileReceipt({ id, actor: this.actor(), accept }));
  }

  clearNotice() { this.store.dispatch(clearNotice()); }
  dismiss(id: string) { this.store.dispatch(dismissConflict({ id }));
  }
}
