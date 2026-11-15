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

Text must not contain U+0000 (NUL). This covers every string value and every property name in every JSON file of the archive. (A NUL can only appear in JSON as the escape `\u0000`.) Readers reject such an archive with `SCHEMA_VIOLATION`, naming the file and the record id, never the text. Reason: PostgreSQL cannot store NUL, so the self-hosted server could not hold what the apps accept. Document text already bans U+0000 ([document format](document-format-v1.md), rule 3); inside a document the code stays `DOCUMENT_INVALID`. Added 2026-11-10 inside the draft period of version 1 as a tightening; see [compatibility policy](compatibility-policy.md), rules 1 and 7.

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
- Hierarchy is Library → Universe? → Series? → Book → Part? → Chapter → Scene. If a book has `seriesId`, the book's `universeId` must equal its series' `universeId`: both absent, or the same universe. A series with a `universeId` makes the book's `universeId` required, and a series with no `universeId` holds only books with no `universeId`.
- `targetWordCount` (integer 1 to 9,999,999) and `targetDate` (`YYYY-MM-DD`) are the author's optional goal for the book. Goals are informational and never restrict writing.
- `logline`, `premise`, `themes`, `arcs` and `principles` are the book's story overview: plain text, 1–20,000 characters each.
- `bibleVersion` (1–32 characters, such as `1.8`) is the version label of the story bible last exported for the book. Exported copies themselves are not part of the archive.
- `targetWordCount` (integer 1 to 9,999,999) is allowed on `part` and `chapter` nodes only; scenes, front matter and back matter have none. On `part` and `chapter` nodes it is a planned length and `plan` (plain text, 1–20,000 characters) the planned beats. Both are informational.
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
`[ { id, scope, text, truth, nodeId?, entryIds, knowledge, overrides?, dismissedWarnings?, orderKey, createdAt, updatedAt, deletedAt? } ]`. Established facts the story must stay consistent with, and secrets.
- `scope` works as for entries (the world, a series or one book). `text` is plain text, 1–20,000 characters.
- `truth` ∈ `true`, `false`, `undecided`. A `false` fact is something characters are told or believe that isn't so (a lie, a mistake); the reader can learn it like any other fact.
- `nodeId` is the `chapter` or `scene` where the fact is established; its book must be inside the fact's scope.
- `entryIds`: unique entries the fact is about.
- `knowledge`: `[ { knower, nodeId? } ]`, who knows the fact and from when. `knower` is `"reader"` or the id of a `character` entry, unique within the fact. `nodeId` (a `chapter` or `scene` in a book inside the fact's scope) is where they learn it; without it, they know it from the start. A knower who isn't listed doesn't know it.
- `dismissedWarnings`: continuity warnings about this fact that the author has marked as intentional (see [Dismissed continuity warnings](#dismissed-continuity-warnings)).
- `overrides`: book-specific versions of the fact (see [Book overrides on records](#book-overrides-on-records)).
- `orderKey` orders the facts that share a scope.

### `bible/questions.json`
`[ { id, scope, text, topic?, status, decision?, entryIds, nodeId?, overrides?, dismissedWarnings?, orderKey, createdAt, updatedAt, deletedAt? } ]`. Open story questions and the decisions that close them.
- `scope` as for entries. `text` is plain text, 1–20,000 characters; `decision` up to 20,000. `topic` is a short label (at most 64 characters) used to group questions, such as "The Overlord".
- `status` ∈ `open`, `decided`. A decided question keeps its text; `decision` records the answer.
- `entryIds`: unique entries the question is about. `nodeId` is the `chapter` or `scene` by which it should be decided ("decide when writing that chapter"); its book must be inside the question's scope.
- `overrides`: book-specific versions of the question (see [Book overrides on records](#book-overrides-on-records)).
- `dismissedWarnings`: continuity warnings about this question marked as intentional (see below).
- `orderKey` orders the questions that share a scope.

### `bible/relationships.json`
`{ relationshipTypes: [ { id, label, inverseLabel, orderKey, createdAt, updatedAt, deletedAt? } ], relationships: [ { id, typeId, fromEntryId, toEntryId, bookId?, note?, createdAt, updatedAt, deletedAt? } ] }`. `fromEntryId ≠ toEntryId`. `bookId`, when present, limits the relationship to that book's story state.

### `continuity/events.json`
`[ { id, scope, title, summary?, when?, orderKey, entryId?, sceneIds, participants, overrides?, dismissedWarnings?, createdAt, updatedAt, deletedAt? } ]`
- A timeline is the set of events with the same scope, ordered by `orderKey` then `id`.
- `sceneIds` are unique `scene` nodes in books within the event's scope. `participants`: `[ { entryId, role? } ]` with unique `entryId`. `entryId` optionally links a bible entry of type `event`.
- `overrides`: book-specific versions of the event, including its participants (see [Book overrides on records](#book-overrides-on-records)).
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

Continuity warnings are worked out from the records, never from the prose, so every edition finds the same ones. "Before" means earlier in story order: books in the order of the story they belong to (the fact's or question's scope), then each book's reading order, where a chapter comes just before its scenes. A fact, question or event whose `scope` is a trashed universe, a trashed series, or a series inside a trashed universe raises no warning (it is not shown), and nor does a record scoped to a book inside a trashed series or universe; the warning returns when the universe or series is restored.

| Warning | On | Key | Shown when |
|---|---|---|---|
| Learned before established | fact | `learnedBeforeEstablished:<knower>:<learnNodeId>:<factNodeId>` | a knower learns the fact in a chapter or scene before the one where it's established |
| Established in the trash | fact | `establishedInTrash:<factNodeId>` | the fact's `nodeId` is tombstoned, or inside a tombstoned chapter, part or book |
| Learned in the trash | fact | `learnedInTrash:<knower>:<learnNodeId>` | a knower's `nodeId` is in the trash in the same sense |
| About a missing entry | fact | `aboutMissingEntry:<entryId>` | an `entryIds` entry is tombstoned |
| Knower missing | fact | `knowerMissing:<knower>` | a character knower is tombstoned |
| Undecided but known | fact | `undecidedButKnown` | `truth` is `undecided` and `knowledge` isn't empty |
| Question overdue | question | `questionOverdue:<nodeId>` | an `open` question's `nodeId` (live) already has text: the scene's document, or any document under the chapter, has at least one word; only live text counts, so a tombstoned scene or chapter, or anything inside one or inside a tombstoned part or book, adds none |
| State conflict | event | `stateConflict:<entryId>:<fieldId>` | live state changes at this event set the entry's field to different values (`W_STATE_CONFLICT`) |

`<knower>` is `reader` or the character's id. Only live facts, questions and events have warnings. For records with book overrides, the warnings are worked out per book (see below).

### Book overrides on records
A fact, question or timeline event may carry `overrides`: book-specific versions of that record that don't change shared canon. For example, a fact can be `false` in the first book and `true` after it, or an event can have other participants in one book. The property is optional.

| Record | Keys an override may set |
|---|---|
| fact | `text`, `truth` (same rules as the top-level property) |
| question | `text`, `status`, `decision` (same rules) |
| event | `title`, `summary`, `when`, `participants` (same shape and rules as the top-level property) |

- Omit `overrides` when there are none. The array is never empty (`minItems: 1`).
- Each item is closed (no unknown keys) and has at least one key besides `bookId`. Otherwise `SCHEMA_VIOLATION`.
- `bookId` names a book, which may be in the trash, as for entries. Otherwise `REFERENCE_UNRESOLVED`. Each `bookId` appears at most once in the array; a repeat is `INTEGRITY_VIOLATION`.
- A book-scoped record cannot have overrides. Otherwise the override's book must be inside the record's scope, as for entries (see the `overrides` rule under entries). Breach: `INTEGRITY_VIOLATION`.
- An override replaces a value. It cannot remove one, because the format has no `null`. For `summary` and `decision`, an empty string means "blank in this book". For an event's `participants`, an empty list means "nobody in this book".
- Shared fields stay shared: `id`, `scope`, `orderKey`, timestamps, links (`nodeId`, `entryIds`, `knowledge`, `sceneIds`, `entryId`) and `dismissedWarnings`. `dismissedWarnings` stays shared: dismissing a warning on a shared record hides it in every book.

**Effective version.** A record's version for book B is the record with each key present in B's override replacing the top-level value. Other books never see it, and a book's override does not pass to later books.

**As-of order.** An entry's value as of a chapter or scene of book B is worked out in this order, and the last value found wins:
1. shared canon: the entry's top-level value;
2. changes placed in earlier books of the entry's scope, in library order (the live books in the scope, by `orderKey`), each applied in full;
3. this book's entry override, if it has one;
4. this book's own changes up to that chapter or scene, in reading order.

Records have no state changes, so a record's As-of view in book B is simply its effective version for B. Record overrides follow the same idea: canon, then this book's override, never inherited by later books.

**Warnings per book.** Continuity warnings and As-of views are worked out per book from the effective record. For book B, each record in B's scope is read as B sees it (its effective version, including its `when` for chronology), and the warnings above are computed from those versions and from B's reading order. A warning appears in each book where its condition holds.

**Compatibility.** These are optional properties on top-level records, so `formatVersion` stays 1 and no version bump is made: additive optional fields need none ([compatibility policy](compatibility-policy.md), rule 2), and the format is still in its draft period. Readers that do not know the property preserve it on round trip.

**Draft-period change (2026-11-15).** An event override's `participants` may now be an empty list (it had `minItems: 1`). This loosens a rule, so it is not additive; it is made inside the draft period of version 1, as the earlier draft-period changes were. `overrides` itself still has `minItems: 1`, and each item still needs a key besides `bookId`.

## Integrity rules

- IDs are globally unique across all record types in an archive. The exception is attachments, which are keyed by hash.
- Every reference resolves, including to tombstoned records. Records with `deletedAt` are trash and are exported so they can be restored.
- References from live records to tombstoned ones are **warnings**, not errors.
- A book's `universeId` equals its series' `universeId`: both absent, or the same universe. A series with no universe holds only books with no universe, and a series with a universe holds only books of that universe. Breach: `INTEGRITY_VIOLATION`.
- A purged book or series is gone: sync's `purge` op (see [sync protocol](sync-protocol-v1.md)) permanently removes it and everything that belongs to it, and an export simply omits those records (there is nothing to restore). Its overrides on records that stay go too, from their history as well. Its attachment rows, and any attachment file no remaining record uses, go with it. Trash and restore stay as above for every record, books and series included; only a purge is permanent. A purge takes no backup: archives, exports and backups made earlier are out of its reach and can bring the records back.

## Writer rules (not checked on import)

These rules govern the act of changing a library: they apply to the sync write path (a `create`, `set`, `unset`, `tombstone` or `purge`), and an editor that writes through it follows them. A reader does not check them: an archive that holds a state a writer would refuse is not rejected on import (trash is exported so it can be restored, see above), and the reader need not warn. A writer refuses a breach with `INTEGRITY_VIOLATION` (a rule violation; no new code) and stores nothing.

- Trashing a universe or series is always allowed, whatever its scope holds. Its shared records are hidden by the display rules below and come back when it is restored. Restore is always allowed, for every kind of record.
- Nothing new is added to a trashed universe or series. A live fact, entry, question or event cannot be created with a `scope` that is a trashed universe or series, nor moved into one by changing its `scope`; a book cannot be created in, or moved into, a trashed universe or series (`universeId`, `seriesId`); a series cannot be created in, or moved into, a trashed universe. A live series that sits in a trashed universe counts as trashed. Restore the universe or series first. Book-scoped records are not affected, and a record already in a trashed scope stays editable.
- A book does not move out of a series or universe while records that stay would be left pointing outside the new scope. A `set` or `unset` of a book's `seriesId` or `universeId` is refused while any of these links to the book remain on the shared records (entries, facts, questions, events) of the scope it would leave: overrides of the book; a fact's or question's `nodeId`, a fact's knowledge entries and an event's `sceneIds` that name a scene or chapter of the book; state changes at a scene of the book on such an entry; and the `povEntryId` and `settingEntryId` of the book's nodes that name such an entry. Links held by records in the trash count too, and the message says so; a writer lets the author unlink them in place. The refusal message gives counts and kinds only, for example "Unlink first: 3 scene links (2 in the trash)."
- A series that has books, live or trashed, keeps its `universeId`: a `set` or `unset` of it is refused with the message "Move its books out of the series first." A series with no books may change or drop its universe freely.
- A purge of a book or series is refused while a record that stays still points into what it would remove, and a purge of a series is refused while any book (live or trashed) is still in it. See the `purge` rule in the sync protocol.

## Display rules

A child is not shown when its parent is trashed. These rules decide what an application shows and exports; nothing is stored differently, no `deletedAt` changes, and a restore brings everything back.

- A fact, entry, question or event whose `scope` is a trashed universe, a trashed series, or a series inside a trashed universe is not shown: an application leaves it out of its lists and the story-bible export, and it has no continuity warnings.
- A book inside a trashed series or universe (or in a series inside a trashed universe) is not shown, and neither are the records scoped to it (the bible export of such a book is not found). A book that is itself in the trash follows the existing trash rules.

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
| Shape or type violation, including U+0000 in a string value or property name | rejected | `SCHEMA_VIOLATION` |
| Unresolved reference | rejected | `REFERENCE_UNRESOLVED` |
| Rule violation (hierarchy, scope, field typing, duplicate id, a book's universe differing from its series') | rejected | `INTEGRITY_VIOLATION` |
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
