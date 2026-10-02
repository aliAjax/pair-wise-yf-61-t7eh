// .simtest/ngrx-shim.mjs
function on(...args) {
  const reducer = args[args.length - 1];
  const types = args.slice(0, -1).map((a) => a.type);
  return { types, reducer };
}
function createReducer(initialState2, ...handlers) {
  const map = /* @__PURE__ */ new Map();
  for (const handler of handlers) for (const type of handler.types) map.set(type, handler.reducer);
  return (state2, action) => {
    const handler = map.get(action.type);
    return handler ? handler(state2, action) : state2 === void 0 ? initialState2 : state2;
  };
}
function props() {
  return null;
}
function createAction(type) {
  const action = (payload) => ({ type, ...payload });
  action.type = type;
  return action;
}

// src/app/state/release.actions.ts
var createBatch = createAction(
  "[Release] Create batch",
  props()
);
var approveBatch = createAction("[Release] Approve batch", props());
var pauseBatch = createAction("[Release] Pause batch", props());
var resumeBatch = createAction("[Release] Resume batch", props());
var rollbackBatch = createAction("[Release] Rollback batch", props());
var enqueueDevices = createAction(
  "[Release] Enqueue devices",
  props()
);
var updateBatchModels = createAction(
  "[Release] Update batch models",
  props()
);
var reportReceipt = createAction("[Release] Report receipt", props());
var reconcileReceipt = createAction("[Release] Reconcile receipt", props());
var dismissConflict = createAction("[Release] Dismiss conflict panel", props());
var clearNotice = createAction("[Release] Clear notice");
var telemetryTick = createAction("[Release] Telemetry tick");

