# M0 verification report

- Date: 2026-11-02
- Environment: macOS 26.7.1 (Apple M5), Xcode 27.2, Swift 6.4.2, Node 26.10.0
- Scope: handoff §8 M0, "Project engine and compatibility foundation." Decisions: [ADR-0001](adr/0001-m0-foundation.md).
- State: all three repositories have **uncommitted** working trees. Nothing has been pushed.

## Commands

| Repo | Command | Result |
|---|---|---|
| spec | `node tools/check-schemas.mjs` | `30 passed, 0 failed` |
| apple | `cd Packages/RolltopKit && swift test` | `Test run with 26 tests in 6 suites passed` |
| apple | `scripts/crash-test.sh 10` | `PASS: 10 SIGKILL rounds, no acknowledged save lost` |
| server | `cd packages/document-adapter && node --test test/` | `tests 7, pass 7, fail 0` |

The CLI was also checked against every spec archive fixture with `rolltop validate`. All 24 returned their expected result (2 valid, 12 invalid, 10 malicious).

## M0 acceptance criteria (handoff §8)

| Criterion | Evidence | Status |
|---|---|---|
| Export from a populated DB → import into a fresh DB → normalized semantic content, IDs, links, ordering, attachments and hashes match | `ArchiveTests` "export → import into a fresh library is semantically identical": byte-identical canonical snapshot, per-attachment SHA-256, sibling order, overrides, cross-book references, every custom field type, trash. CLI: source and imported digests both `f1d56e2b…4c13` | **Pass** |
| Reject malicious archives | 10 malicious fixtures (`../`, absolute path, backslash, `.` segment, symlink, duplicate path, case-duplicate, unexpected file ×2, 50 MiB zip bomb) are rejected with the specified codes, nothing is written outside staging, and no target is created. Plus 12 corrupt fixtures (checksum, missing file or attachment, newer format, foreign format, invalid UTF-8 or JSON, broken reference, invalid or newer document, scope violation, scene at root) | **Pass** |
| Migrations preserve fixtures | `StoreTests` "pending migrations run after a backup…": a failing v2 migration rolls back with the schema and data unchanged and a `pre-migration` backup present; a succeeding v2 migration preserves the snapshot byte-for-byte; a newer-schema library is refused and left byte-identical | **Pass**, with a caveat: only schema v1 exists, so v2 is synthetic |
| A 100,000-word sample manuscript round-trips and remains responsive | 100,097 words in 106 scenes. Create 0.18 s, export 0.19 s (243 KiB), import + full verification 0.66 s, load one scene 0.001 s, save one scene (CAS + revision) 0.003 s, full integrity check 0.14 s | **Pass** (baseline only, see below) |
| Canonical JSON schemas and fixtures | `schemas/` plus document fixtures (3 valid, 2 normalization pairs, 11 invalid) and 24 archive fixtures, all schema-checked | **Pass** |
| SQLite schema, migrations, repository, integrity validation | Triggers for hierarchy, scope, template and override rules; exactly-one-scope `CHECK`; immutable revisions; compare-and-swap saves; trash and restore; `integrity_check`, `foreign_key_check`, hashes and validator | **Pass** |
| CLI `create`, `validate`, `export`, `import`, `inspect` | Implemented, plus `sample`; exercised end to end | **Pass** |
| Conformance tests: cross-book character references, custom fields, chronology, corrupted archives | Covered by the sample library, `ArchiveTests` and the fixtures. Chronology: fictional-calendar timeline, state changes, and the `W_CHRONOLOGY_ORDINAL` / `W_STATE_CONFLICT` warnings | **Pass** |
| Minimal native ⇄ web document adapter with no semantic loss | Native: `NSAttributedString` adapter round-trips every fixture. Web: TypeScript Tiptap/ProseMirror adapter round-trips every fixture. Both independently pass the same document conformance fixtures | **Pass** |
| Versioned compatibility policy | [compatibility-policy.md](compatibility-policy.md) | **Done** |

## Data-safety checks beyond M0's list

- **Process crash during save:** 10 rounds of SIGKILL during continuous saves. Every acknowledged revision survived, the revision history matched the head, and the library validated each time.
- **Stale save:** a save against an old revision raises `REVISION_CONFLICT` and the stored text is unchanged.
- **Export over an existing file** only replaces it after a complete, verified archive exists. A corrupt attachment store aborts the export and leaves the previous file intact.
- **Import** never overwrites. Replacing needs explicit confirmation and keeps the old library as a sibling backup.

## Not verified yet (honest gaps)

1. **Power loss and low storage.** The code relies on SQLite WAL with `synchronous=FULL` and atomic renames. Real power-cut and disk-full tests need devices (handoff §9) and are planned for M1/M2.
2. **Live editor behavior.** The native adapter is tested on attributed strings, not inside a running TextKit 2 editor (IME composition, undo, VoiceOver). The web adapter is tested on JSON, not inside a running Tiptap editor. Both belong to M1 and M3.
3. **Performance targets.** These are single-run baselines on an M5 Mac, not product budgets. Targets get set after profiling on agreed baseline devices, including the 1,000-scene and large-bible fixtures.
4. **Real schema migration.** Only v1 exists. A fixture database from each released schema version must be checked in from the first real migration on.
5. **CI.** Workflows are written but have never run, because nothing has been pushed.

## Decisions still needing the owner

See ADR-0001 §"Owner decisions." In short: archive extension, open-source license, revision history in archives, per-book export, minimum OS versions. Also new from the UI mockup: whether document format v1 should add **underline, alignment and lists** before it's frozen.
