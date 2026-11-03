# Portable archive format, version 1 (`.rolltop`)

Rationale: [ADR-0001 D4](adr/0001-m0-foundation.md). Schemas: [`schemas/`](../schemas). The archive is open and documented, and it is usable without any vendor service. One archive holds one whole **library**.

## Container

A standard ZIP file (stored or DEFLATE entries, no encryption, no ZIP64 requirement below 4 GiB). Readers MUST accept the archive whatever its filename extension. The proposed extension is `.rolltop` (owner decision Q1).

```
manifest.json
checksums.json
library.json
references.json
notes.json
attachments.json
manuscript/<node-uuid>.json
bible/entries.json  bible/templates.json  bible/fields.json  bible/relationships.json
continuity/events.json  continuity/state_changes.json
attachments/<sha256>[.<ext>]
```

Every listed JSON file is required (use `[]` or the empty object form when there's nothing to store). No other paths are permitted in version 1. All JSON is UTF-8 without BOM.

## Common value types

| Type | Format |
|---|---|
| UUID | lowercase `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` (hex) |
| Timestamp | RFC 3339 UTC with `Z`, optional fractional seconds, e.g. `2026-11-02T12:00:00Z` |
| OrderKey | `^[0-9a-z]+$` with no trailing `0`. Siblings sort bytewise ascending, then by UUID |
| SHA-256 | 64 lowercase hex characters |
| Scope | `{ "kind": "universe" \| "series" \| "book", "id": UUID }` |
| FictionalDate | `{ "label": string (non-empty), "calendar"?: string, "ordinal"?: integer }`. Calendar-agnostic: `label` is what the author wrote, `calendar` names an in-world calendar, and `ordinal` is an optional comparable position within that calendar. No Gregorian assumption |

Optional properties are **omitted** when absent; `null` is not used. Integers must be within ±(2^53−1) for JavaScript interop.

## Files

### `manifest.json`
`{ format: "writers-rolltop-archive", formatVersion: 1, archiveId, libraryId, createdAt, generator: { name, version }, checksums: { path: "checksums.json", byteLength, sha256 } }`

### `checksums.json`
`{ algorithm: "sha256", files: [ { path, byteLength, sha256 } ] }` covers every entry except `manifest.json` and itself, sorted by `path`. The set of listed paths must equal the set of present entries exactly.

### `library.json`
```
{ library: { id, title, createdAt, updatedAt },
  universes:  [ { id, title, summary?, orderKey, createdAt, updatedAt, deletedAt? } ],
  series:     [ { id, universeId?, title, summary?, orderKey, createdAt, updatedAt, deletedAt? } ],
  books:      [ { id, universeId?, seriesId?, title, subtitle?, authorName?, description?, language?,
                  coverAttachment?, targetWordCount?, targetDate?, orderKey, createdAt, updatedAt, deletedAt? } ],
  manuscriptNodes: [ { id, bookId, parentId?, kind, title, synopsis?, status?, orderKey,
                       createdAt, updatedAt, deletedAt? } ] }
```
- Hierarchy is Library → Universe? → Series? → Book → Part? → Chapter → Scene. If a book has `seriesId` and that series has `universeId`, the book's `universeId` must be equal. A series with `universeId` makes the book's `universeId` required.
- `targetWordCount` (integer ≥ 1) and `targetDate` (`YYYY-MM-DD`) are the author's optional goal for the book. Goals are informational and never restrict writing.
- `kind` ∈ `part`, `chapter`, `scene`, `frontMatter`, `backMatter`. Parent rules: `part`, `frontMatter`, `backMatter` → no parent. `chapter` → no parent or a `part`. `scene` → a `chapter`. A parent must be in the same book.
- Every `scene`, `frontMatter` and `backMatter` node has exactly one `manuscript/<id>.json` ([document format](document-format-v1.md)) whose `nodeId` equals the node id. Other kinds have none.

### `bible/templates.json`
`[ { id, name, entryType, builtIn, orderKey, createdAt, updatedAt, deletedAt? } ]`. `entryType` ∈ `character`, `location`, `organization`, `object`, `event`, `plotline`, `worldRule`, `research`.

### `bible/fields.json`
`[ { id, templateId, key, label, fieldType, required, multiple?, options?, targetEntryTypes?, orderKey, createdAt, updatedAt, deletedAt? } ]`
- `key` is unique within a template, matching `^[a-z][a-zA-Z0-9_]{0,63}$`.
- `fieldType` and value encoding:

| fieldType | JSON value |
|---|---|
| `shortText`, `longText` | string |
| `integer` | integer |
| `decimal` | string `^-?(0\|[1-9][0-9]*)(\.[0-9]+)?$` (no binary float loss) |
| `boolean` | boolean |
| `selection` | array of option ids from `options`; at most one unless `multiple: true` |
| `realDate` | string `YYYY-MM-DD` (a valid proleptic Gregorian date) |
| `fictionalDate` | FictionalDate |
| `entryReference` | UUID of an entry (whose type is in `targetEntryTypes` when that's given) |
| `entryReferences` | array of unique entry UUIDs |
| `attachment` | SHA-256 of an attachment in `attachments.json` |

- `options` (required for `selection`, forbidden otherwise): `[ { id, label } ]`.
- `required` is an authoring hint for editors. Readers don't reject entries that are missing a required value, because authors fill in bibles gradually.

### `bible/entries.json`
`[ { id, entryType, templateId?, name, aliases, summary?, scope, values, overrides, attachments, createdAt, updatedAt, deletedAt? } ]`
- `templateId`'s template must have the same `entryType`. `values` is an object `{ fieldId: value }`. Every key must be a field of the entry's template (no template means `values` must be empty).
- `overrides`: `[ { bookId, values } ]`, one per book. These are book-specific state that does **not** modify shared canon. The book must be inside the entry's scope: a universe scope means the book's `universeId` equals it, and a series scope means the book's `seriesId` equals it. Book-scoped entries cannot have overrides.
- `attachments`: array of unique SHA-256 strings.

### `bible/relationships.json`
`{ relationshipTypes: [ { id, label, inverseLabel, orderKey, createdAt, updatedAt, deletedAt? } ], relationships: [ { id, typeId, fromEntryId, toEntryId, bookId?, note?, createdAt, updatedAt, deletedAt? } ] }`. `fromEntryId ≠ toEntryId`. `bookId`, when present, limits the relationship to that book's story state.

### `continuity/events.json`
`[ { id, scope, title, summary?, when?, orderKey, entryId?, sceneIds, participants, createdAt, updatedAt, deletedAt? } ]`
- A timeline is the set of events with the same scope, ordered by `orderKey` then `id`.
- `sceneIds` are unique `scene` nodes in books within the event's scope. `participants`: `[ { entryId, role? } ]` with unique `entryId`. `entryId` optionally links a bible entry of type `event`.

### `continuity/state_changes.json`
`[ { id, eventId, entryId, fieldId, value, note?, createdAt, updatedAt, deletedAt? } ]`. `fieldId` must be a field of the entry's template, and `value` must match its type. A state change records that the field takes `value` from that event onward in the event's timeline.

### `references.json`
`[ { id, nodeId, anchorId, entryId, createdAt, updatedAt, deletedAt? } ]`. `nodeId` must be a node with a document and `entryId` an entry. `(nodeId, anchorId, entryId)` is unique. If the anchor isn't in the node's document (the linked words were deleted), the reference is kept and reported as the warning `W_REFERENCE_ANCHOR_MISSING`, so undo or a version restore can bring the passage back. Applications only create references to anchors that exist.

### `notes.json`
`[ { id, bookId, nodeId?, text, orderKey, createdAt, updatedAt, deletedAt? } ]`. Short plain-text notes the writer pins to a level of the manuscript. Without `nodeId` a note belongs to the whole book. With it, the note is pinned to that node (typically a chapter or scene), which must be in the same book. `text` is plain text (no markup) of at most 20,000 characters. `orderKey` orders the notes that share a pin.

### `attachments.json` and `attachments/`
`[ { sha256, mediaType, byteLength, originalName?, extension?, createdAt } ]`. Each entry has exactly one file `attachments/<sha256>` or `attachments/<sha256>.<extension>` (`extension` matches `^[a-z0-9]{1,10}$`) whose bytes hash to `sha256` with length `byteLength`. Every referenced SHA-256 must be listed.

## Integrity rules

- IDs are globally unique across all record types in an archive. The exception is attachments, which are keyed by hash.
- Every reference resolves, including to tombstoned records. Records with `deletedAt` are trash and are exported so they can be restored.
- References from live records to tombstoned ones are **warnings**, not errors.

## Forward compatibility

- **Top-level records and the manifest are open.** Readers MUST preserve unknown properties on them through import and re-export. This doesn't apply to nested objects (values, options, participants, overrides, FictionalDate), which are closed.
- **Documents are closed** (see document format).
- A `formatVersion` greater than the reader supports is rejected with `ARCHIVE_UNSUPPORTED_VERSION` and a message naming the version. Older supported versions are migrated on import.

## Reader safety requirements

| Check | Limit or rule | Error |
|---|---|---|
| Entry count | ≤ 10,000 | `ARCHIVE_TOO_LARGE` |
| Total expanded bytes, counted while extracting | ≤ 2 GiB | `ARCHIVE_TOO_LARGE` |
| JSON file size | ≤ 100 MiB | `ARCHIVE_TOO_LARGE` |
| Attachment size | ≤ 250 MiB | `ARCHIVE_TOO_LARGE` |
| Compression ratio, for entries > 1 MiB | ≤ 200:1 | `ARCHIVE_TOO_LARGE` |
| Bytes extracted vs header size | must match | `ARCHIVE_CORRUPT` |
| Absolute path, `..`, `.`, `\`, empty segment, NUL | rejected | `ARCHIVE_PATH_TRAVERSAL` |
| Symlink or other non-file entry (directory entries ignored) | rejected | `ARCHIVE_SYMLINK` |
| Duplicate path (case-insensitive) | rejected | `ARCHIVE_DUPLICATE_PATH` |
| Path not in allowlist | rejected | `ARCHIVE_UNEXPECTED_FILE` |
| Required file missing | rejected | `ARCHIVE_MISSING_FILE` |
| Hash or length mismatch | rejected | `ARCHIVE_CHECKSUM_MISMATCH` |
| Invalid UTF-8 | rejected | `ARCHIVE_INVALID_UTF8` |
| Malformed JSON | rejected | `ARCHIVE_INVALID_JSON` |
| Wrong `format`, newer version | rejected | `ARCHIVE_NOT_ROLLTOP`, `ARCHIVE_UNSUPPORTED_VERSION` |
| Shape or type violation | rejected | `SCHEMA_VIOLATION` |
| Unresolved reference | rejected | `REFERENCE_UNRESOLVED` |
| Rule violation (hierarchy, scope, field typing, duplicate id) | rejected | `INTEGRITY_VIOLATION` |
| Invalid document | rejected | `DOCUMENT_INVALID`, `DOCUMENT_UNSUPPORTED_VERSION` |

The limits are defaults. Implementations may make them configurable but must not remove them. Readers never write outside a private staging location, and never touch a live library, until validation has succeeded.

## Import semantics

1. Validate everything (container → checksums → JSON → schema → integrity → documents) into memory and staging.
2. Show a preview: library title, counts, words, warnings, and whether the target already exists.
3. Default: create a **new** library. Replacing an existing library requires explicit user approval and keeps a backup of the replaced library.
4. Commit atomically. On any failure the target is unchanged and the original archive is untouched.

## Warnings (advisory, never block import, never alter prose)

| Code | Condition |
|---|---|
| `W_REFERENCE_TO_DELETED` | A live record references a tombstoned record |
| `W_CHRONOLOGY_ORDINAL` | Two live events in one timeline with the same `when.calendar` whose `orderKey` order contradicts their `when.ordinal` order |
| `W_STATE_CONFLICT` | Two live state changes for the same event, entry and field with different values |
| `W_REFERENCE_ANCHOR_MISSING` | A live reference's anchor is no longer in its node's document |
