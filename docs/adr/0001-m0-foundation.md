# ADR-0001: M0 project engine and compatibility foundation

- Status: Proposed. Implemented in M0. Items marked **OWNER** need owner approval before they're locked.
- Date: 2026-11-02
- Scope: canonical document schema, storage model, scope referential integrity, portable archive, cross-platform adapters.
- Sources: *Writers Rolltop — Developer Handoff* v1.0 (Word document, authoritative). Where it's silent, engineering detail comes from the companion zip brief (archive safety caps, error-envelope style, sync rules for later milestones).

## Context

Writers Rolltop ships as native Apple apps (proprietary) and as a free, open-source self-hosted web studio. Projects must round-trip between them without semantic loss, work fully offline, and never silently lose or rewrite author text. M0 builds the engine and the open format before any UI or sync.

## Decisions

### D1. Canonical scene document: editor-independent JSON, closed schema

Every document-bearing manuscript node (scene, front matter, back matter) stores one canonical document:

```json
{ "schema": "writers-rolltop/document", "version": 1, "nodeId": "<uuid>",
  "blocks": [ { "id": "<uuid>", "type": "paragraph", "content": [
      { "type": "text", "text": "The rain arrived", "marks": [ { "type": "emphasis" } ] },
      { "type": "hardBreak" } ] } ] }
```

- Blocks are `paragraph` and `heading` (level 1–6). Inline nodes are `text` and `hardBreak`. Marks are `strong`, `emphasis`, `link {href}` and `anchor {id}`.
- Every block has a stable UUID. **Anchors** are stable IDs over a passage. Manuscript→bible references and future comments attach to anchors, never to character offsets.
- The schema is **closed** within a version. A v1 reader rejects unknown node or mark types with an actionable "newer document version" error, so it never drops content it doesn't understand. New content types bump `version`.
- Normalization (exact rules in `docs/document-format-v1.md`): line terminators in text become `hardBreak`; marks are de-duplicated and sorted; adjacent runs with equal marks merge; empty runs are dropped. **Unicode is not normalized** (no NFC/NFD rewrite). Text compares by exact scalar/code-unit sequence.
- TextKit 2 (native) and Tiptap/ProseMirror (web) are **adapters**. Their internal formats are never stored or exported.

Alternatives rejected: Markdown as canonical. It's ambiguous for anchors and block IDs and normalizes differently per parser. ProseMirror JSON as canonical: that ties the format to one editor's schema, which the handoff forbids.

### D2. Storage model: one library = one SQLite database + content-addressed attachments

```
<Name>.rolltoplib/
  library.sqlite            # GRDB, WAL, foreign_keys=ON, application_id, user_version
  attachments/<sha256>      # immutable, verified on write
  backups/                  # pre-migration and pre-replace backups (SQLite online backup API)
```

- GRDB.swift 7.x (`DatabaseQueue`, WAL mode, `DatabaseMigrator`). Every write is one transaction. Migrations run in a transaction after an online backup. A database whose applied migrations are unknown to this build (newer schema) is refused with an actionable error. It is never opened read-write.
- Records carry `created_at` and `updated_at`. User-deletable records also carry `deleted_at` (tombstones). Unknown archive fields are kept in `extra_json` (see D4).
- Ordering uses **fractional order keys**: base-36 strings, compared bytewise, no trailing `0`. Ties are broken by UUID. A move or insert rewrites one row.
- Scene documents live in `scene_document` with a monotonically increasing `revision`. Every save appends an immutable `document_revision` row in the same transaction. A save carries the expected revision (compare-and-swap). A stale save fails with a conflict error and **does not overwrite**.
- Attachments are files named by SHA-256, written to a temp file, hash-verified, then atomically renamed. Bytes are never stored inside documents or the database.

### D3. Scope referential integrity: real foreign keys, never a polymorphic ID

Story-bible entries and continuity events are scoped to exactly one of universe, series or book. They store three nullable FK columns `universe_id`, `series_id` and `book_id` with `CHECK (exactly one is non-null)`. Every reference is a real `FOREIGN KEY`, so there is no unchecked `scope_id` + `scope_type` pair. The same pattern applies to anything else that could attach to "one of several owners".

