# M0 verification report

- Date: 2026-11-08 (replaces the 2026-11-02 report, which was against rejected code).
- Environment (checked 2026-11-08): macOS 26.7.1, Apple M5, Swift 6.4.2, Xcode 27.2, Node 26.10.0, Python 3.9.6.
- Scope: handoff §8 M0, "Project engine and compatibility foundation". Decisions: [ADR-0001](adr/0001-m0-foundation.md). Plan: `M0-PLAN.md` in the project root.
- Sources at verification time (git): Spec `781612e`; Apple `4cc1409` (M0-6); Server `cea2952` (M0-7).
- Scope of testing: local tests and harnesses only. No live server, no device, no iOS build or run in M0-8.

## Commands and results

| Repo | Command | Result |
|---|---|---|
| spec | `node tools/check-schemas.mjs` | 62 passed, 0 failed (rerun 2026-11-08) |
| apple | `swift build` in `Packages/RolltopKit` | Build complete |
| apple | `swift test` (twice) | 350 tests in 27 suites (library), and 23 tests in 8 suites (`RolltopCLITests`), both runs |
| apple | 100,000-word round trip (release build, 3 runs) | Words verified: 106,449, 105,229 and 105,877 (one count per run) |
| apple | SIGKILL during save (10 rounds, then a second run of 40 rounds) | 10 of 10 and 40 of 40 passed |
| apple | SIGKILL during `create` (60 rounds) | 56 openable and empty, 4 refused with `NOT_A_LIBRARY`; none half-usable |
| apple | SIGKILL during `sample` (40 rounds) | Destination absent in 15, fully valid in 25 |
| apple | `rolltop` end to end (sample, export, validate, import, inspect) | All succeeded; bad checksum refused with exit 1 `ARCHIVE_CHECKSUM_MISMATCH`; path traversal refused with exit 1 `ARCHIVE_PATH_TRAVERSAL`; zip bomb refused with exit 1 `ARCHIVE_TOO_LARGE`, and no library created |
| apple | All 29 archive fixtures through `rolltop validate` | 29 of 29 gave the code in `expected.json` |
| apple | `make_archive_fixtures.py` in a scratch copy | 29 archives written; all 29 validate to the expected code (semantic equality, see below) |
| server | `npx tsc --noEmit` in `packages/document-adapter` | exit 0 |
| server | `node --test "test/*.test.ts"` (twice) | 54 tests, 54 pass, both runs |
| server | Decode every manuscript document in the Swift exports | sample: 8 of 8 accepted; 100k archive: 128 of 128 accepted, 0 failures |

## Acceptance criteria (handoff §8 M0)

| Criterion | Evidence | Status |
|---|---|---|
| Export from a populated DB, import into a fresh DB; normalized content, IDs, links, ordering, attachments and hashes match | The 100k run compares normalized snapshots after import (IDs, order, attachment hashes, and word counts checked). The round-trip suites (`ArchiveRoundTripTests`, `StoreRoundTripTests`) pass as part of the 350 tests | Pass |
| Reject malicious archives | All 10 malicious fixtures give their expected codes through `rolltop validate` (29 of 29 above); the zip bomb case creates no library (CLI run above). Importer tests for leaving existing libraries untouched are in M0-5 (`ArchiveImporterTests`), and pass in the 350 tests | Pass |
| Migrations preserve fixtures | `StoreMigrationTests` pass (13 tests): a failing migration rolls back with a backup; a newer schema is refused and left byte-identical. Only schema v1 exists, and every v2 step is synthetic. No real old-schema database fixture exists | Partial |
| A 100,000-word manuscript round-trips and stays responsive | The 100k run below | Pass (baseline, one machine) |
| Every `Spec/` fixture passes | Documents: both repos (Apple: 4 valid, 3 normalize pairs, 19 invalid; Server: the same, in 54 tests). Archives: Apple only (3 valid, 16 invalid, 10 malicious, all 29 through `rolltop validate`). The Server package has no archive-level checks, so its archive coverage is counting only | Pass for documents in both repos; archives in Apple only |
| This report is rewritten from real runs | This document | Pass |

## 100,000-word round trip

Run on the Apple sample library plus 1 part, 24 chapters, 120 scenes and 17 anchor references. Text is generated, seeded prose. It includes strong, emphasis, underline, links, anchors, headings, lists, quotes, alignment, scene breaks and hard breaks. Lists and quotes are block properties on paragraphs, not block types, as ADR D1 requires; the block types are paragraph, heading and sceneBreak.

Release build, seconds (monotonic clock):

| Run | Words verified | Create (145 nodes) | Save (120 docs, 17 refs) | Export | Validate | Import | Compare | Load one scene (median) | Save one scene (median) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 106,449 | 0.059 | 0.040 | 0.179 | 0.060 | 0.184 | 0.047 | 0.0003 | 0.0003 |
| 2 | 105,229 | 0.039 | 0.039 | 0.174 | 0.059 | 0.182 | 0.047 | 0.0004 | 0.0003 |
| 3 | 105,877 | 0.038 | 0.037 | 0.175 | 0.058 | 0.182 | 0.048 | 0.0003 | 0.0003 |