// src/app/state/release.reducer.ts
var REGIONS = [
  { region: "\u534E\u4E1C", capacity: 6 },
  { region: "\u534E\u5357", capacity: 5 },
  { region: "\u65B0\u52A0\u5761", capacity: 4 }
];
var MODELS = ["GW-X100", "GW-X200", "GW-T40"];
var GATEWAY_SEED = [
  ["g-edge-a", "\u534E\u4E1C\xB7\u676D\u5DDE\u8FB9\u7F18\u7F51\u5173A\u7EC4", "\u534E\u4E1C", "GW-X200", 6],
  ["g-edge-b", "\u534E\u4E1C\xB7\u82CF\u5DDE\u8FB9\u7F18\u7F51\u5173B\u7EC4", "\u534E\u4E1C", "GW-X100", 5],
  ["g-plant-a", "\u534E\u5357\xB7\u4E1C\u839E\u5DE5\u4E1A\u91C7\u96C6\u7EC4", "\u534E\u5357", "GW-T40", 7],
  ["g-plant-b", "\u534E\u5357\xB7\u4F5B\u5C71\u5DE5\u4E1A\u91C7\u96C6\u7EC4", "\u534E\u5357", "GW-X100", 4],
  ["g-clinic", "\u65B0\u52A0\u5761\xB7\u8FDC\u7A0B\u8BCA\u7597\u7EC8\u7AEF\u7EC4", "\u65B0\u52A0\u5761", "GW-X100", 5]
];
function seedDevices() {
  const devices = [];
  for (const [gatewayId, , region, model, count] of GATEWAY_SEED) {
    for (let i = 1; i <= count; i++) {
      devices.push({
        id: `${gatewayId}-d${i}`,
        name: `${model}-${String(i).padStart(2, "0")}`,
        gatewayId,
        region,
        model,
        state: "idle",
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
var seedGateways = () => GATEWAY_SEED.map(([id, name, region, model]) => ({ id, name, region, model }));
function seedState() {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const demo = {
    id: "batch-demo",
    name: "\u8FB9\u7F18\u7F51\u5173\u5B89\u5168\u8865\u4E01 3.0.0",
    firmware: "3.0.0",
    rollbackVersion: "2.9.2",
    region: "\u534E\u4E1C",
    models: ["GW-X100", "GW-X200"],
    rolloutPercent: 30,
    failureThreshold: 30,
    status: "approved",
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
    audits: [{ id: crypto.randomUUID(), at: now, actor: "\u7CFB\u7EDF", message: "\u6279\u6B21\u300C\u8FB9\u7F18\u7F51\u5173\u5B89\u5168\u8865\u4E01 3.0.0\u300D\u5B8C\u6210\u517C\u5BB9\u6027\u68C0\u67E5\uFF0C\u7B49\u5F85\u5F00\u59CB\u53D1\u5E03" }],
    seqCounter: 0,
    notice: null
  };
}
var STORAGE_KEY = "firmware-release-v2";
function loadInitial() {
  const fallback = seedState();
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!stored || stored.version !== 2) return fallback;
    return stored;
  } catch {
    return fallback;
  }
}
var initialState = loadInitial();
var tick = 0;
function nextSeq(state2) {
  return state2.seqCounter + 1;
}
function auditEntry(actor, message) {
  return { id: crypto.randomUUID(), at: (/* @__PURE__ */ new Date()).toISOString(), actor, message };
}
function withAudit(state2, actor, message) {
  return { ...state2, audits: [auditEntry(actor, message), ...state2.audits] };
}
function withNotice(state2, notice) {
  return { ...state2, notice };
}
function regionAllowed(actor, region) {
  return actor.role === "owner" || actor.region === region;
}
function denied(state2, actor, action, region) {
  const msg = `\u6743\u9650\u62E6\u622A\uFF1A${actor.name} \u5C1D\u8BD5${action}\u300C${region}\u300D\u6279\u6B21\uFF0C\u4EC5${actor.region ? `\u672C\u533A\uFF08${actor.region}\uFF09` : "\u53D1\u5E03\u8D1F\u8D23\u4EBA"}\u53EF\u64CD\u4F5C`;
  return withNotice(withAudit(state2, actor.name, msg), `\u65E0\u6743\u9650\uFF1A\u533A\u57DF\u8FD0\u7EF4\u53EA\u80FD\u5904\u7406${actor.region}\u6279\u6B21\uFF0C\u8DE8\u533A\u7D27\u6025\u56DE\u6EDA\u8BF7\u7531\u53D1\u5E03\u8D1F\u8D23\u4EBA\u6267\u884C`);
}
function eligibleDevices(state2, batch) {
  return state2.devices.filter(
    (device) => device.region === batch.region && batch.models.includes(device.model) && !device.resultBatchIds.includes(batch.id)
  );
}
function computeQuota(state2, batch) {
  return Math.max(0, Math.round(eligibleDevices(state2, batch).length * batch.rolloutPercent / 100));
}
function claimedByBatch(state2, batchId) {
  return state2.claims.filter((claim) => claim.batchId === batchId);
}
function schedule(state2) {
  let slots = state2.slots.map((slot) => ({ ...slot }));
  const devices = state2.devices.map((device) => ({ ...device }));
  const batchById = new Map(state2.batches.map((batch) => [batch.id, batch]));
  const launched = [];
  slots = slots.filter((slot) => {
    const batch = batchById.get(slot.batchId);
    if (!batch) return false;
    if (slot.kind === "rollout" && (batch.status === "paused" || batch.status === "rolled_back" || batch.status === "completed")) return false;
    return devices.some((device) => device.id === slot.deviceId);
  });
  const inFlight = /* @__PURE__ */ new Map();
  for (const region of state2.regions) inFlight.set(region.region, 0);
  for (const device of devices) {
    const hasClaim = state2.claims.some((claim) => claim.deviceId === device.id);
    if (hasClaim && (device.state === "dispatching" || device.state === "rolling_back")) {
      inFlight.set(device.region, (inFlight.get(device.region) ?? 0) + 1);
    }
  }
  const byRegion = /* @__PURE__ */ new Map();
  for (const slot of slots) {
    byRegion.set(slot.region, [...byRegion.get(slot.region) ?? [], slot]);
  }
  const launchedIds = /* @__PURE__ */ new Set();
  const remain = [];
  for (const region of state2.regions) {
    const queued = (byRegion.get(region.region) ?? []).sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    let used = inFlight.get(region.region) ?? 0;
    for (const slot of queued) {
      if (used < region.capacity) {
        const device = devices.find((item) => item.id === slot.deviceId);
        if (!device || slot.kind === "rollout" && device.state !== "claimed" || slot.kind === "rollback" && device.state !== "idle") {
          remain.push(slot);
          continue;
        }
        device.state = slot.kind === "rollback" ? "rolling_back" : "dispatching";
        device.progress = 0;
        used += 1;
        launchedIds.add(slot.id);
        launched.push({ slot: { ...slot }, kind: slot.kind });
      } else {
        remain.push(slot);
      }
    }
  }
  for (const slot of slots) {
    if (!launchedIds.has(slot.id) && !remain.some((item) => item.id === slot.id)) remain.push(slot);
  }
  return { slots: remain, devices, launched };
}
function receiptExists(receipts, key) {
  return receipts.some((item) => item.key === key && (item.status === "accepted" || item.status === "pending_review"));
}
function acceptReceipt(state2, input) {
  const { key, batchId, deviceId, kind, outcome, weakNetwork, attempts } = input;
  if (receiptExists(state2.receipts, key)) {
    return {
      state: withNotice(state2, `\u8BBE\u5907 ${deviceId} \u7684\u56DE\u6267\u91CD\u590D\u4E0A\u62A5\uFF0C\u5DF2\u6309\u4E00\u6B21\u8BA1\u6570\uFF08\u6279\u6B21 ${batchId}\uFF09`),
      status: "duplicate"
    };
  }
  const device = state2.devices.find((item) => item.id === deviceId);
  const batch = state2.batches.find((item) => item.id === batchId);
  const region = device?.region ?? batch?.region ?? "\u672A\u77E5\u533A\u57DF";
  const batchStopped = kind === "rollout" && !!batch && (batch.status === "paused" || batch.status === "rolled_back");
  const status = batchStopped ? "pending_review" : "accepted";
  let devices = state2.devices;
  let claims = state2.claims;
  if (status === "accepted") {
    devices = state2.devices.map((item) => {
      if (item.id !== deviceId) return item;
      if (kind === "rollback") {
        return {
          ...item,
          state: "idle",
          progress: 100,
          installedBatchId: outcome === "success" ? null : item.installedBatchId,
          installedVersion: outcome === "success" ? null : item.installedVersion
        };
      }
      return outcome === "success" ? {
        ...item,
        state: "installed",
        progress: 100,
        installedBatchId: batchId,
        installedVersion: batch?.firmware ?? item.installedVersion,
        resultBatchIds: item.resultBatchIds.includes(batchId) ? item.resultBatchIds : [...item.resultBatchIds, batchId]
      } : {
        ...item,
        state: "failed",
        progress: 100,
        resultBatchIds: item.resultBatchIds.includes(batchId) ? item.resultBatchIds : [...item.resultBatchIds, batchId]
      };
    });
    claims = state2.claims.filter((claim) => !(claim.deviceId === deviceId && (outcome === "failure" || kind === "rollback")));
  }
  const receipt = {
    id: crypto.randomUUID(),
    key,
    batchId,
    deviceId,
    region,
    kind,
    outcome,
    status,
    weakNetwork,
    attempts,
    at: (/* @__PURE__ */ new Date()).toISOString(),
    note: status === "pending_review" ? "\u56DE\u6267\u5230\u8FBE\u65F6\u6279\u6B21\u5DF2\u505C\u6B62\uFF0C\u9000\u56DE\u5F85\u6838\u5BF9" : void 0
  };
  return {
    state: {
      ...state2,
      devices,
      claims,
      receipts: [receipt, ...state2.receipts]
    },
    status
  };
}
var releaseReducer = createReducer(
  initialState,
  on(clearNotice, (state2) => ({ ...state2, notice: null })),
  on(createBatch, (state2, { actor, name, firmware, rollbackVersion, region, models, rolloutPercent, failureThreshold, deviceIds }) => {
    if (!regionAllowed(actor, region)) return denied(state2, actor, "\u521B\u5EFA", region);
    if (!name || !firmware || models.length === 0 || deviceIds.length === 0) {
      return withNotice(state2, "\u8BF7\u586B\u5199\u6279\u6B21\u540D\u79F0\u3001\u76EE\u6807\u7248\u672C\u3001\u578B\u53F7\u5E76\u81F3\u5C11\u9009\u62E9\u4E00\u53F0\u8BBE\u5907");
    }
    const seq = nextSeq(state2);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const batch = {
      id: crypto.randomUUID(),
      name,
      firmware,
      rollbackVersion,
      region,
      models: [...models],
      rolloutPercent,
      failureThreshold,
      status: "draft",
      quota: 0,
      seq,
      createdAt: now,
      updatedAt: now
    };
    const scoped = deviceIds.filter((id) => {
      const device = state2.devices.find((item) => item.id === id);
      return device && device.region === region && models.includes(device.model) && !device.resultBatchIds.includes(batch.id);
    });
    const conflictIds = scoped.filter((id) => state2.claims.some((claim) => claim.deviceId === id));
    const freeIds = scoped.filter((id) => !conflictIds.includes(id));
    let next = {
      ...state2,
      batches: [batch, ...state2.batches],
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
      next = withNotice(next, `\u63D0\u4EA4\u51B2\u7A81\uFF1A${conflictIds.length} \u53F0\u8BBE\u5907\u5DF2\u88AB\u5148\u5230\u7684\u6279\u6B21\u5360\u7528\uFF0C\u5DF2\u5217\u5165\u51B2\u7A81\u8BBE\u5907`);
    }
    return withAudit(next, actor.name, `\u521B\u5EFA\u6279\u6B21\u300C${name}\u300D\uFF08${region}\uFF0C\u578B\u53F7 ${models.join("/")}\uFF09\uFF1A\u5165\u9009 ${freeIds.length} \u53F0\uFF0C\u51B2\u7A81 ${conflictIds.length} \u53F0`);
  }),
  on(approveBatch, (state2, { id, actor }) => {
    const batch = state2.batches.find((item) => item.id === id);
    if (!batch) return state2;
    if (!regionAllowed(actor, batch.region)) return denied(state2, actor, "\u5BA1\u6279", batch.region);
    if (batch.status !== "draft") return withNotice(state2, "\u4EC5\u8349\u7A3F\u6279\u6B21\u53EF\u5BA1\u6279");
    return withAudit(
      { ...state2, batches: state2.batches.map((item) => item.id === id ? { ...item, status: "approved", updatedAt: (/* @__PURE__ */ new Date()).toISOString() } : item) },
      actor.name,
      `\u6279\u6B21\u300C${batch.name}\u300D\u5BA1\u6279\u901A\u8FC7`
    );
  }),
  on(pauseBatch, (state2, { id, actor }) => {
    const batch = state2.batches.find((item) => item.id === id);
    if (!batch) return state2;
    if (!regionAllowed(actor, batch.region)) return denied(state2, actor, "\u6682\u505C", batch.region);
    if (batch.status !== "running") return withNotice(state2, "\u4EC5\u53D1\u5E03\u4E2D\u7684\u6279\u6B21\u53EF\u6682\u505C");
    const slots = state2.slots.filter((slot) => !(slot.batchId === id && slot.kind === "rollout"));
    return withAudit(
      { ...state2, batches: state2.batches.map((item) => item.id === id ? { ...item, status: "paused", updatedAt: (/* @__PURE__ */ new Date()).toISOString() } : item), slots },
      actor.name,
      `\u6279\u6B21\u300C${batch.name}\u300D\u5DF2\u6682\u505C\uFF0C\u672A\u4E0B\u53D1\u8BBE\u5907\u9000\u56DE\u6392\u961F`
    );
  }),
  on(resumeBatch, (state2, { id, actor }) => {
    const batch = state2.batches.find((item) => item.id === id);
    if (!batch) return state2;
    if (!regionAllowed(actor, batch.region)) return denied(state2, actor, "\u7EE7\u7EED", batch.region);
    if (batch.status !== "approved" && batch.status !== "paused") return withNotice(state2, "\u6279\u6B21\u5F53\u524D\u72B6\u6001\u4E0D\u53EF\u5F00\u59CB/\u7EE7\u7EED");
    let next = {
      ...state2,
      batches: state2.batches.map((item) => item.id === id ? { ...item, status: "running", updatedAt: (/* @__PURE__ */ new Date()).toISOString() } : item)
    };
    const claimed = next.claims.filter((claim) => claim.batchId === id).map((claim) => next.devices.find((device) => device.id === claim.deviceId)).filter((device) => !!device && device.state === "claimed");
    if (claimed.length) {
      let seq = next.seqCounter;
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const slots = [...next.slots];
      for (const device of claimed) {
        if (slots.some((slot) => slot.deviceId === device.id && slot.batchId === id)) continue;
        seq += 1;
        slots.push({ id: crypto.randomUUID(), batchId: id, deviceId: device.id, region: device.region, kind: "rollout", priority: 1, seq, enqueuedAt: now });
      }
      next = { ...next, slots, seqCounter: seq };
    }
    const scheduled = schedule(next);
    next = { ...next, slots: scheduled.slots, devices: scheduled.devices };
    return withAudit(next, actor.name, `\u6279\u6B21\u300C${batch.name}\u300D\u5F00\u59CB/\u7EE7\u7EED\u53D1\u5E03\uFF0C${claimed.length} \u53F0\u91CD\u65B0\u6392\u961F`);
  }),
  on(rollbackBatch, (state2, { id, actor }) => {
    const batch = state2.batches.find((item) => item.id === id);
    if (!batch) return state2;
    if (!regionAllowed(actor, batch.region)) return denied(state2, actor, "\u7D27\u6025\u56DE\u6EDA", batch.region);
    if (batch.status === "rolled_back" || batch.status === "draft") return withNotice(state2, "\u8BE5\u6279\u6B21\u5F53\u524D\u72B6\u6001\u4E0D\u53EF\u56DE\u6EDA");
    const now = (/* @__PURE__ */ new Date()).toISOString();
    let devices = state2.devices.map((device) => ({ ...device }));
    let claims = state2.claims.map((claim) => ({ ...claim }));
    const region = batch.region;
    const preempted = [];
    for (const device of devices) {
      if (device.region !== region || device.state !== "dispatching") continue;
      const claim = claims.find((item) => item.deviceId === device.id);
      if (claim && claim.batchId !== id) preempted.push(device);
    }
    const slots = state2.slots.filter((slot) => {
      if (slot.kind !== "rollout" || slot.region !== region) return true;
      const device = devices.find((item) => item.id === slot.deviceId);
      return !!device && !preempted.some((item) => item.id === device.id);
    });
    let seq = state2.seqCounter;
    for (const device of preempted) {
      device.state = "claimed";
      device.progress = 0;
      seq += 1;
      slots.push({ id: crypto.randomUUID(), batchId: state2.claims.find((c) => c.deviceId === device.id).batchId, deviceId: device.id, region, kind: "rollout", priority: 1, seq, enqueuedAt: now });
    }
    const rollbackDevices = devices.filter((device) => device.region === region && device.installedBatchId === id);
    for (const device of devices) {
      if (device.region !== region) continue;
      const claimedHere = claims.some((claim) => claim.deviceId === device.id && claim.batchId === id);
      if (claimedHere && device.state === "claimed") {
        device.state = "idle";
        device.progress = 0;
      }
    }
    claims = claims.filter((claim) => {
      if (claim.batchId !== id) return true;
      const device = devices.find((item) => item.id === claim.deviceId);
      return !!device && (device.state === "dispatching" || device.state === "rolling_back");
    });
    const slots2 = slots.filter((slot) => !(slot.batchId === id && slot.kind === "rollout"));
    for (const device of rollbackDevices) {
      seq += 1;
      slots2.push({ id: crypto.randomUUID(), batchId: id, deviceId: device.id, region, kind: "rollback", priority: 0, seq, enqueuedAt: now });
      const target = devices.find((item) => item.id === device.id);
      target.state = "idle";
      if (!claims.some((claim) => claim.deviceId === device.id && claim.batchId === id)) {
        claims.push({ deviceId: device.id, batchId: id });
      }
    }
    let next = {
      ...state2,
      devices,
      claims,
      slots: slots2,
      seqCounter: seq,
      batches: state2.batches.map((item) => item.id === id ? { ...item, status: "rolled_back", updatedAt: now } : item)
    };
    const scheduled = schedule(next);
    next = { ...next, slots: scheduled.slots, devices: scheduled.devices };
    next = withNotice(next, `\u7D27\u6025\u56DE\u6EDA\u5DF2\u63D2\u961F\uFF1A${rollbackDevices.length} \u53F0\u56DE\u6EDA\u4F18\u5148\u4E0B\u53D1\uFF0C${preempted.length} \u53F0\u5176\u4ED6\u6279\u6B21\u8BBE\u5907\u9000\u56DE\u91CD\u6392`);
    return withAudit(next, actor.name, `\u6279\u6B21\u300C${batch.name}\u300D\u7D27\u6025\u56DE\u6EDA\uFF1A${rollbackDevices.length} \u53F0\u63D2\u961F\u56DE\u6EDA\uFF0C${preempted.length} \u53F0\u8BA9\u4F4D\u91CD\u6392`);
  }),
  on(enqueueDevices, (state2, { batchId, actor, deviceIds }) => {
    const batch = state2.batches.find((item) => item.id === batchId);
    if (!batch) return state2;
    if (!regionAllowed(actor, batch.region)) return denied(state2, actor, "\u8FFD\u52A0\u8BBE\u5907\u5230", batch.region);
    if (batch.status !== "running") return withNotice(state2, "\u4EC5\u53D1\u5E03\u4E2D\u7684\u6279\u6B21\u53EF\u8FFD\u52A0\u8BBE\u5907");
    const scoped = deviceIds.filter((id) => {
      const device = state2.devices.find((item) => item.id === id);
      return device && device.region === batch.region && batch.models.includes(device.model) && !device.resultBatchIds.includes(batchId);
    });
    const conflictIds = scoped.filter((id) => state2.claims.some((claim) => claim.deviceId === id));
    const freeIds = scoped.filter((id) => !conflictIds.includes(id));
    let next = computeAndEnqueue(state2, batchId, freeIds);
    if (conflictIds.length) {
      next = {
        ...next,
        conflicts: [{ id: crypto.randomUUID(), actor: actor.name, batchId, batchName: batch.name, deviceIds: conflictIds, at: (/* @__PURE__ */ new Date()).toISOString() }, ...next.conflicts]
      };
      next = withNotice(next, `\u63D0\u4EA4\u51B2\u7A81\uFF1A${conflictIds.length} \u53F0\u8BBE\u5907\u5DF2\u88AB\u5148\u5230\u7684\u6279\u6B21\u5360\u7528`);
    }
    if (!freeIds.length && !conflictIds.length) next = withNotice(next, "\u6CA1\u6709\u7B26\u5408\u533A\u57DF\u4E0E\u578B\u53F7\u6761\u4EF6\u7684\u53EF\u8FFD\u52A0\u8BBE\u5907");
    return withAudit(next, actor.name, `\u6279\u6B21\u300C${batch.name}\u300D\u8FFD\u52A0\u63D0\u4EA4 ${scoped.length} \u53F0\uFF1A\u5165\u9009 ${freeIds.length} \u53F0\uFF0C\u51B2\u7A81 ${conflictIds.length} \u53F0`);
  }),
  on(updateBatchModels, (state2, { id, actor, models }) => {
    const batch = state2.batches.find((item) => item.id === id);
    if (!batch) return state2;
    if (!regionAllowed(actor, batch.region)) return denied(state2, actor, "\u4FEE\u6539\u578B\u53F7\u6E05\u5355", batch.region);
    if (batch.status === "rolled_back" || batch.status === "completed") return withNotice(state2, "\u5DF2\u7ED3\u675F\u6279\u6B21\u7684\u578B\u53F7\u6E05\u5355\u4E0D\u53EF\u4FEE\u6539");
    const before = batch.quota;
    const updated = { ...batch, models: [...models], updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    let next = {
      ...state2,
      batches: state2.batches.map((item) => item.id === id ? updated : item)
    };
    const quota = computeQuota(next, updated);
    next = { ...next, batches: next.batches.map((item) => item.id === id ? { ...item, quota } : item) };
    const batchClaims = claimedByBatch(next, id);
    const releaseIds = /* @__PURE__ */ new Set();
    for (const claim of batchClaims) {
      const device = next.devices.find((item) => item.id === claim.deviceId);
      if (!device) continue;
      if (device.state === "claimed" && !models.includes(device.model)) releaseIds.add(device.id);
    }
    const claimedDevices = next.devices.filter((device) => device.region === batch.region && models.includes(device.model) && next.claims.some((claim) => claim.deviceId === device.id && claim.batchId === id) && device.state === "claimed");
    const overflow = Math.max(0, claimedDevices.length - quota);
    if (overflow > 0) {
      const queuedOrder = next.slots.filter((slot) => slot.batchId === id && slot.kind === "rollout").sort((a, b) => b.seq - a.seq).map((slot) => slot.deviceId);
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
        devices: next.devices.map((device) => releaseIds.has(device.id) ? { ...device, state: "idle", progress: 0 } : device),
        claims: next.claims.filter((claim) => !(claim.batchId === id && releaseIds.has(claim.deviceId))),
        slots: next.slots.filter((slot) => !(slot.batchId === id && releaseIds.has(slot.deviceId)))
      };
    }
    const scheduled = schedule(next);
    next = { ...next, slots: scheduled.slots, devices: scheduled.devices };
    next = withNotice(next, `\u578B\u53F7\u6E05\u5355\u5DF2\u53D8\u66F4\uFF1A\u672A\u4E0B\u53D1\u540D\u989D ${before} \u2192 ${quota} \u7ACB\u5373\u91CD\u7B97\uFF0C\u5DF2\u88C5\u4E0A\u7684\u8BBE\u5907\u7ED3\u679C\u4FDD\u7559`);
    return withAudit(next, actor.name, `\u6279\u6B21\u300C${batch.name}\u300D\u578B\u53F7\u6E05\u5355\u53D8\u66F4\u4E3A ${models.join("/")}\uFF0C\u540D\u989D ${before} \u2192 ${quota}\uFF0C\u91CA\u653E ${releaseIds.size} \u53F0\u672A\u4E0B\u53D1\u8BBE\u5907`);
  }),
  on(reportReceipt, (state2, { receipt }) => {
    const result = acceptReceipt(state2, {
      key: receipt.key,
      batchId: receipt.batchId,
      deviceId: receipt.deviceId,
      kind: receipt.kind,
      outcome: receipt.outcome,
      weakNetwork: receipt.weakNetwork,
      attempts: 1
    });
    return result.state;
  }),
  on(reconcileReceipt, (state2, { id, actor, accept }) => {
    const receipt = state2.receipts.find((item) => item.id === id);
    if (!receipt || receipt.status !== "pending_review") return state2;
    if (!accept) {
      const rejected = state2.receipts.map((item) => item.id === id ? { ...item, status: "retry_failed", note: "\u503C\u73ED\u6838\u5BF9\u540E\u9A73\u56DE\uFF1A\u56DE\u6267\u4E0E\u73B0\u573A\u72B6\u6001\u4E0D\u7B26\uFF0C\u6309\u8BBE\u5907\u91CD\u8BD5" } : item);
      const pending = state2.pendingReports.some((item) => item.key === receipt.key) ? state2.pendingReports : [...state2.pendingReports, { key: `${receipt.key}:retry`, batchId: receipt.batchId, deviceId: receipt.deviceId, kind: receipt.kind, outcome: receipt.outcome, weakNetwork: true, attempts: 1 }];
      return withAudit({ ...state2, receipts: rejected, pendingReports: pending }, actor.name, `\u56DE\u6267 ${receipt.deviceId} \u6838\u5BF9\u9A73\u56DE\uFF0C\u5DF2\u6309\u8BBE\u5907\u91CD\u65B0\u8865\u62A5`);
    }
    const accepted = state2.receipts.map((item) => item.id === id ? { ...item, status: "accepted", note: "\u503C\u73ED\u6838\u5BF9\u901A\u8FC7" } : item);
    let devices = state2.devices;
    let claims = state2.claims;
    const batch = state2.batches.find((item) => item.id === receipt.batchId);
    if (receipt.kind === "rollback") {
      devices = devices.map((device) => device.id === receipt.deviceId ? { ...device, state: "idle", progress: 100, installedBatchId: receipt.outcome === "success" ? null : device.installedBatchId, installedVersion: receipt.outcome === "success" ? null : device.installedVersion } : device);
      claims = claims.filter((claim) => claim.deviceId !== receipt.deviceId);
    } else {
      devices = devices.map((device) => {
        if (device.id !== receipt.deviceId) return device;
        const resultBatchIds = device.resultBatchIds.includes(receipt.batchId) ? device.resultBatchIds : [...device.resultBatchIds, receipt.batchId];
        return receipt.outcome === "success" ? { ...device, state: "installed", progress: 100, installedBatchId: receipt.batchId, installedVersion: batch?.firmware ?? device.installedVersion, resultBatchIds } : { ...device, state: "failed", progress: 100, resultBatchIds };
      });
      if (receipt.outcome === "failure") claims = claims.filter((claim) => claim.deviceId !== receipt.deviceId);
    }
    const scheduled = schedule({ ...state2, devices, claims, receipts: accepted, slots: state2.slots });
    return withAudit(
      { ...state2, devices: scheduled.devices, claims, receipts: accepted, slots: scheduled.slots },
      actor.name,
      `\u56DE\u6267 ${receipt.deviceId}\uFF08${receipt.kind === "rollback" ? "\u56DE\u6EDA" : "\u5B89\u88C5"}${receipt.outcome === "success" ? "\u6210\u529F" : "\u5931\u8D25"}\uFF09\u6838\u5BF9\u901A\u8FC7\u5E76\u5165\u8D26`
    );
  }),
  on(dismissConflict, (state2, { id }) => ({ ...state2, conflicts: state2.conflicts.filter((item) => item.id !== id) })),
  on(telemetryTick, (state2) => {
    tick += 1;
    let devices = state2.devices.map((device) => ({ ...device }));
    const receipts = [...state2.receipts];
    let pendingReports = state2.pendingReports.map((item) => ({ ...item }));
    const batchMap = new Map(state2.batches.map((batch) => [batch.id, batch]));
    const newAudits = [];
    let notice = state2.notice;
    const finishing = [];
    devices = devices.map((device) => {
      if (device.state !== "dispatching" && device.state !== "rolling_back") return device;
      const claim = state2.claims.find((item) => item.deviceId === device.id);
      if (!claim) return { ...device, state: "idle", progress: 0 };
      const speed = device.weakNetwork ? 12 : 30;
      const progress = Math.min(100, device.progress + speed + Math.floor(Math.random() * 14));
      if (progress < 100) return { ...device, progress };
      const failure = Math.random() < (device.weakNetwork ? 0.18 : 0.08);
      finishing.push({ deviceId: device.id, batchId: claim.batchId, kind: device.state === "rolling_back" ? "rollback" : "rollout", outcome: failure ? "failure" : "success", weakNetwork: device.weakNetwork });
      return { ...device, progress: 100 };
    });
    let work = { ...state2, devices };
    for (const done of finishing) {
      const key = `${done.batchId}:${done.deviceId}:${done.kind}:${done.outcome}`;
      if (receiptExists(work.receipts, key)) continue;
      if (done.weakNetwork) {
        pendingReports.push({ key, batchId: done.batchId, deviceId: done.deviceId, kind: done.kind, outcome: done.outcome, weakNetwork: true, attempts: 0 });
      } else {
        const result = acceptReceipt(work, { key, batchId: done.batchId, deviceId: done.deviceId, kind: done.kind, outcome: done.outcome, weakNetwork: false, attempts: 1 });
        work = result.state;
        if (result.status === "pending_review") notice = `\u8BBE\u5907 ${done.deviceId} \u7684\u56DE\u6267\u5230\u8FBE\u65F6\u6279\u6B21\u5DF2\u505C\u6B62\uFF0C\u5DF2\u9000\u56DE\u5F85\u6838\u5BF9`;
      }
    }
    const stillPending = [];
    for (const report of pendingReports) {
      const attempts = report.attempts + 1;
      if (receiptExists(work.receipts, report.key)) continue;
      if (Math.random() < 0.55) {
        const result = acceptReceipt(work, { ...report, attempts });
        work = result.state;
        if (result.status === "pending_review") notice = `\u8BBE\u5907 ${report.deviceId} \u8865\u62A5\u6210\u529F\uFF0C\u4F46\u6279\u6B21\u5DF2\u505C\u6B62\uFF0C\u56DE\u6267\u9000\u56DE\u5F85\u6838\u5BF9`;
        else if (result.status !== "duplicate") notice = `\u8BBE\u5907 ${report.deviceId} \u5F31\u7F51\u8865\u62A5\u6210\u529F\uFF08\u7B2C ${attempts} \u6B21\u5C1D\u8BD5\uFF09`;
      } else {
        stillPending.push({ ...report, attempts });
      }
    }
    pendingReports = stillPending;
    const scheduled = schedule({ ...work, pendingReports });
    work = { ...work, slots: scheduled.slots, devices: scheduled.devices, pendingReports };
    work = {
      ...work,
      batches: work.batches.map((batch) => {
        if (batch.status !== "running") return batch;
        const acceptedReceipts = work.receipts.filter((r) => r.batchId === batch.id && r.kind === "rollout" && r.status === "accepted");
        const installed = acceptedReceipts.filter((r) => r.outcome === "success").length;
        const failed = acceptedReceipts.filter((r) => r.outcome === "failure").length;
        const total = installed + failed;
        const rate = total ? failed / total * 100 : 0;
        if (rate > batch.failureThreshold && failed >= 2) {
          newAudits.push(auditEntry("\u7CFB\u7EDF", `\u6279\u6B21\u300C${batch.name}\u300D\u5931\u8D25\u7387 ${rate.toFixed(0)}% \u8D85\u8FC7\u9608\u503C ${batch.failureThreshold}%\uFF0C\u81EA\u52A8\u6682\u505C`));
          return { ...batch, status: "paused", updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
        }
        if (batch.quota > 0 && installed >= batch.quota) {
          newAudits.push(auditEntry("\u7CFB\u7EDF", `\u6279\u6B21\u300C${batch.name}\u300D\u5DF2\u8FBE\u540D\u989D ${batch.quota} \u53F0\uFF0C\u53D1\u5E03\u5B8C\u6210`));
          return { ...batch, status: "completed", updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
        }
        return batch;
      })
    };
    return { ...work, audits: [...newAudits, ...work.audits], notice };
  })
);
function computeAndEnqueue(state2, batchId, freeDeviceIds) {
  const batch = state2.batches.find((item) => item.id === batchId);
  if (!batch) return state2;
  const quota = computeQuota(state2, batch);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const selected = freeDeviceIds.slice(0, quota);
  let seq = state2.seqCounter;
  const claims = [...state2.claims];
  const slots = [...state2.slots];
  for (const deviceId of selected) {
    claims.push({ deviceId, batchId });
    seq += 1;
    slots.push({ id: crypto.randomUUID(), batchId, deviceId, region: batch.region, kind: "rollout", priority: 1, seq, enqueuedAt: now });
  }
  let next = {
    ...state2,
    claims,
    slots,
    seqCounter: seq,
    devices: state2.devices.map((device) => selected.includes(device.id) ? { ...device, state: "claimed" } : device),
    batches: state2.batches.map((item) => item.id === batchId ? { ...item, quota, updatedAt: now } : item)
  };
  if (batch.status === "running") {
    const scheduled = schedule(next);
    next = { ...next, slots: scheduled.slots, devices: scheduled.devices };
  }
  const inFlightOrQueued = next.slots.filter((slot) => slot.batchId === batchId).length + next.devices.filter((device) => (device.state === "dispatching" || device.state === "rolling_back") && next.claims.some((claim) => claim.deviceId === device.id && claim.batchId === batchId)).length;
  return { ...next, notice: `\u540D\u989D ${quota} \u53F0\uFF0C\u672C\u6B21\u5360\u7528 ${selected.length} \u53F0\uFF1B\u533A\u57DF\u5BB9\u91CF\u5916\u8BBE\u5907\u81EA\u52A8\u6392\u961F\uFF08\u5F53\u524D\u961F\u5217/\u5728\u9014 ${inFlightOrQueued} \u53F0\uFF09` };
}

// .simtest/run.ts
if (typeof globalThis.crypto === "undefined") {
  let n = 0;
  globalThis.crypto = {
    randomUUID: () => `sim-${(n++).toString(16)}-${Date.now().toString(16)}`
  };
}
if (typeof localStorage === "undefined") {
  const map = /* @__PURE__ */ new Map();
  globalThis.localStorage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => void map.clear(),
    key: (_i) => null,
    length: 0
  };
}
var OWNER = { role: "owner", name: "\u53D1\u5E03\u8D1F\u8D23\u4EBA", region: null };
var OPS_HD = { role: "ops", name: "\u534E\u4E1C\u8FD0\u7EF4", region: "\u534E\u4E1C" };
var OPS_HN = { role: "ops", name: "\u534E\u5357\u8FD0\u7EF4", region: "\u534E\u5357" };
var pass = 0;
var fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  \u2705 ${name}`);
  } else {
    fail++;
    console.log(`  \u274C ${name} ${detail}`);
  }
}
function tick2(state2, n = 1) {
  for (let i = 0; i < n; i++) state2 = releaseReducer(state2, telemetryTick());
  return state2;
}
var state = releaseReducer(void 0, { type: "@@init" });
console.log("\n[\u89C4\u52191] \u533A\u57DF RBAC\uFF1A\u533A\u57DF\u8FD0\u7EF4\u53EA\u80FD\u5904\u7406\u672C\u533A\uFF1B\u8DE8\u533A\u7D27\u6025\u56DE\u6EDA\u4EC5\u53D1\u5E03\u8D1F\u8D23\u4EBA");
{
  const hd = state.devices.filter((d) => d.region === "\u534E\u4E1C" && d.model === "GW-X100").map((d) => d.id);
  state = releaseReducer(state, createBatch({
    actor: OPS_HN,
    name: "\u534E\u5357\u8FD0\u7EF4\u5EFA\u534E\u4E1C\u6279\u6B21",
    firmware: "9.9",
    rollbackVersion: "9.8",
    region: "\u534E\u4E1C",
    models: ["GW-X100"],
    rolloutPercent: 100,
    failureThreshold: 50,
    deviceIds: hd
  }));
  check("\u8DE8\u533A\u521B\u5EFA\u88AB\u62D2\u4E14\u6279\u6B21\u672A\u751F\u6210", !state.batches.some((b) => b.name === "\u534E\u5357\u8FD0\u7EF4\u5EFA\u534E\u4E1C\u6279\u6B21") && !!state.notice);
  state = releaseReducer(state, createBatch({
    actor: OPS_HD,
    name: "\u534E\u4E1C\u6279\u6B21A",
    firmware: "3.1",
    rollbackVersion: "3.0",
    region: "\u534E\u4E1C",
    models: ["GW-X100"],
    rolloutPercent: 100,
    failureThreshold: 50,
    deviceIds: hd
  }));
  const batchA = state.batches[0];
  state = releaseReducer(state, approveBatch({ id: batchA.id, actor: OPS_HN }));
  check("\u8DE8\u533A\u5BA1\u6279\u88AB\u62D2\uFF08\u6279\u6B21\u4ECD\u4E3A\u8349\u7A3F\uFF09", state.batches.find((b) => b.id === batchA.id).status === "draft");
  state = releaseReducer(state, approveBatch({ id: batchA.id, actor: OPS_HD }));
  state = releaseReducer(state, resumeBatch({ id: batchA.id, actor: OPS_HD }));
  state = tick2(state, 1);
  state = releaseReducer(state, rollbackBatch({ id: batchA.id, actor: OPS_HN }));
  check(
    "\u8DE8\u533A\u7D27\u6025\u56DE\u6EDA\u88AB\u534E\u5357\u8FD0\u7EF4\u62D2\u7EDD\uFF08\u53D1\u5E03\u8D1F\u8D23\u4EBA\u4E13\u5C5E\u8DE8\u533A\u52A8\u4F5C\uFF09",
    state.batches.find((b) => b.id === batchA.id).status !== "rolled_back"
  );
  state = releaseReducer(state, rollbackBatch({ id: batchA.id, actor: OWNER }));
  check("\u53D1\u5E03\u8D1F\u8D23\u4EBA\u53EF\u8DE8\u533A\u7D27\u6025\u56DE\u6EDA", state.batches.find((b) => b.id === batchA.id).status === "rolled_back");
  state = tick2(state, 10);
}
console.log("\n[\u89C4\u52192] \u533A\u57DF\u5BB9\u91CF\u4E0A\u9650\uFF1A\u8D85\u989D\u6392\u961F\uFF0C\u5BB9\u91CF\u91CA\u653E\u540E FIFO \u8865\u4F4D");
{
  const free = state.devices.filter((d) => d.region === "\u534E\u4E1C" && d.model === "GW-X200" && !state.claims.some((c) => c.deviceId === d.id)).map((d) => d.id);
  state = releaseReducer(state, createBatch({
    actor: OPS_HD,
    name: "\u534E\u4E1CX200\u6279\u6B21",
    firmware: "4.0",
    rollbackVersion: "3.9",
    region: "\u534E\u4E1C",
    models: ["GW-X200"],
    rolloutPercent: 100,
    failureThreshold: 100,
    deviceIds: free
  }));
  const b = state.batches[0];
  state = releaseReducer(state, approveBatch({ id: b.id, actor: OPS_HD }));
  state = releaseReducer(state, resumeBatch({ id: b.id, actor: OPS_HD }));
  state = tick2(state, 1);
  const cap = state.regions.find((r) => r.region === "\u534E\u4E1C").capacity;
  const inFlight = state.devices.filter((d) => d.region === "\u534E\u4E1C" && (d.state === "dispatching" || d.state === "rolling_back")).length;
  const queued = state.slots.filter((s) => s.region === "\u534E\u4E1C" && s.kind === "rollout").length;
  check("\u5728\u9014\u4E0B\u53D1\u4E0D\u8D85\u8FC7\u533A\u57DF\u5BB9\u91CF", inFlight <= cap, `inFlight=${inFlight} cap=${cap}`);
  check("\u8D85\u989D\u8BBE\u5907\u7559\u5728\u961F\u5217", queued > 0, `queued=${queued}`);
  const firstQueueSeq = Math.min(...state.slots.filter((s) => s.region === "\u534E\u4E1C").map((s) => s.seq));
  const before = state.slots.find((s) => s.seq === firstQueueSeq).deviceId;
  state = tick2(state, 4);
  const launched = state.devices.find((d) => d.id === before);
  check(
    "\u5BB9\u91CF\u91CA\u653E\u540E\u961F\u9996\u8BBE\u5907\u8865\u4F4D\u4E0B\u53D1",
    launched.state === "dispatching" || launched.state === "installed" || !!state.receipts.find((r) => r.deviceId === before),
    `state=${launched.state}`
  );
}
console.log("\n[\u89C4\u52193] \u7D27\u6025\u56DE\u6EDA\u7ACB\u5373\u63D2\u961F\uFF0C\u5176\u4ED6\u6279\u6B21\u5728\u9014\u8BBE\u5907\u9000\u56DE\u91CD\u6392");
{
  const hn = state.devices.filter((d) => d.region === "\u534E\u5357" && d.model === "GW-X100").map((d) => d.id);
  state = releaseReducer(state, createBatch({
    actor: OPS_HN,
    name: "\u534E\u5357X100\u6279\u6B21",
    firmware: "5.0",
    rollbackVersion: "4.9",
    region: "\u534E\u5357",
    models: ["GW-X100"],
    rolloutPercent: 100,
    failureThreshold: 100,
    deviceIds: hn
  }));
  const b1 = state.batches[0];
  state = releaseReducer(state, approveBatch({ id: b1.id, actor: OPS_HN }));
  state = releaseReducer(state, resumeBatch({ id: b1.id, actor: OPS_HN }));
  state = tick2(state, 2);
  const restHN = state.devices.filter((d) => d.region === "\u534E\u5357" && d.state === "idle" && !state.claims.some((c) => c.deviceId === d.id)).map((d) => d.id);
  state = releaseReducer(state, createBatch({
    actor: OPS_HN,
    name: "\u534E\u5357\u6DF7\u5408\u6279\u6B21",
    firmware: "5.0",
    rollbackVersion: "4.9",
    region: "\u534E\u5357",
    models: ["GW-T40", "GW-X100"],
    rolloutPercent: 100,
    failureThreshold: 100,
    deviceIds: restHN
  }));
  const b2 = state.batches[0];
  state = releaseReducer(state, approveBatch({ id: b2.id, actor: OPS_HN }));
  state = releaseReducer(state, resumeBatch({ id: b2.id, actor: OPS_HN }));
  state = tick2(state, 2);
  const capHN = state.regions.find((r) => r.region === "\u534E\u5357").capacity;
  const usedHN = state.devices.filter((d) => d.region === "\u534E\u5357" && d.state === "dispatching").length;
  check(
    "\u524D\u7F6E\uFF1A\u534E\u5357\u5BB9\u91CF\u5DF2\u88AB\u5360\u6EE1\uFF0C\u5B58\u5728\u6392\u961F",
    usedHN === capHN && state.slots.some((s) => s.region === "\u534E\u5357"),
    `used=${usedHN}/${capHN} queued=${state.slots.length}`
  );
  state = tick2(state, 6);
  const installedOnB1 = state.devices.filter((d) => d.installedBatchId === b1.id).length;
  state = releaseReducer(state, rollbackBatch({ id: b1.id, actor: OWNER }));
  const rbSlotsQueued = state.slots.filter((s) => s.kind === "rollback");
  const rbInFlightNow = state.devices.filter((d) => d.region === "\u534E\u5357" && d.state === "rolling_back").length;
  check(
    "\u56DE\u6EDA\u751F\u6210 priority=0 \u7684\u63D2\u961F\u69FD\uFF08\u961F\u5217\u6216\u5DF2\u5728\u9014\uFF09",
    rbInFlightNow > 0 || rbSlotsQueued.length > 0 && rbSlotsQueued.every((s) => s.priority === 0),
    `queued=${rbSlotsQueued.length} inflight=${rbInFlightNow}`
  );
  const queue = [...state.slots].sort((a, c) => a.priority - c.priority || a.seq - c.seq);
  check(
    "\u56DE\u6EDA\u4F18\u5148\u7EA7\u9AD8\u4E8E\u666E\u901A\u53D1\u5E03\uFF08\u961F\u5217\u4E2D\u6709\u56DE\u6EDA\u65F6\u5176\u5FC5\u5728\u6700\u524D\uFF09",
    rbInFlightNow > 0 || queue.length === 0 || queue[0].kind === "rollback"
  );
  const rbInFlight = state.devices.filter((d) => d.region === "\u534E\u5357" && d.state === "rolling_back").length;
  check("\u56DE\u6EDA\u8BBE\u5907\u7ACB\u5373\u83B7\u5F97\u4E0B\u53D1\u540D\u989D", rbInFlight > 0);
  const preemptedAudit = state.audits.some((a) => a.message.includes("\u8BA9\u4F4D\u91CD\u6392"));
  const preemptedState = state.slots.some((s) => s.batchId === b2.id && s.kind === "rollout") || state.devices.some((d) => d.state === "claimed" && state.claims.some((c) => c.deviceId === d.id && c.batchId === b2.id));
  check(
    "\u5176\u4ED6\u6279\u6B21\u5728\u9014\u8BBE\u5907\u9000\u56DE\u961F\u5217\u91CD\u6392",
    preemptedAudit || preemptedState,
    `audit=${preemptedAudit} state=${preemptedState}`
  );
  check("\u56DE\u6EDA\u8BBE\u5907\u6570\u91CF\u4E0E\u5DF2\u88C5\u4E0A\u8BBE\u5907\u4E00\u81F4", rbSlotsQueued.length + rbInFlight === installedOnB1, `rb=${rbSlotsQueued.length} inflight=${rbInFlight} installed=${installedOnB1}`);
  state = tick2(state, 12);
  check(
    "\u56DE\u6EDA\u5B8C\u6210\u540E\u8BBE\u5907\u56DE\u5230\u7A7A\u95F2\u4E14\u5B89\u88C5\u7ED3\u679C\u88AB\u64A4\u9500",
    !state.devices.some((d) => d.installedBatchId === b1.id && d.state === "rolling_back")
  );
}
console.log("\n[\u89C4\u52194] \u5F31\u7F51\u8865\u62A5\uFF1A\u91CD\u590D\u53EA\u7B97\u4E00\u6B21\u3001\u5931\u8D25\u6309\u8BBE\u5907\u91CD\u8BD5\u3001\u505C\u6279\u6B21\u56DE\u6267\u9000\u5F85\u6838\u5BF9");
{
  state = tick2(state, 24);
  const weakReceipts = state.receipts.filter((r) => r.weakNetwork);
  const retried = weakReceipts.some((r) => r.attempts > 1) || state.pendingReports.length > 0;
  check(
    "\u5F31\u7F51\u8BBE\u5907\u8D70\u8865\u62A5\u91CD\u8BD5\u901A\u9053\uFF08\u6309\u8BBE\u5907\uFF09\uFF0C\u5E26\u5C1D\u8BD5\u6B21\u6570",
    weakReceipts.length > 0 && retried,
    `weakReceipts=${weakReceipts.length} pending=${state.pendingReports.length}`
  );
  const wr = state.receipts.find((r) => r.weakNetwork && (r.status === "accepted" || r.status === "pending_review"));
  check("\u5F31\u7F51\u56DE\u6267\u5E26\u5C1D\u8BD5\u6B21\u6570\u5E76\u6700\u7EC8\u6709\u5F52\u5C5E", !!wr && wr.attempts >= 1);
  if (wr) {
    const before = state.receipts.length;
    state = releaseReducer(state, {
      type: "[Release] Report receipt",
      receipt: { key: wr.key, batchId: wr.batchId, deviceId: wr.deviceId, region: wr.region, kind: wr.kind, outcome: wr.outcome, weakNetwork: true }
    });
    check("\u91CD\u590D\u56DE\u6267\u4E0D\u4EA7\u751F\u65B0\u8BB0\u5F55\uFF08\u53EA\u7B97\u4E00\u6B21\uFF09", state.receipts.length === before);
  }
  const running = state.batches.find((b) => b.status === "running");
  if (running) {
    const inFlightDevice = state.devices.find((d) => d.region === running.region && d.state === "dispatching");
    state = releaseReducer(state, pauseBatch({ id: running.id, actor: running.region === "\u534E\u4E1C" ? OPS_HD : OPS_HN }));
    if (inFlightDevice) {
      const claim = state.claims.find((c) => c.deviceId === inFlightDevice.id);
      if (claim) {
        state = releaseReducer(state, {
          type: "[Release] Report receipt",
          receipt: { key: `${running.id}:${inFlightDevice.id}:rollout:success:late`, batchId: running.id, deviceId: inFlightDevice.id, region: running.region, kind: "rollout", outcome: "success", weakNetwork: false }
        });
        const r = state.receipts.find((x) => x.key === `${running.id}:${inFlightDevice.id}:rollout:success:late`);
        check("\u5DF2\u6682\u505C\u6279\u6B21\u7684\u56DE\u6267\u9000\u56DE\u5F85\u6838\u5BF9", r?.status === "pending_review");
        state = releaseReducer(state, reconcileReceipt({ id: r.id, actor: OWNER, accept: true }));
        check("\u5F85\u6838\u5BF9\u56DE\u6267\u7ECF\u503C\u73ED\u786E\u8BA4\u540E\u5165\u8D26", state.receipts.find((x) => x.id === r.id).status === "accepted");
      }
    }
  }
}
console.log("\n[\u89C4\u52195] \u4E24\u4EBA\u540C\u65F6\u63D0\u4EA4\u540C\u4E00\u6279\u8BBE\u5907\uFF1A\u5148\u5230\u751F\u6548\uFF0C\u540E\u5230\u770B\u5230\u51B2\u7A81\u8BBE\u5907");
{
  const free = state.devices.filter((d) => d.region === "\u65B0\u52A0\u5761" && d.state === "idle").map((d) => d.id);
  const ids = free.slice(0, 3);
  state = releaseReducer(state, createBatch({
    actor: OWNER,
    name: "\u5E76\u53D1-\u5148\u5230",
    firmware: "6.0",
    rollbackVersion: "5.9",
    region: "\u65B0\u52A0\u5761",
    models: ["GW-X100"],
    rolloutPercent: 100,
    failureThreshold: 50,
    deviceIds: ids
  }));
  state = releaseReducer(state, createBatch({
    actor: { role: "ops", name: "\u65B0\u52A0\u5761\u8FD0\u7EF4(\u540E\u5230)", region: "\u65B0\u52A0\u5761" },
    name: "\u5E76\u53D1-\u540E\u5230",
    firmware: "6.0",
    rollbackVersion: "5.9",
    region: "\u65B0\u52A0\u5761",
    models: ["GW-X100"],
    rolloutPercent: 100,
    failureThreshold: 50,
    deviceIds: ids
  }));
  const panel = state.conflicts[0];
  check("\u540E\u5230\u8005\u751F\u6210\u51B2\u7A81\u9762\u677F", !!panel && panel.deviceIds.length === ids.length, `panel=${panel?.deviceIds.length}`);
  const first = state.batches.find((b) => b.name === "\u5E76\u53D1-\u5148\u5230");
  const second = state.batches.find((b) => b.name === "\u5E76\u53D1-\u540E\u5230");
  check("\u5148\u5230\u4E00\u7248\u5360\u7528\u5168\u90E8\u8BBE\u5907", state.claims.filter((c) => c.batchId === first.id).length === ids.length);
  check("\u540E\u5230\u4E00\u7248\u4E00\u53F0\u90FD\u6CA1\u5360\u7528", state.claims.filter((c) => c.batchId === second.id).length === 0);
  check("\u540E\u5230\u6279\u6B21\u540D\u989D\u4ECD\u6309\u578B\u53F7\u6E05\u5355\u7B97\u51FA\uFF08quota>0\uFF09\uFF0C\u7B49\u5F85\u540E\u7EED\u53EF\u7528\u8BBE\u5907", second.quota > 0);
}
console.log("\n[\u89C4\u52196] \u578B\u53F7\u6E05\u5355\u53D8\u66F4\uFF1A\u672A\u4E0B\u53D1\u540D\u989D\u7ACB\u5373\u91CD\u7B97\uFF0C\u5DF2\u88C5\u4E0A\u7684\u4FDD\u7559");
{
  const absentModel = { "\u534E\u4E1C": "GW-T40", "\u534E\u5357": "GW-X200", "\u65B0\u52A0\u5761": "GW-T40" };
  const actorByRegion = { "\u534E\u4E1C": OPS_HD, "\u534E\u5357": OPS_HN, "\u65B0\u52A0\u5761": OWNER };
  const candidates = ["\u534E\u4E1C:GW-X200", "\u534E\u5357:GW-T40", "\u534E\u5357:GW-X100", "\u65B0\u52A0\u5761:GW-X100", "\u534E\u4E1C:GW-X100"];
  let picked = null;
  for (const item of candidates) {
    const [region, model] = item.split(":");
    const free = state.devices.filter((d) => d.region === region && d.model === model && !state.claims.some((c) => c.deviceId === d.id)).map((d) => d.id);
    if (free.length >= 2) {
      picked = { region, model, free };
      break;
    }
  }
  if (picked) {
    const { region, model, free } = picked;
    state = releaseReducer(state, createBatch({
      actor: actorByRegion[region],
      name: "\u578B\u53F7\u91CD\u7B97\u4E13\u7528\u6279\u6B21",
      firmware: "7.0",
      rollbackVersion: "6.9",
      region,
      models: [model],
      rolloutPercent: 100,
      failureThreshold: 100,
      deviceIds: free
    }));
    const b6 = state.batches[0];
    const expectedQuota = state.devices.filter((d) => d.region === region && d.model === model && !d.resultBatchIds.includes(b6.id)).length;
    check("\u521D\u59CB\u540D\u989D = \u7B26\u5408\u578B\u53F7\u8BBE\u5907\u6570 \xD7 \u7070\u5EA6", b6.quota === expectedQuota, `quota=${b6.quota} expected=${expectedQuota}`);
    state = releaseReducer(state, approveBatch({ id: b6.id, actor: actorByRegion[region] }));
    state = releaseReducer(state, resumeBatch({ id: b6.id, actor: actorByRegion[region] }));
    state = tick2(state, 6);
    const installedBefore = state.devices.filter((d) => d.installedBatchId === b6.id).length;
    check("\u524D\u7F6E\uFF1A\u5DF2\u6709\u8BBE\u5907\u88C5\u4E0A\u65B0\u7248\u672C", installedBefore > 0, `installed=${installedBefore}`);
    state = releaseReducer(state, updateBatchModels({ id: b6.id, actor: actorByRegion[region], models: [absentModel[region]] }));
    const updated = state.batches.find((x) => x.id === b6.id);
    check("\u540D\u989D\u7ACB\u5373\u91CD\u7B97\u4E3A 0", updated.quota === 0, `quota=${updated.quota}`);
    check(
      "\u672A\u4E0B\u53D1\uFF08\u6392\u961F/claimed\uFF09\u8BBE\u5907\u88AB\u91CA\u653E",
      !state.devices.some((d) => d.region === region && d.model === model && d.state === "claimed" && state.claims.some((c) => c.deviceId === d.id && c.batchId === b6.id))
    );
    check(
      "\u5DF2\u88C5\u4E0A\u8BBE\u5907\u7684\u7ED3\u679C\u4FDD\u7559",
      state.devices.filter((d) => d.installedBatchId === b6.id).length === installedBefore,
      `before=${installedBefore} after=${state.devices.filter((d) => d.installedBatchId === b6.id).length}`
    );
  } else {
    check("\u524D\u7F6E\uFF1A\u5B58\u5728\u81F3\u5C11 2 \u53F0\u7A7A\u95F2\u8BBE\u5907\u7684\u533A\u57DF/\u578B\u53F7\uFF08\u573A\u666F\u9694\u79BB\uFF09", false);
  }
}
console.log(`
\u7ED3\u679C\uFF1A${pass} \u901A\u8FC7\uFF0C${fail} \u5931\u8D25`);
if (fail > 0) process.exit(1);
