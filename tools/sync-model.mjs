// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Black Well Foundry
// Reference model of sync protocol v1 (docs/sync-protocol-v1.md). In memory, one library per epoch.
// It exists to check the protocol fixtures; it is not a server. Clock is fixed so fixtures are exact.
// Usage: import { createLibrary, handle } from "./sync-model.mjs"
export const FIXED_TIME = "2026-11-11T12:00:00Z";
const RESERVED = new Set(["id", "createdAt", "updatedAt", "deletedAt"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FIELD = /^([A-Za-z][A-Za-z0-9]*|values\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|overrides\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const KINDS = new Set(["library", "universe", "series", "book", "manuscriptNode", "reference", "note", "template", "field",
  "entry", "fact", "question", "relationshipType", "relationship", "event", "stateChange"]);
const MAX_INT = Number.MAX_SAFE_INTEGER;
// Per op kind: required properties and their checks. Mirrors the closed op shapes in schemas/sync-v1.schema.json.
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isSeq = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= MAX_INT;
const isUuid = (v) => typeof v === "string" && UUID.test(v);
const anyKind = (v) => KINDS.has(v) || v === "document";
const OP_SHAPES = {
  create: { recordKind: anyKind, recordId: isUuid, value: isObj },
  set: { recordKind: anyKind, recordId: isUuid, field: (v) => typeof v === "string" && [...v].length <= 128 && FIELD.test(v), baseSeq: isSeq, value: () => true },
  unset: { recordKind: anyKind, recordId: isUuid, field: (v) => typeof v === "string" && [...v].length <= 128 && FIELD.test(v), baseSeq: isSeq },
  tombstone: { recordKind: anyKind, recordId: isUuid, baseSeq: isSeq },
  restore: { recordKind: anyKind, recordId: isUuid },
  purge: { recordKind: anyKind, recordId: isUuid, baseSeq: isSeq },
  document: { recordKind: (v) => v === "document", recordId: isUuid, baseRevision: isSeq, value: isObj },
  resolve: { conflictId: (v) => typeof v === "string" && [...v].length >= 1 && [...v].length <= 64 },
};

// Schema check of a push body, before any state is read. Returns null when valid, else an error response.
export function validatePush(body) {
  const bad = () => err(400, "INVALID_REQUEST", "The request body is not a valid push.");
  if (!isObj(body)) return bad();
  const top = Object.keys(body);
  if (top.length !== 3 || !top.every((k) => ["epoch", "deviceId", "ops"].includes(k))) return bad();
  if (!isUuid(body.epoch) || !isUuid(body.deviceId) || !Array.isArray(body.ops) || body.ops.length < 1 || body.ops.length > 200) return bad();
  for (const op of body.ops) {
    if (!isObj(op) || !isUuid(op.opId)) return bad();
    const shape = Object.hasOwn(OP_SHAPES, op.op) ? OP_SHAPES[op.op] : null;
    if (!shape) return bad();
    const allowed = new Set(["opId", "op", ...Object.keys(shape)]);
    if (!Object.keys(op).every((k) => allowed.has(k))) return bad();
    for (const [k, check] of Object.entries(shape)) if (!(k in op) || !check(op[k])) return bad();
  }
  return null;
}
const MESSAGES = {
  RECORD_EXISTS: "A record with this id already exists.",
  RECORD_UNKNOWN: "No such record.",
  RECORD_DELETED: "The record is in the trash.",
  RECORD_NOT_DELETED: "The record is not in the trash.",
  FIELD_UNKNOWN: "This field cannot be set.",
  INVALID_VALUE: "The value does not fit the record.",
  REFERENCE_UNRESOLVED: "The value refers to a record that does not exist.",
  OP_UNSUPPORTED: "This operation is not supported for this record kind.",
  CONFLICT_UNKNOWN: "No open conflict with this id.",
};

export function createLibrary(epoch) {
  return {
    epoch,
    head: 0,
    changes: [], // ascending seq
    records: new Map(), // recordId -> {kind, tombstone: null | {seq, opId, deviceId}, revision}
    results: new Map(), // opId -> stored result (first outcome)
    purged: new Set(), // ids of purged records: never reused
    conflicts: [], // open conflicts only, oldest first
    nextConflict: 1,
  };
}

const err = (status, code, message) => ({ status, body: { error: { code, message } } });
const resync = (lib) => ({
  status: 409,
  body: { error: { code: "RESYNC_REQUIRED", message: "The epoch or cursor is not valid for this library. Pull again from the start." }, epoch: lib.epoch, head: lib.head },
});

export function handle(lib, method, path, body) {
  const url = new URL(path, "http://sync.invalid");
  if (method === "POST" && url.pathname === "/api/sync/v1/push") return push(lib, body);
  if (method === "GET" && url.pathname === "/api/sync/v1/changes") return pull(lib, url.searchParams);
  if (method === "GET" && url.pathname === "/api/sync/v1/conflicts") return listConflicts(lib, url.searchParams);
  return err(400, "INVALID_REQUEST", "Unknown endpoint.");
}

function pull(lib, q) {
  const epoch = q.get("epoch");
  const after = q.has("after") ? q.get("after") : "0";
  const limit = q.has("limit") ? q.get("limit") : "200";
  // after: integer 0 to 2^53-1; limit: integer 1 to 1000. Canonical decimal only (no sign, no leading zeros).
  if (!UUID.test(epoch ?? "") || !/^(0|[1-9]\d{0,15})$/.test(after) || !Number.isSafeInteger(+after) ||
      !/^[1-9]\d{0,3}$/.test(limit) || +limit > 1000)
    return err(400, "INVALID_REQUEST", "Invalid query parameters.");
  if (epoch !== lib.epoch || +after > lib.head) return resync(lib);
  const changes = lib.changes.filter((c) => c.seq > +after).slice(0, +limit);
  return { status: 200, body: { epoch: lib.epoch, head: lib.head, changes: structuredClone(changes), next: changes.length ? changes[changes.length - 1].seq : +after } };
}

function listConflicts(lib, q) {
  const epoch = q.get("epoch");
  if (!UUID.test(epoch ?? "")) return err(400, "INVALID_REQUEST", "Invalid query parameters.");
  if (epoch !== lib.epoch) return resync(lib);
  // Open conflicts only, oldest first. A resolved conflict is removed from this list; only its opId result remains (for duplicates).
  const conflicts = lib.conflicts.map((c) => structuredClone(c));
  return { status: 200, body: { epoch: lib.epoch, conflicts } };
}

function push(lib, body) {
  // Pre-check order: schema (400), then epoch (409), then bases (409). Shape is validated before any state access.
  const invalid = validatePush(body);
  if (invalid) return invalid;
  if (body.epoch !== lib.epoch) return resync(lib);
  // Base checks run against the state at the start of the push.
  for (const op of body.ops) {
    if (op.baseSeq !== undefined && op.baseSeq > lib.head) return resync(lib);
    if (op.op === "document" && op.baseRevision > (lib.records.get(op.recordId)?.revision ?? 0)) return resync(lib);
  }
  const results = [];
  for (const op of body.ops) {
    const stored = lib.results.get(op.opId);
    if (stored) {
      const { status, ...rest } = stored;
      const { opId, current, message, ...keep } = rest;
      results.push({ opId: op.opId, status: "duplicate", firstStatus: status, ...keep });
      continue;
    }
    const result = { opId: op.opId, ...applyOp(lib, body.deviceId, op) };
    lib.results.set(op.opId, structuredClone(result));
    results.push(result);
  }
  return { status: 200, body: { epoch: lib.epoch, head: lib.head, results } };
}

const reject = (code, message) => ({ status: "rejected", code, message: message ?? MESSAGES[code] });

function append(lib, deviceId, op, fields) {
  const change = { seq: ++lib.head, at: FIXED_TIME, opId: op.opId, deviceId, ...fields };
  lib.changes.push(change);
  return change;
}

function openConflict(lib, props) {
  const c = { conflictId: `conflict-${lib.nextConflict++}`, ...props };
  lib.conflicts.push(c);
  return c;
}

const lastSeq = (list) => Math.max(...list.map((c) => c.seq));

function applyOp(lib, deviceId, op) {
  switch (op.op) {
    case "resolve": {
      const i = lib.conflicts.findIndex((x) => x.conflictId === op.conflictId);
      if (i < 0) return reject("CONFLICT_UNKNOWN");
      lib.conflicts.splice(i, 1);
      return { status: "applied" };
    }
    case "document": return applyDocument(lib, deviceId, op);
    case "create": {
      if (op.recordKind === "document") return reject("OP_UNSUPPORTED");
      if (lib.records.has(op.recordId) || lib.purged.has(op.recordId)) return reject("RECORD_EXISTS");
      if (!op.value || op.value.id !== op.recordId) return reject("INVALID_VALUE");
      if (op.recordKind === "manuscriptNode") {
        // Partial value check (the full archive check is the server's job, see "Values" in the protocol doc):
        // required string fields have the right type, kind is in the enum, then the references resolve.
        const bad = checkNodeShape(op.value);
        if (bad) return reject(bad);
        const unresolved = checkNodeReferences(lib, op.value);
        if (unresolved) return reject(unresolved);
      }
      lib.records.set(op.recordId, { kind: op.recordKind, tombstone: null, revision: 0 });
      const ch = append(lib, deviceId, op, { change: "create", recordKind: op.recordKind, recordId: op.recordId, value: op.value });
      return { status: "applied", seq: ch.seq };
    }
    case "set": case "unset": return applyField(lib, deviceId, op);
    case "tombstone": return applyTombstone(lib, deviceId, op);
    case "purge": return applyPurge(lib, deviceId, op);
    case "restore": {
      const rec = existing(lib, op);
      if (rec.status) return rec;
      if (!rec.tombstone) return reject("RECORD_NOT_DELETED");
      rec.tombstone = null;
      const ch = append(lib, deviceId, op, { change: "restore", recordKind: op.recordKind, recordId: op.recordId });
      return { status: "applied", seq: ch.seq };
    }
  }
  return reject("OP_UNSUPPORTED");
}

// purge: permanent delete of a book or a series, with everything that belongs to it (sync-protocol-v1.md, `purge`).
// The model holds no tables, so it reads each record's current value by replaying its changes, finds the children the way
// the protocol describes them, and applies the same feed the server does: `unset` of the book's overrides on the records
// that stay, a `purge` change per child (stateChange, reference, relationship, note, fact, question, event, entry,
// manuscriptNode, each by id), then the record's own. It does not model the refusal while a remaining record points into
// the cascade (a pointer check needs every value shape); the server's tests cover it.
function currentValue(lib, id) {
  const create = lib.changes.find((c) => c.recordId === id && c.change === "create");
  const value = structuredClone(create?.value ?? {});
  for (const c of lib.changes) {
    if (c.recordId !== id || (c.change !== "set" && c.change !== "unset")) continue;
    const ov = /^overrides\/(.+)$/.exec(c.field);
    if (ov) {
      const list = (value.overrides ?? []).filter((o) => o.bookId !== ov[1]);
      if (c.change === "set") list.push(c.value);
      if (list.length) value.overrides = list; else delete value.overrides;
    } else if (c.change === "set") value[c.field] = structuredClone(c.value);
    else delete value[c.field];
  }
  return value;
}

const PURGE_ORDER = ["stateChange", "reference", "relationship", "note", "fact", "question", "event", "entry", "manuscriptNode"];
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function purgeChildren(lib, kind, id) {
  const all = [...lib.records].map(([rid, rec]) => ({ id: rid, kind: rec.kind, value: currentValue(lib, rid) }));
  const scoped = (r) => (kind === "book" ? r.value.scope?.kind === "book" : r.value.scope?.kind === "series") && r.value.scope?.id === id;
  const nodes = kind === "book" ? all.filter((r) => r.kind === "manuscriptNode" && r.value.bookId === id) : [];
  const notes = kind === "book" ? all.filter((r) => r.kind === "note" && r.value.bookId === id) : [];
  const own = (k) => all.filter((r) => r.kind === k && scoped(r));
  const entries = own("entry"), facts = own("fact"), questions = own("question"), events = own("event");
  const nodeIds = new Set(nodes.map((r) => r.id)), entryIds = new Set(entries.map((r) => r.id)), eventIds = new Set(events.map((r) => r.id));
  const stateChanges = all.filter((r) => r.kind === "stateChange" && (nodeIds.has(r.value.nodeId) || eventIds.has(r.value.eventId) || entryIds.has(r.value.entryId)));
  const references = all.filter((r) => r.kind === "reference" && (nodeIds.has(r.value.nodeId) || entryIds.has(r.value.entryId)));
  const relationships = all.filter((r) => r.kind === "relationship" && ((kind === "book" && r.value.bookId === id) || entryIds.has(r.value.fromEntryId) || entryIds.has(r.value.toEntryId)));
  const by = { stateChange: stateChanges, reference: references, relationship: relationships, note: notes, fact: facts, question: questions, event: events, entry: entries, manuscriptNode: nodes };
  const children = PURGE_ORDER.flatMap((k) => [...by[k]].sort(byId).map((r) => ({ kind: k, id: r.id })));
  const gone = new Set(children.map((c) => c.id));
  // the book's overrides on records that stay
  const overrides = kind !== "book" ? [] : ["entry", "fact", "question", "event"].flatMap((k) =>
    all.filter((r) => r.kind === k && !gone.has(r.id) && (r.value.overrides ?? []).some((o) => o.bookId === id)).sort(byId).map((r) => ({ kind: k, id: r.id })));
  const hasBooks = kind === "series" && all.some((r) => r.kind === "book" && r.value.seriesId === id);
  return { children, overrides, hasBooks };
}

function applyPurge(lib, deviceId, op) {
  const rec = existing(lib, op);
  if (rec.status) return rec;
  if (op.recordKind !== "book" && op.recordKind !== "series") return reject("OP_UNSUPPORTED");
  const { children, overrides, hasBooks } = purgeChildren(lib, op.recordKind, op.recordId);
  if (hasBooks) return reject("INTEGRITY_VIOLATION", "The series still has books; move them out or delete them permanently first.");
  const touched = new Set([op.recordId, ...children.map((c) => c.id)]);
  const foreign = lib.changes.filter((c) => touched.has(c.recordId) && c.deviceId !== deviceId && c.seq > op.baseSeq && c.change !== "tombstone");
  if (foreign.length) {
    const c = openConflict(lib, {
      kind: "tombstone", recordKind: op.recordKind, recordId: op.recordId,
      losing: { opId: op.opId, deviceId, change: "purge", baseSeq: op.baseSeq },
      current: { seq: lastSeq(foreign) },
    });
    return { status: "conflict", conflictId: c.conflictId, current: structuredClone(c.current) };
  }
  for (const o of overrides) append(lib, deviceId, op, { change: "unset", recordKind: o.kind, recordId: o.id, field: `overrides/${op.recordId}` });
  for (const c of children) append(lib, deviceId, op, { change: "purge", recordKind: c.kind, recordId: c.id });
  const ch = append(lib, deviceId, op, { change: "purge", recordKind: op.recordKind, recordId: op.recordId });
  // Nothing is kept: the older changes of every purged record lose their value (the feed keeps its seqs), and open conflicts on them go.
  for (const c of lib.changes) if (touched.has(c.recordId) && c.change !== "purge") delete c.value;
  lib.conflicts = lib.conflicts.filter((c) => !touched.has(c.recordId));
  if (op.recordKind === "book") redactOverrides(lib, op.recordId);
  for (const id of touched) { lib.records.delete(id); lib.purged.add(id); }
  return { status: "applied", seq: ch.seq, overridesRemoved: overrides.length };
}

// A purged book's per-book data leaves the history of the records that stay: older sets of overrides/<bookId> lose their
// value, the book's item is removed from older creates and sets of `overrides` (dropped when it empties; an entry keeps
// []), and open conflicts on overrides/<bookId> are dropped. Dismissals and other fields are untouched.
function redactOverrides(lib, bookId) {
  const field = `overrides/${bookId}`;
  const without = (list) => list.filter((o) => o.bookId !== bookId);
  for (const c of lib.changes) {
    if (c.change === "set" && c.field === field) delete c.value;
    else if (c.change === "create" && ["entry", "fact", "question", "event"].includes(c.recordKind) && Array.isArray(c.value?.overrides) && c.value.overrides.some((o) => o.bookId === bookId)) {
      const list = without(c.value.overrides);
      if (list.length === 0 && c.recordKind !== "entry") delete c.value.overrides; else c.value.overrides = list;
    } else if (c.change === "set" && c.field === "overrides" && Array.isArray(c.value) && c.value.some((o) => o.bookId === bookId)) c.value = without(c.value);
  }
  lib.conflicts = lib.conflicts.filter((c) => c.field !== field);
  // a losing whole-list `overrides` that holds the book: dropped when nothing else is in it, else stripped of the item
  lib.conflicts = lib.conflicts.filter((c) => !(c.field === "overrides" && Array.isArray(c.losing?.value) && c.losing.value.some((o) => o.bookId === bookId) && c.losing.value.every((o) => o.bookId === bookId)));
  for (const c of lib.conflicts) if (c.field === "overrides" && Array.isArray(c.losing?.value)) c.losing.value = without(c.losing.value);
}

const NODE_KINDS = new Set(["part", "chapter", "scene", "frontMatter", "backMatter"]);
// manuscriptNode create value: INVALID_VALUE when a required field is missing or has the wrong type.
// Required (archive $defs.manuscriptNode): id, bookId, kind, title, orderKey, createdAt, updatedAt. Optional parentId is a uuid string.
function checkNodeShape(v) {
  for (const k of ["bookId", "kind", "title", "orderKey", "createdAt", "updatedAt"]) if (typeof v[k] !== "string") return "INVALID_VALUE";
  if (!isUuid(v.bookId) || !NODE_KINDS.has(v.kind)) return "INVALID_VALUE";
  if ("parentId" in v && !isUuid(v.parentId)) return "INVALID_VALUE";
  return null;
}
// manuscriptNode create value: REFERENCE_UNRESOLVED when the book does not exist, or parentId is not an existing manuscriptNode.
// A tombstoned target still resolves (archive integrity rules).
function checkNodeReferences(lib, v) {
  if (lib.records.get(v.bookId)?.kind !== "book") return "REFERENCE_UNRESOLVED";
  if ("parentId" in v && lib.records.get(v.parentId)?.kind !== "manuscriptNode") return "REFERENCE_UNRESOLVED";
  return null;
}

// Returns the record, or a rejected result when the op cannot address one.
function existing(lib, op) {
  if (op.recordKind === "document") return reject("OP_UNSUPPORTED");
  const rec = lib.records.get(op.recordId);
  if (!rec || rec.kind !== op.recordKind) return reject("RECORD_UNKNOWN");
  return rec;
}

function applyField(lib, deviceId, op) {
  const rec = existing(lib, op);
  if (rec.status) return rec;
  if (RESERVED.has(op.field)) return reject("FIELD_UNKNOWN");
  const foreign = lib.changes.filter((c) => c.recordId === op.recordId && c.deviceId !== deviceId && c.seq > op.baseSeq);
  let restoreBranch = null;
  if (rec.tombstone) {
    if (rec.tombstone.seq > op.baseSeq && rec.tombstone.deviceId !== deviceId) restoreBranch = rec.tombstone;
    // An op that only removes links is applied in place: the record stays in the trash, with no restore change and no
    // tombstone conflict (the field-conflict check below still applies).
    else if (!isUnlinkOnly(op.recordKind, op.field, op.op, currentValue(lib, op.recordId), op.value)) return reject("RECORD_DELETED");
  }
  const clash = foreign.filter((c) => (c.change === "set" || c.change === "unset") && c.field === op.field);
  if (clash.length) {
    const c = openConflict(lib, {
      kind: "field", recordKind: op.recordKind, recordId: op.recordId, field: op.field,
      losing: { opId: op.opId, deviceId, change: op.op, ...(op.op === "set" ? { value: op.value } : {}), baseSeq: op.baseSeq },
      current: { seq: lastSeq(clash) },
    });
    return { status: "conflict", conflictId: c.conflictId, current: structuredClone(c.current) };
  }
  if (restoreBranch) {
    rec.tombstone = null;
    append(lib, deviceId, op, { change: "restore", recordKind: op.recordKind, recordId: op.recordId });
  }
  const ch = append(lib, deviceId, op, {
    change: op.op, recordKind: op.recordKind, recordId: op.recordId, field: op.field,
    ...(op.op === "set" ? { value: op.value } : {}),
  });
  if (!restoreBranch) return { status: "applied", seq: ch.seq };
  const c = openConflict(lib, {
    kind: "tombstone", recordKind: op.recordKind, recordId: op.recordId,
    losing: { opId: restoreBranch.opId, deviceId: restoreBranch.deviceId, change: "tombstone", seq: restoreBranch.seq },
    current: { seq: ch.seq },
  });
  return { status: "applied", seq: ch.seq, conflictId: c.conflictId };
}

// The ops that only remove a link the move rule counts (sync-protocol-v1.md, `set, unset`): an unset of a fact's or
// question's nodeId; an unset of overrides/<bookId>; an unset of a node's povEntryId or settingEntryId; a set of a fact's
// knowledge with the same or fewer items; a set of an event's sceneIds to a subset; a set of a state change's eventId.
function isUnlinkOnly(kind, field, op, old, value) {
  if (op === "unset") {
    if ((kind === "fact" || kind === "question") && field === "nodeId") return true;
    if (/^overrides\/[0-9a-f-]{36}$/.test(field) && ["entry", "fact", "question", "event"].includes(kind)) return true;
    return kind === "manuscriptNode" && (field === "povEntryId" || field === "settingEntryId");
  }
  if (kind === "stateChange") return field === "eventId" && old.nodeId !== undefined; // only a state change that names a scene
  if (kind === "event" && field === "sceneIds") return Array.isArray(value) && Array.isArray(old.sceneIds) && value.every((id) => old.sceneIds.includes(id));
  if (kind === "fact" && field === "knowledge") {
    const before = Array.isArray(old.knowledge) ? old.knowledge : [];
    return Array.isArray(value) && value.length <= before.length &&
      value.every((n) => n && typeof n === "object" && before.some((o) => o.knower === n.knower && (n.nodeId === undefined || n.nodeId === o.nodeId)));
  }
  return false;
}

function applyTombstone(lib, deviceId, op) {
  const rec = existing(lib, op);
  if (rec.status) return rec;
  if (rec.tombstone) return reject("RECORD_DELETED");
  const foreign = lib.changes.filter((c) => c.recordId === op.recordId && c.deviceId !== deviceId && c.seq > op.baseSeq && c.change !== "tombstone");
  if (foreign.length) {
    const c = openConflict(lib, {
      kind: "tombstone", recordKind: op.recordKind, recordId: op.recordId,
      losing: { opId: op.opId, deviceId, change: "tombstone", baseSeq: op.baseSeq },
      current: { seq: lastSeq(foreign) },
    });
    return { status: "conflict", conflictId: c.conflictId, current: structuredClone(c.current) };
  }
  const ch = append(lib, deviceId, op, { change: "tombstone", recordKind: op.recordKind, recordId: op.recordId });
  rec.tombstone = { seq: ch.seq, opId: op.opId, deviceId };
  return { status: "applied", seq: ch.seq };
}

function applyDocument(lib, deviceId, op) {
  const rec = lib.records.get(op.recordId);
  if (!rec || rec.kind !== "manuscriptNode") return reject("RECORD_UNKNOWN");
  if (!op.value || op.value.nodeId !== op.recordId) return reject("INVALID_VALUE");
  const losing = { opId: op.opId, deviceId, change: "document", baseRevision: op.baseRevision, value: op.value };
  const conflict = (seq) => {
    const c = openConflict(lib, { kind: "document", recordKind: "document", recordId: op.recordId, losing, current: { seq, revision: rec.revision } });
    return { status: "conflict", conflictId: c.conflictId, current: structuredClone(c.current) };
  };
  if (rec.tombstone) return conflict(rec.tombstone.seq);
  if (op.baseRevision !== rec.revision) {
    return conflict(lastSeq(lib.changes.filter((c) => c.recordId === op.recordId && c.change === "document")));
  }
  rec.revision += 1;
  const ch = append(lib, deviceId, op, { change: "document", recordKind: "document", recordId: op.recordId, revision: rec.revision, value: op.value });
  return { status: "applied", seq: ch.seq, revision: rec.revision };
}