Book-level **overrides** (historical state that doesn't rewrite shared canon) live in `entry_override_value(entry_id, book_id, field_id, value_json)`. A trigger requires the book to be inside the entry's scope. Continuity **state changes** belong to events, so canon changes over story time are explicit records rather than edits to the entry.

Triggers enforce the hierarchy rules SQL types can't express: parts sit at book root, chapters at root or under a part, scenes under chapters, and a node's parent is in the same book. Triggers also enforce that a book's universe matches its series' universe and that a field belongs to the entry's template. Value typing (integer vs decimal vs fictional date) and document-anchor existence are checked by the shared validator (D5), not SQL.

### D4. Portable archive: `.rolltop` ZIP, format version 1

Layout follows the handoff. Two files are added: `attachments.json` (attachment metadata) and the template/field split already listed. The full byte-level specification is in `docs/archive-format-v1.md`.

```
manifest.json  library.json  manuscript/<node-uuid>.json
bible/{entries,templates,fields,relationships}.json
continuity/{events,state_changes}.json  references.json
attachments.json  attachments/<sha256>.<ext>  checksums.json
```

- An archive is a **whole library** in M0. Single-book export is deferred because it needs merge semantics for shared universe canon.
- `checksums.json` lists SHA-256 and byte length for every other file. `manifest.json` pins the SHA-256 of `checksums.json`. Missing, extra or mismatched files are rejected.
- Paths are an allowlist. Absolute paths, `..`, `.`, backslashes, empty segments, symlinks, directories outside the allowlist, case-insensitive duplicate paths, more than 10,000 entries, more than 2 GiB expanded, more than 100 MiB per JSON file, more than 250 MiB per attachment, and suspicious compression ratios are rejected. Byte counts are enforced while extracting, not trusted from headers.
- Top-level records are **open**: unknown optional fields are preserved through import/export (`extra_json`). Documents are **closed** (D1).
- Tombstoned records are exported with `deletedAt`, so the trash round-trips and references always resolve.
- Import is all-or-nothing. The archive is fully validated into an in-memory snapshot, then written to a staging library, integrity-checked, and atomically renamed into place. Replacing an existing library requires an explicit confirmation flag and leaves a backup. Nothing is ever extracted over a live library.
- Revision history is **not** exported in v1. Only current documents are. **OWNER** (see Q3).

### D5. One validator, one snapshot type

`LibrarySnapshot` is a value type holding every record of a library. The database exports to and imports from a snapshot, and the archive reads and writes a snapshot. One `SnapshotValidator` checks referential integrity, field-value typing, scope rules, document validity and anchors for both. Round-trip acceptance compares normalized snapshots (records sorted by ID, documents normalized, attachment hashes).

### D6. Cross-platform adapters

- Native: `RolltopTextKit` maps canonical ↔ `NSAttributedString`. Blocks are newline-terminated paragraphs. `hardBreak` is U+2028. Block ID, type, level and marks are custom attributes. Links keep their exact `href` string.
- Web: `writers-rolltop-server/packages/document-adapter` maps canonical ↔ Tiptap/ProseMirror JSON (`bold`, `italic`, `link`, custom `rolltopAnchor` mark with `excludes: ""`, and `id` attrs on blocks).
- Both are tested against the same spec fixtures: `canonical → editor → canonical` must equal the normalized input.

### D7. Repositories

| Repo | M0 contents |
|---|---|
| `writers-rolltop-spec` (public, Apache-2.0) | ADRs, format docs, compatibility policy, JSON Schemas, conformance fixtures (valid, invalid, malicious), dependency-free schema checker |
| `writers-rolltop-apple` (private) | `RolltopKit` Swift package: model, store, archive, TextKit adapter, `rolltop` CLI, tests |
| `writers-rolltop-server` (public, AGPL-3.0-only) | Web document-adapter prototype and tests; the M3 studio and the M4 sync API come later |

Spec fixtures are vendored into the other repos with a pinned spec commit. `scripts/sync-spec-fixtures.sh` refreshes them.

## Owner decisions (not blocking M0; reversible defaults chosen)

| # | Question | M0 default |
|---|---|---|
| Q1 | Final archive extension: `.rolltop` vs a neutral `.zip` alias | `.rolltop`; readers accept any extension |
| Q2 | Open-source license for spec and server | **Decided 2026-11-02 by owner:** spec Apache-2.0; server AGPL-3.0-only (copyright kept by The Black Well Foundry, contributions under a CLA so the license can be relaxed later). Native app stays proprietary |
| Q3 | Include revision history in archives? | Current state only |
| Q4 | Archive = whole library, or also per-book export? | Whole library only |
| Q5 | Minimum OS versions | macOS 14 / iOS 17 for the package (GRDB 7 supports these) |
| Q6 | Single sync provider per project | Not relevant until M2/M4; schema doesn't preclude either |
| Q7 | Add underline, alignment and lists to document v1 (they appear in the UI mockup)? | Not included; adding them later means a document version bump |

## Consequences

- Strict closed documents mean an older app can't edit content from a newer one. It refuses with a clear message instead of corrupting it.
- Whole-library archives are simple and lossless but can be large. Splitting comes later.
- Exact-Unicode comparison means visually identical text in different normalization forms is "different". That's intended: we never rewrite author bytes.

## Verification

See [`docs/m0-verification.md`](../m0-verification.md) for commands and results.

## Rollback

Everything is versioned: database migrations (`grdb_migrations`), archive `formatVersion`, document `version`. Every decision above can change in a later version with a migration and fixtures for the previous version.
