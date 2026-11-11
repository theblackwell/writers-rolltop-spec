# Sync protocol, version 1

Status: Draft period, format version 1, additive, M1-5. Owner decisions 2026-11-11 recorded.

## Owner decisions

- Target (approved 2026-11-11, "for now approved"): one author across their own devices (Mac, iPhone, iPad, self-hosted web). Not multi-user. Conflicts arise only between one author's devices.
- Document compare-and-swap is device-independent. The own-device rule applies only to `baseSeq` conflict checks, never to a document's `baseRevision` check.
- `deviceId` must be fresh after a restore from backup, a clone, a device migration or an import (see Client rules).
- `GET /conflicts` lists open conflicts only. A resolved conflict is not retained or listed by the server and is not retrievable; the client keeps any copy of a losing value it has not chosen to keep.
- Pushes are checked in this order: schema 400, epoch 409, bases 409. One malformed op rejects the whole push with 400; a base past head rejects the whole push with 409, and the client holds the bad ops and resends the rest. A conflict on the same field beats restore (the record stays trashed and the edit is kept in the conflict record); a different-field edit restores the record and reports a tombstone conflict. A client saves the losing value locally before sending `resolve`. One document op per node per push, and `create` before document ops for the same node.
- A same-epoch base problem (`baseSeq` past head, `baseRevision` past the node's revision) is held for author review by the client, not re-sent with a rebased base.
- A rejected result is permanent for its opId.
- A server restored or rolled back from backup gets a new epoch.

Schemas: [`schemas/sync-v1.schema.json`](../schemas/sync-v1.schema.json). Fixtures: [`fixtures/sync/`](../fixtures/sync). Reference model: [`tools/sync-model.mjs`](../tools/sync-model.mjs). Versioning rules: [compatibility policy](compatibility-policy.md). Record and field names follow the [archive format](archive-format-v1.md); the document is the [canonical scene document](document-format-v1.md). Rationale for the compare-and-swap rule: [ADR-0001](adr/0001-m0-foundation.md) (a stale save fails and never overwrites).

The protocol moves one author's library between that author's own devices and a server over HTTPS and JSON. It never discards text: a change that cannot be applied cleanly is kept as a conflict, and the author decides.

**Not in this document:** authentication (M1-7), which is a single owner login. Every endpoint below is unauthenticated here. A server MUST NOT expose them without the M1-7 rules.

## Concepts

- **Unit of change:** one field of one record. Records are the archive's records; there is no whole-record overwrite after create.
- **Record kinds:** `library`, `universe`, `series`, `book`, `manuscriptNode`, `reference`, `note`, `template`, `field`, `entry`, `fact`, `question`, `relationshipType`, `relationship`, `event`, `stateChange`. The extra kind `document` (a scene document; its `recordId` is the node id) exists for document operations and changes only. Attachments are not in v1: attachment bytes sync later by hash (owner decision E). `book.coverAttachment` is only a hash value here.
- **Field name:** a top-level archive property name (`title`, `synopsis`, ...), or `values/<fieldId>` or `overrides/<bookId>` (lowercase uuid suffix). `id`, `createdAt`, `updatedAt` and `deletedAt` are reserved and not settable (`FIELD_UNKNOWN`). Timestamps are derived by the server.
- **Epoch:** a uuid naming one library lineage (owner decision D). A new library and every archive import (new library or replace) start a new epoch. Every push and pull carries the epoch. A server never mixes sequences of two epochs.
- **Server seq:** an integer per epoch. `head` is the last assigned seq and starts at 0. Seq is assigned in acceptance order. Device clocks never order changes or decide conflicts. A change's `at` (RFC 3339 UTC) is server time and informational.
- **deviceId:** a client uuid, stable per installation and fresh when a copy of the installation is made or restored (Client rules 6). **opId:** a client uuid, unique per library; a client never reuses an opId for different content.
- **Tombstone:** the record is in the trash. Ids are never reused, even after a tombstone.
- **Revision:** the integer version of one scene document. It starts at 0 (no document). The first save uses `baseRevision` 0 and creates revision 1.

All JSON is UTF-8, objects as in the schema, optional properties omitted when absent, integers within +-(2^53-1).

## Endpoints

### `POST /api/sync/v1/push`

Body `{ "epoch", "deviceId", "ops": [ ... ] }`, 1 to 200 ops. Request body limit 16 MiB (`PAYLOAD_TOO_LARGE`, 413, beyond it). A document value is limited to 8 MiB. Response 200 `{ "epoch", "head", "results": [ ... ] }`, one result per op in order.

### `GET /api/sync/v1/changes?epoch=&after=&limit=`

`after` defaults to 0 and is an integer from 0 to 2^53-1 (canonical decimal; else 400); `limit` defaults to 200 and is an integer from 1 to 1000 (else 400). An `after` greater than `head` is 409 `RESYNC_REQUIRED`. Returns `{ "epoch", "head", "changes", "next" }`: changes with seq greater than `after`, ascending; `next` is the last seq returned, or `after` when there are none. A client that has `next < head` asks again with `after=next`.

### `GET /api/sync/v1/conflicts?epoch=`

Returns `{ "epoch", "conflicts": [ ... ] }`: open conflicts only, oldest first. A resolved conflict is not listed and cannot be retrieved. There is no filter parameter.

## Operations

Ops in a push are applied in array order. Each op is atomic with its stored result and its change(s); the push as a whole is not atomic, so a later op can fail after an earlier one applied.

| `op` | Fields | Meaning |
|---|---|---|
| `create` | `recordKind`, `recordId`, `value` (object, `value.id == recordId`) | New record |
| `set` | `recordKind`, `recordId`, `field`, `baseSeq`, `value` | Set one field |
| `unset` | `recordKind`, `recordId`, `field`, `baseSeq` | Remove one optional field |
| `tombstone` | `recordKind`, `recordId`, `baseSeq` | Move to trash |
| `restore` | `recordKind`, `recordId` | Take out of trash (no base) |
| `document` | `recordKind: "document"`, `recordId` (node id), `baseRevision`, `value` (document, `nodeId == recordId`) | Save a scene document |
| `resolve` | `conflictId` | Close an open conflict |

`baseSeq` is the head the client had pulled up to when it made the edit.

### Pre-checks

Before any op is applied, in this order, for the whole push:

1. The body does not match the schema: 400 `INVALID_REQUEST`. This covers each op's shape (known `op`, required properties, types, no extra properties), so a malformed op never reaches state. `baseSeq` and `baseRevision` must be integers from 0 to 2^53-1: a string, a fractional or a negative value is 400.
2. The epoch differs from the library's: 409 `RESYNC_REQUIRED`.
3. Against the state at the start of the push, any op has `baseSeq` greater than `head`, or a `document` op has `baseRevision` greater than the node's current revision (0 when the node does not exist): 409 `RESYNC_REQUIRED`. The client's view is from another history, or from a server that was rolled back.

If a pre-check fails, no op of the push is applied. Cases 2 and 3 return the same 409; the client tells them apart by the epoch it sent (Client rules 2 and 7).

### Own-device rule

A change made by the same `deviceId` never causes a conflict for that device's `set`, `unset` or `tombstone` op. Those conflict checks consider only changes with `deviceId` different from the op's and `seq > baseSeq`. The rule applies to `baseSeq` checks only. It never applies to a document's `baseRevision` check, which is device-independent: a stale save is a conflict even when the same device made the newer revision.

### Rules per op

**create.** The id must not exist (`RECORD_EXISTS`), even if the record was tombstoned. `value.id` must equal `recordId` (`INVALID_VALUE`). Kind `document` is `OP_UNSUPPORTED`. Appends a `create` change. A client pushes `create` before any other op for the same node (including `document` ops).

**set, unset.** The record must exist (`RECORD_UNKNOWN`). A reserved field is `FIELD_UNKNOWN`. Kind `document` is `OP_UNSUPPORTED`, as it is for `tombstone` and `restore`.
- If the record is tombstoned: when the tombstone's seq is greater than `baseSeq` and its deviceId differs from the op's, the op is *eligible for restore* (the edit wins); otherwise `RECORD_DELETED`.
- Field conflict: any change by another device with seq greater than `baseSeq`, on the same record, of type `set` or `unset`, on the same field, makes the op a conflict (kind `field`). Nothing is applied. `current.seq` is the latest such change's seq. This check comes before the restore branch, so a conflicting op leaves a tombstoned record tombstoned.
- Eligibility for restore looks only at the tombstone, not at the field. A trashed record that is also field-conflicted therefore behaves per field: an edit to the conflicted field is a field conflict and the record stays trashed; an edit from the same stale base to a different field, with no conflict on that field, takes the restore branch (record live again, tombstone conflict recorded). It is `RECORD_DELETED` only when the base is at or after the tombstone or the tombstone is the op's own device's (see the `delete-vs-edit-conflicting-edit` and `delete-vs-edit-trashed-bases` fixtures).
- If eligible for restore and no field conflict: append a `restore` change (same opId), then the `set` or `unset` change. The record is live again. The result is `applied` with the seq of the set or unset change and a `conflictId`. That conflict has kind `tombstone`, `losing` `{opId, deviceId, change:"tombstone", seq}` of the other device's tombstone, and `current.seq` the edit's seq. The author can see that a delete lost.
- Otherwise `applied` with the seq.

**tombstone.** Kind `document` is `OP_UNSUPPORTED`. The record must exist (`RECORD_UNKNOWN`); already tombstoned is `RECORD_DELETED`. If any change by another device with seq greater than `baseSeq` touched the record (any change type except `tombstone`, including `restore` and `document` changes on that node), the op is a conflict of kind `tombstone`, `losing` `{opId, deviceId, change:"tombstone", baseSeq}`, `current.seq` the latest such seq. The record stays live. Otherwise it is applied.

**restore.** Explicit and has no base. Kind `document` is `OP_UNSUPPORTED`. `RECORD_UNKNOWN` if absent, `RECORD_NOT_DELETED` if live; otherwise applied with a `restore` change.

**document.** The node (`manuscriptNode`) must exist (`RECORD_UNKNOWN`); `value.nodeId` must equal `recordId` (`INVALID_VALUE`).
- Tombstoned node: not rejected. Stored as a conflict of kind `document`, `losing` `{opId, deviceId, change:"document", baseRevision, value}`, `current` `{seq: the tombstone's seq, revision}`. Text must never be lost.
- `baseRevision` differs from the current revision: the same conflict, `current` `{seq: the last document change's seq, revision}`.
- Otherwise applied: revision increases by one, a `document` change with `revision` and `value` is appended, and the result carries `seq` and `revision`.

**resolve.** An open conflict is closed: `applied`, no seq, no change. An unknown or already resolved id is `rejected` `CONFLICT_UNKNOWN`. Resolving closes the conflict and it no longer appears in the list. The server does not keep or expose the closed conflict or its `losing` value; only the stored result for the `resolve` opId remains, so a duplicate gets the same answer. A client MUST save the losing value locally before it sends `resolve`, because the server keeps no copy; the client, not the server, holds any losing value it has not chosen to keep. To keep one side, the client sends ordinary ops (for example a new `set` or `document` save based on the current state) before or after resolving. A later good save does not close a conflict by itself.

### Idempotency

The result of every op is stored for the epoch, keyed by opId. A retry (a repeated push, or a repeated opId in one batch) is answered with `status: "duplicate"`, `firstStatus` (`applied`, `conflict` or `rejected`) and the same `seq`, `revision`, `conflictId` or `code` as the first answer. The operation is not applied again, whatever its content now is. A new conflict is not created for a duplicate. A duplicate of a restore-branch edit keeps its `conflictId`.

Results are permanent per opId, rejected ones included. After a `rejected` result a client that wants to try again uses a new opId; resending the old opId only returns the same rejection as a duplicate, even if the cause (say a missing record) is gone.

## Results

Each result has `opId` and `status`:

| `status` | Extra fields |
|---|---|
| `applied` | `seq` (absent for `resolve`), `revision` (document), `conflictId` (restore branch) |
| `conflict` | `conflictId`, `current` `{seq, revision?}` |
| `rejected` | `code`, `message` |
| `duplicate` | `firstStatus`, and the stored `seq`, `revision`, `conflictId`, `code`; `conflictId` is always present when `firstStatus` is `conflict`, `code` when it is `rejected` |

A conflict is `{conflictId, kind, recordKind, recordId, field?, losing, current}` with `kind` `field`, `tombstone` or `document`. `losing` is the side that was not applied (or, for the restore branch, the delete that lost); `current` points at what the server holds. The conflict stays open, and listed, until a `resolve` closes it. `conflictId` is opaque.

### Per-op rejection codes

`RECORD_EXISTS`, `RECORD_UNKNOWN`, `RECORD_DELETED`, `RECORD_NOT_DELETED`, `FIELD_UNKNOWN`, `INVALID_VALUE`, `REFERENCE_UNRESOLVED`, `INTEGRITY_VIOLATION`, `DOCUMENT_INVALID`, `OP_UNSUPPORTED`, `CONFLICT_UNKNOWN`. The reference model produces `RECORD_EXISTS`, `RECORD_UNKNOWN`, `RECORD_DELETED`, `RECORD_NOT_DELETED`, `FIELD_UNKNOWN`, `INVALID_VALUE`, `OP_UNSUPPORTED` and `CONFLICT_UNKNOWN`. `REFERENCE_UNRESOLVED`, `INTEGRITY_VIOLATION` and `DOCUMENT_INVALID` are possible from a server that checks values against the archive and document rules, but they are not modelled, and v1 fixtures do not use them. Protocol fixtures use minimal record values.

## Errors

Request-level errors are `{ "error": { "code", "message" } }`; the message is at most 200 characters and never contains a stack trace or raw client text.

| Code | Status | When |
|---|---|---|
| `INVALID_REQUEST` | 400 | body or query does not match the schema or ranges |
| `RESYNC_REQUIRED` | 409 | wrong epoch, `after` or a `baseSeq` past head, `baseRevision` past the node's revision, or an unknown epoch on conflicts |
| `PAYLOAD_TOO_LARGE` | 413 | body over 16 MiB (or a document over 8 MiB) |

`RESYNC_REQUIRED` carries the current `epoch` and `head`: `{ "error": {...}, "epoch", "head" }`. The epoch-409 and base-409 bodies are identical, so the order of the epoch and base checks is not observable on the wire; only schema-before-epoch is.

## Client rules

1. One `document` op per node per push. Later saves wait for the earlier result so the next `baseRevision` is known. After a whole-push 409 (rule 7), ops that depend on a held op are held too and nothing dependent is re-sent.
2. After `RESYNC_REQUIRED` for a different epoch (or a cursor past head on a pull), the client pulls from `after=0` under the epoch the server reports, and rebuilds its view of the server.
3. Ops whose response was lost in the old epoch are NOT silently re-sent under the new epoch. The client shows them to the author for review. Open risk: until the review exists, an unreviewed edit may wait on the device; nothing is lost on the device, but it is not on the server until the author decides.
4. Retry a push with the same opIds when the response was lost and the epoch is unchanged. Duplicates are safe.
5. Never assign seq or compare device clocks. Order is the server's.
6. A `deviceId` must be fresh (a new uuid) on restore from backup, clone, device migration or import. A restored copy must not keep the old deviceId: two histories under one deviceId would hide real conflicts from each other through the own-device rule. The server cannot detect a clone. Open risk: a client that breaks this rule can silently overwrite its other copy's field edits; the protocol has no defence beyond this rule.
7. A same-epoch base problem (409 `RESYNC_REQUIRED` with the epoch the client sent, from `baseSeq` past head or `baseRevision` past the node's revision) means the edits were made against a history the server does not have. The client holds those ops for author review. It does not re-send them with a rebased `baseSeq`. In detail: (a) the 409 rejects the whole push, so no op in that push was applied; (b) the client identifies the offending ops by comparing each op's `baseSeq` and `baseRevision` with its own cursor and revision; (c) it holds only those ops for author review; (d) after a whole-push 409 the client also holds any op that depends on a held op (the same record; for documents, the same node), and holds dependent ops in their original order; nothing dependent is re-sent; it re-sends the remaining ops with their original opIds, which is safe because nothing in the rejected push was applied; and (e) retrying the whole batch unchanged loops forever.
8. A `rejected` result is final. To try again after fixing the cause, send a new opId. Push `create` before the `document` and field ops for the same node. The server stores no rejected op, whatever the code (`RECORD_DELETED` included), so the client MUST hold the content of any rejected op, document ops included, locally until the author has reviewed it.
9. Before sending `resolve`, the client MUST save the losing value locally (see `resolve`).

## Rollback and epochs

A server restored or rolled back from a backup MUST start a new epoch. Otherwise a client that is ahead of the restored log would push `baseSeq` values that look valid, and seq numbers would be reused for different changes. A new epoch makes every client pull again and take the review path of Client rules 2 and 3. Open risk: nothing in the protocol enforces this; a server that restores a backup and keeps the epoch can corrupt client views. Operators must follow this rule.

## Not covered in v1

- Attachment bytes (sync by hash later) and attachment records.
- Authentication and authorization (M1-7): scope is a single owner login. Multi-user roles and sharing are not designed here.
- iCloud transport on Apple (a different transport for the same change model, later).
- Conflict resolution UI (the protocol only stores and lists open conflicts).
- Log compaction and retention of old changes.
- Tombstone-conflict scope: the tombstone rule looks only at changes to the one record. Cascade effects (tombstoning a parent while a child is edited) and dangling references (`REFERENCE_UNRESOLVED`, `INTEGRITY_VIOLATION`) are not checked in v1.
- Known gap, fixed in the model: `validatePush` counted string length in UTF-16 units while the schema counts code points, which differs for astral characters. The model now counts code points (`[...str].length`) to match the schema.
- Detecting a cloned or restored `deviceId` (open risk, Client rules 6).
- Server-side validation of values against the archive rules. The archive and document fixtures cover values.
- The 413 limits are specified but not exercised by the reference model.

## Conformance

The sync fixtures are normative for rules above. `node tools/check-schemas.mjs` checks every fixture request against the schema, runs the reference model, validates each response against the schema, and compares it with the expected body. In a fixture, `@name` (an `@`, a letter, then letters or digits) captures a value on first use and must match later; a request string equal to a captured `@name` is replaced by the captured value; `*` matches any string. Captures are for conflict ids only: the first-use value must be a string of 1 to 64 characters, and any other type fails (the response is also checked against the schema). The sigil `@` is reserved: a fixture literal must not start with `@`, and the checker rejects an expected string that does and is not a valid capture name. A step marked `invalid_request` must be rejected by the schema, and the model must answer it with the expected 400. The checker fails if `fixtures/sync` is missing or empty or does not hold the expected number of scenario files. Open note: captures are not tied to a field position; an `@name` in any string field of a request or expected body captures. Behaviour is unchanged. A server conforms when it produces the same status and body for every step on a fresh library (with the fixture's epoch), other than the `at` values, which the reference clock fixes at `2026-11-11T12:00:00Z`.
