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
bible/facts.json  bible/questions.json
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
                  coverAttachment?, targetWordCount?, targetDate?, logline?, premise?, themes?, arcs?, principles?, bibleVersion?, orderKey, createdAt, updatedAt, deletedAt? } ],
  manuscriptNodes: [ { id, bookId, parentId?, kind, title, synopsis?, status?, povEntryId?, settingEntryId?, targetWordCount?, plan?,
                       orderKey, createdAt, updatedAt, deletedAt? } ] }
```
- Hierarchy is Library → Universe? → Series? → Book → Part? → Chapter → Scene. If a book has `seriesId` and that series has `universeId`, the book's `universeId` must be equal. A series with `universeId` makes the book's `universeId` required.
- `targetWordCount` (integer ≥ 1) and `targetDate` (`YYYY-MM-DD`) are the author's optional goal for the book. Goals are informational and never restrict writing.
- `logline`, `premise`, `themes`, `arcs` and `principles` are the book's story overview: plain text, 1–20,000 characters each.
- `bibleVersion` (1–32 characters, such as `1.8`) is the version label of the story bible last exported for the book. Exported copies themselves are not part of the archive.
- On `part` and `chapter` nodes, `targetWordCount` (integer ≥ 1) is a planned length and `plan` (plain text, 1–20,000 characters) the planned beats. Both are informational.
- `povEntryId` (the point-of-view character) and `settingEntryId` (where it takes place) are only allowed on `chapter` and `scene` nodes. They must be a `character` and a `location` entry respectively, visible from the node's book (scoped to its universe, its series or the book itself).
- `kind` ∈ `part`, `chapter`, `scene`, `frontMatter`, `backMatter`. Parent rules: `part`, `frontMatter`, `backMatter` → no parent. `chapter` → no parent or a `part`. `scene` → a `chapter`. A parent must be in the same book.
- Every `scene`, `frontMatter` and `backMatter` node has exactly one `manuscript/<id>.json` ([document format](document-format-v1.md)) whose `nodeId` equals the node id. Other kinds have none.

### `bible/templates.json`
`[ { id, name, entryType, builtIn, orderKey, createdAt, updatedAt, deletedAt? } ]`. `entryType` ∈ `character`, `location`, `organization`, `object`, `event`, `plotline`, `worldRule`, `research`, `term` (a glossary term, such as a word of an invented language).

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
| `table` | `{ columns, rows }`: `columns` is 1–20 strings (headings), `rows` up to 500 arrays of strings, each with exactly one string per column; every string at most 1,000 characters |

- `options` (required for `selection`, forbidden otherwise): `[ { id, label } ]`.
- `required` is an authoring hint for editors. Readers don't reject entries that are missing a required value, because authors fill in bibles gradually.

### `bible/entries.json`
`[ { id, entryType, templateId?, name, givenName?, familyName?, toBeNamed?, aliases, summary?, scope, values, overrides, attachments, createdAt, updatedAt, deletedAt? } ]`
- `templateId`'s template must have the same `entryType`. `values` is an object `{ fieldId: value }`. Every key must be a field of the entry's template (no template means `values` must be empty).
- `overrides`: `[ { bookId, values } ]`, one per book. These are book-specific state that does **not** modify shared canon. The book must be inside the entry's scope: a universe scope means the book's `universeId` equals it, and a series scope means the book's `seriesId` equals it. Book-scoped entries cannot have overrides.
- `attachments`: array of unique SHA-256 strings.
- `toBeNamed: true` marks an entry whose name is a placeholder ("Conclave recruiter, to be named"). Omitted otherwise.
- `givenName` and `familyName` (non-empty strings) are a character's first and last name. They're only allowed on `character` entries. `name` stays the display name; editors build it from the two parts, but readers don't require it to match. Two characters with the same `familyName` are expected to have a relationship between them ("not related to" is a valid answer); editors ask for one, and readers never reject an archive without it.

### `bible/facts.json`
`[ { id, scope, text, truth, nodeId?, entryIds, knowledge, dismissedWarnings?, orderKey, createdAt, updatedAt, deletedAt? } ]`. Established facts the story must stay consistent with, and secrets.
- `scope` works as for entries (the world, a series or one book). `text` is plain text, 1–20,000 characters.
- `truth` ∈ `true`, `false`, `undecided`. A `false` fact is something characters are told or believe that isn't so (a lie, a mistake); the reader can learn it like any other fact.
- `nodeId` is the `chapter` or `scene` where the fact is established; its book must be inside the fact's scope.
- `entryIds`: unique entries the fact is about.
- `knowledge`: `[ { knower, nodeId? } ]`, who knows the fact and from when. `knower` is `"reader"` or the id of a `character` entry, unique within the fact. `nodeId` (a `chapter` or `scene` in a book inside the fact's scope) is where they learn it; without it, they know it from the start. A knower who isn't listed doesn't know it.
- `dismissedWarnings`: continuity warnings about this fact that the author has marked as intentional (see [Dismissed continuity warnings](#dismissed-continuity-warnings)).
- `orderKey` orders the facts that share a scope.

### `bible/questions.json`
`[ { id, scope, text, topic?, status, decision?, entryIds, nodeId?, dismissedWarnings?, orderKey, createdAt, updatedAt, deletedAt? } ]`. Open story questions and the decisions that close them.
- `scope` as for entries. `text` is plain text, 1–20,000 characters; `decision` up to 20,000. `topic` is a short label (at most 64 characters) used to group questions, such as "The Overlord".
- `status` ∈ `open`, `decided`. A decided question keeps its text; `decision` records the answer.
- `entryIds`: unique entries the question is about. `nodeId` is the `chapter` or `scene` by which it should be decided ("decide when writing that chapter"); its book must be inside the question's scope.
- `dismissedWarnings`: continuity warnings about this question marked as intentional (see below).
- `orderKey` orders the questions that share a scope.

### `bible/relationships.json`
`{ relationshipTypes: [ { id, label, inverseLabel, orderKey, createdAt, updatedAt, deletedAt? } ], relationships: [ { id, typeId, fromEntryId, toEntryId, bookId?, note?, createdAt, updatedAt, deletedAt? } ] }`. `fromEntryId ≠ toEntryId`. `bookId`, when present, limits the relationship to that book's story state.

### `continuity/events.json`
`[ { id, scope, title, summary?, when?, orderKey, entryId?, sceneIds, participants, dismissedWarnings?, createdAt, updatedAt, deletedAt? } ]`
- A timeline is the set of events with the same scope, ordered by `orderKey` then `id`.
- `sceneIds` are unique `scene` nodes in books within the event's scope. `participants`: `[ { entryId, role? } ]` with unique `entryId`. `entryId` optionally links a bible entry of type `event`.
- `dismissedWarnings`: conflicting state changes at this event marked as intentional (see below).

### `continuity/state_changes.json`
`[ { id, eventId?, nodeId?, entryId, fieldId, value, note?, createdAt, updatedAt, deletedAt? } ]`. `fieldId` must be a field of the entry's template, and `value` must match its type. Exactly one of `eventId` and `nodeId` is present. With `eventId`, the field takes `value` from that event onward in the event's timeline. With `nodeId` (a `chapter` or `scene` in a book inside the entry's scope), it takes `value` from that point onward in that book's reading order, as in "after the third stronghold, Ben can combine words".

### `references.json`
`[ { id, nodeId, anchorId, entryId, createdAt, updatedAt, deletedAt? } ]`. `nodeId` must be a node with a document and `entryId` an entry. `(nodeId, anchorId, entryId)` is unique. If the anchor isn't in the node's document (the linked words were deleted), the reference is kept and reported as the warning `W_REFERENCE_ANCHOR_MISSING`, so undo or a version restore can bring the passage back. Applications only create references to anchors that exist.

### `notes.json`
`[ { id, bookId, nodeId?, text, orderKey, createdAt, updatedAt, deletedAt? } ]`. Short plain-text notes the writer pins to a level of the manuscript. Without `nodeId` a note belongs to the whole book. With it, the note is pinned to that node (typically a chapter or scene), which must be in the same book. `text` is plain text (no markup) of at most 20,000 characters. `orderKey` orders the notes that share a pin.

### `attachments.json` and `attachments/`
`[ { sha256, mediaType, byteLength, originalName?, extension?, createdAt } ]`. Each entry has exactly one file `attachments/<sha256>` or `attachments/<sha256>.<extension>` (`extension` matches `^[a-z0-9]{1,10}$`) whose bytes hash to `sha256` with length `byteLength`. Every referenced SHA-256 must be listed.

### Dismissed continuity warnings
Applications show advisory continuity warnings (below). An author can mark one as intentional, and it's then no longer shown. A fact, question or event records this in its optional `dismissedWarnings`: `[ { warning, note?, dismissedAt } ]`.
- `warning` is the warning's key, below. Keys are unique within the record. `note` (1–2,000 characters) says why it's intentional. `dismissedAt` is a timestamp.
- Each key names the places involved. If they change (a knower now learns the fact in a different chapter), the key no longer matches, and the warning shows again. Keys that no longer match anything are kept as they are; readers don't reject them, and applications may remove them.
- Readers MUST keep keys they don't recognize, including keys of warning kinds added later. A key is at most 400 characters and matches `^[A-Za-z]+(:[0-9A-Za-z-]+)*$`.
- An array is never empty: omit the property instead.

Continuity warnings are worked out from the records, never from the prose, so every edition finds the same ones. "Before" means earlier in story order: books in the order of the story they belong to (the fact's or question's scope), then each book's reading order, where a chapter comes just before its scenes.

| Warning | On | Key | Shown when |
|---|---|---|---|
| Learned before established | fact | `learnedBeforeEstablished:<knower>:<learnNodeId>:<factNodeId>` | a knower learns the fact in a chapter or scene before the one where it's established |
| Established in the trash | fact | `establishedInTrash:<factNodeId>` | the fact's `nodeId` is tombstoned, or inside a tombstoned chapter, part or book |
| Learned in the trash | fact | `learnedInTrash:<knower>:<learnNodeId>` | a knower's `nodeId` is in the trash in the same sense |
| About a missing entry | fact | `aboutMissingEntry:<entryId>` | an `entryIds` entry is tombstoned |
| Knower missing | fact | `knowerMissing:<knower>` | a character knower is tombstoned |
| Undecided but known | fact | `undecidedButKnown` | `truth` is `undecided` and `knowledge` isn't empty |
| Question overdue | question | `questionOverdue:<nodeId>` | an `open` question's `nodeId` (live) already has text: the scene's document, or any document under the chapter, has at least one word |
| State conflict | event | `stateConflict:<entryId>:<fieldId>` | live state changes at this event set the entry's field to different values (`W_STATE_CONFLICT`) |

`<knower>` is `reader` or the character's id. Only live facts, questions and events have warnings.

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