Debug build, 3 runs: export 0.346 to 0.353 s, validate 0.132 to 0.134 s, import 0.364 to 0.371 s, save one scene 0.0005 s, load one scene 0.0005 s, and the largest single save 0.0018 s. The archive is about 340 KB in 145 files. A full snapshot load takes 0.041 s (release) and 0.070 s (debug).

Responsiveness bar used (set by the agent, since the handoff and plan give no number): one scene load or save under 50 ms, and every whole-library step under 5 s, in a debug build. Scene load and save are about 100 times under the bar. The slowest whole-library step, import, is about 13 times under it.

The Server adapter decodes the 106k archive's 128 documents in 21 to 27 ms per run (warm process, in memory). The first run includes JIT warm-up. This is one machine, in memory, and not a server request path.

## Crash tests

- **SIGKILL during save:** a child process saves 3,000-word scenes in a loop and prints each acknowledged save; the parent kills it with SIGKILL 5 to 405 ms after it starts. The harness confirms the child died from signal 9. It then opens the library read-only and writable, and checks: head is no less than the last acknowledgement and at most one more; revisions are exactly 1 to head with no gaps; the head text carries its own revision number; every revision reads back; `integrity_check` and `foreign_key_check` are clean. Result: 10 of 10 rounds (1307 revisions), then 40 of 40 on a fresh library (final head 5902). Across the two runs, 3 rounds were killed after the commit and before the acknowledgement: the head was one ahead of the last acknowledgement, and nothing was lost.
- **SIGKILL during `create`:** 60 rounds, killed 0 to 12 ms after the child starts. 56 were openable, empty and clean. 4 were refused with `NOT_A_LIBRARY`, and `create` then succeeded. The "finished before kill" label comes from stdout and can be off by a race, so the split between openable and refused is approximate. The harness does not check the termination signal in this test.
- **SIGKILL during `sample`:** 40 rounds. The destination was absent in 15 and fully valid in 25.

## Known gaps (not fixed in M0)

- A killed `create` or `sample` leaves a hidden `.rolltop-new-<uuid>` staging folder: 12 such folders in the 40-round `sample` test. The destination is never left half-valid. Cleanup is not implemented.
- A library made with the raw store but never given a library row validates as `STORE_CORRUPT_RECORD` (refused, exit 1).
- iOS: not built or run in M0-8. The M0-5 review recorded an iOS compile check of the library, and the `rolltop` tool is macOS only.
- Power loss and fsync are not tested. SIGKILL tests an app crash, not an OS crash or power cut. `F_FULLFSYNC` and the directory fsync cannot be observed by a test.
- Disk-full, sandboxed folders and iCloud folders are not tested.
- Search is not implemented in the store. Load timings are reported instead.
- The Server package implements documents only. Manifest, checksums and malicious-archive handling exist in Apple only.
- The text is generated, not literary prose. The timings come from one Mac (Apple M5), not a device.
- Manifest unknown properties do not survive import then export. This needs a spec decision (`archive-format-v1.md`). Recorded in the M0-5 review.
- Non-spec error codes: `ARCHIVE_CANCELLED` and `ARCHIVE_IO_ERROR` (runtime conditions, not content verdicts). CLI diagnostics for libraries: `STORE_INTEGRITY`, `ATTACHMENT_UNVERIFIED`, `LIBRARY_NEEDS_UPGRADE`, `LIBRARY_NEWER_SCHEMA`, `STORE_CORRUPT_RECORD`, `NOT_A_LIBRARY`.
- `validate`, `inspect` and `export` open libraries read-only, but SQLite may still update the library's `-shm` index file on any read. The tests exempt that file. Recorded in the M0-6 review.
- A failed backup rename after an import can leave the old library in a hidden `.import-<id>.importing` folder, reported through `backupURL`. Recorded in the M0-5 review.

## Fixture regeneration: semantic equality

`tools/make_archive_fixtures.py`, run against the Swift `sample` and `export` output, writes 29 archives. Each one validates with the Swift CLI to the code in `expected.json`, and the regenerated `expected.json` equals the vendored one.

The bytes do not match the vendored archives. The archive ID and creation time in the manifest, the checksums file, and the ZIP entry order and timestamps differ, so the derived invalid and malicious archives differ too. In the regenerated sample, the record files are equal after JSON parsing (M0-8 Apple check 8). Owner decision (2026-11-08): the M0 standard is semantic equality, not byte identity.

## Cross-platform check

The web adapter accepts all 8 documents in the Swift sample export and all 128 in the 100k export. For each one, canonical → editor → canonical equals the normalized input, and each document is already in normalized form. The block types (paragraph, heading, sceneBreak) and mark types (strong, emphasis, underline, link, anchor) in the exports are all in the editor schema.

Open for M1: the real Tiptap editor must reuse `rolltopSchema`, or sort marks before validation, so its mark order matches the schema. No browser or DOM editor was run.
