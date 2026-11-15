# M1 verification report

- Date: 2026-11-15.
- Environment (checked 2026-11-15): macOS 26.7.1, Node v26.10.0, PostgreSQL 16 scratch container `rolltop-test-pg` on 127.0.0.1:55432, Google Chrome (Playwright `channel: "chrome"`).
- Scope: M1, "Self-hosted studio", the done criteria in `M1-PLAN.md` ("Scope and acceptance") and the M1-12 row. Decisions: [ADR-0002](adr/0002-server-storage-and-engine.md) and [ADR-0003](adr/0003-replace-library.md) (replace library).
- Sources at verification time (git HEAD, local, not pushed): Spec `e9a5122`; Server `ec51c1c` (the Server working tree also had an uncommitted `README.md` change at the time, the setup guide work of another engineer, which does not affect the tests); Apple `1a75063`. The Swift CLI is the existing debug build at `Apple/Packages/RolltopKit/.build/debug/rolltop` (not rebuilt in M1-12).
- Scope of testing: local tests on a scratch PostgreSQL, a headless Chrome, and the Swift CLI. No real device, no live deployment. M1-12 changed no application code.
- Environment variables for the Server runs: `ROLLTOP_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres`, `ROLLTOP_TEST_PG_DUMP=<Server>/packages/store/test/tools/pg_dump-podman.sh`, `ROLLTOP_CLI=<Apple>/Packages/RolltopKit/.build/debug/rolltop`. Commands run in `Server/` unless stated.

## Commands and results (full suites, 2026-11-15)

| Repo | Command | Result |
|---|---|---|
| server | `npm run typecheck` | exit 0 |
| server | `npm test` | exit 0. api 274, archive 176, document-adapter 56, store 101, web 243 tests; 850 in all, 850 pass, 0 fail, 0 skipped |
| server | `npm run test:e2e -w @writers-rolltop/web` | exit 0. 100 passed, 0 failed, 0 skipped (1.9 min) |
| spec | `node tools/check-schemas.mjs` (in `Spec/`) | 913 passed, 0 failed |

## Acceptance criteria (M1 done criteria)

| # | Criterion | Command and result | Status | Date |
|---|---|---|---|---|
| 1 | Server passes all archive and document fixtures | `node --test test/fixture-archives.test.ts test/fixture-documents.test.ts` in `packages/archive`: 67 tests, 67 pass. `node --test test/fixtures.test.ts test/valid-documents.test.ts test/invalid-documents.test.ts test/normalize-documents.test.ts` in `packages/document-adapter`: 33 tests, 33 pass. Coverage: 29 archive fixtures (3 valid, 16 invalid, 10 malicious, each against `expected.json`) and the document fixtures (4 valid, 19 invalid, 3 normalize pairs). The counts come from the M0 and M1-2 reports and the vendored fixture folders; this run reports test counts, not a per-fixture tally | Pass | 2026-11-15 |
| 2 | Archive from the Swift CLI, then server import, then export, then `rolltop validate`, is semantically identical | `node --test test/swift-roundtrip.test.ts` in `packages/api` (with `ROLLTOP_CLI` set): 2 tests, 2 pass. The test runs the CLI `sample` and the checked-in fixtures through server import, server export, `rolltop validate`, and a semantic comparison (`packages/store/test/semantic.ts`). It also passed inside the full `npm test` above | Pass | 2026-11-15 |
| 3 | Two browser sessions editing the same scene keep both versions and offer recovery | `npx playwright test e2e/studio.spec.ts e2e/sync-editor.spec.ts` in `packages/web`: 36 passed. Specs: `sync-editor.spec.ts:376` "two browser sessions edit one scene: both texts are kept, recovery is offered on the second, and resolving clears the item only after the server answers"; `:453` and `:464` (recovery: keep this device's text, keep the saved text). All three also passed in the 100-test browser run. Note: `sync-editor.spec.ts` does not pass alone (the serial tests need the owner account that `studio.spec.ts` creates); run it with `studio.spec.ts` or the full suite | Pass | 2026-11-15 |
| 4 | Protocol fixtures cover duplicate operations, retry, stale cursor, and a conflicting edit to the same field | `node --test test/sync-scenarios.test.ts` in `packages/api`: 27 tests (1 completeness check + one test for each of the 26 vendored scenarios in `Spec/fixtures/sync`), 27 pass. Counts per case: duplicate operations: scenario `duplicate-op.json` (5 steps; a retried push and a repeated opId in one batch), plus 2 api tests in `sync.test.ts` and `sync-purge.test.ts` (a repeated push returns duplicates and writes nothing; a purge retried with the same opId). Retry: covered by the same `duplicate-op.json` (retried push) and by `sync.test.ts` "a push cut off between ops keeps what was applied; the retry finishes it" (1 test), and `rejected-permanent.json` (1 scenario). Stale cursor: `stale-cursor.json` (7 steps; wrong epoch, cursor past head, base past head give 409 RESYNC_REQUIRED), plus the api test that an import epoch change makes an old cursor get RESYNC_REQUIRED (1 test). Conflicting edit to the same field: `same-field-conflict.json` (7 steps; later arrival kept as a conflict, a resolve closes it), plus `conflict-retention.json`, `different-field-merge.json` (the non-conflicting contrast), and the four `delete-vs-edit-*.json` scenarios. The per-case counts of api tests other than scenarios are title searches in `packages/api/test/sync*.test.ts`, not a tag-based count | Pass | 2026-11-15 |
| 5 | Security review of the sync and authentication path is done | See "Security review records" below. M1-7 (auth) and M1-11 (sync and auth, container and proxy) are recorded; M1-6 (sync endpoints) has a code review record, but this report found no separate security-review record for it | Pass, with the caveat in the records | 2026-11-15 |
| 6 | Setup guide works on a clean machine | Checked by another engineer on a clean machine (not part of this run) | pending: clean-machine run | n/a |
| 7 | The self-hosted edition is an OCI image that runs under Docker and Podman, with a Compose file | Cited from `PROGRESS.md` (M1-11, Server `ec51c1c`, 2026-11-15): Docker and Podman smoke runs pass on linux/amd64 (Lima Ubuntu VM `rolltop-x86`) and linux/arm64 (Mac Podman, and Lima Ubuntu VM `rolltop-arm64`). `Server/compose.yaml` and `Server/Dockerfile` exist. Image builds were not rerun in M1-12. Not tested in M1-11: acme mode, HTTPS in the browser, Docker editing in the browser | Pass (cited, not rerun) | 2026-11-15 |
| 8 | Full suites | The four rows under "Commands and results" | Pass | 2026-11-15 |

## Security review records

Taken from `PROGRESS.md` and `M1-PLAN.md`. Commit ids are those the records give; no record was found for a review that is not listed.

| Section | Date | Reviewer and outcome | Commit |
|---|---|---|---|
| M1-2 archive importer (input hardening) | 2026-11-09 | security-reviewer: majors fixed, final re-review signs off (`M1-PLAN.md`) | Server `fd78823` |
| M1-7 single owner login | 2026-11-11 | security-reviewer: no blockers; must-fix (setup deletes all sessions) fixed and tested; focused re-review of the fixes signs off | Server `e76f2f3` |
| M1-10b replace library | 2026-11-15 (committed) | Security review and code review done with fixes; the last round re-reviewed and checked (`PROGRESS.md`). The review date is not recorded separately | Spec `e9a5122`, Server `923e0b6` |
| M1-11 sync and auth, container and proxy | 2026-11-15 | Security review found one blocker (encoded `api` path skipped sign-in), fixed and re-reviewed; a replace-password log leak through the proxy, fixed and tested (`PROGRESS.md`). `M1-PLAN.md` has no M1-11 verification log section yet | Server `ec51c1c` |

## Known gaps (not tested)

- Real touch devices: nothing ran on a phone or tablet. Only headless desktop Chrome was used (including 390-wide viewports).
- VoiceOver and other screen readers.
- Dark appearance, Increase Contrast and forced colors. Reduced Motion is checked only by one browser spec (the toolbar spec removes transitions).
- acme (automatic certificate) mode: needs a public domain; only the refusal for an IP host is tested.
- Real Docker on a Mac: Docker was exercised in Linux VMs, and Podman on the Mac.
- HTTPS in the browser: only plain HTTP was checked in M1-11. Editing through the Docker image was not checked in the browser.
- The first import into an empty server has no studio entry point (owner decision open); import into an empty server is reachable only through the API or CLI.
- Real `pg_dump` and `pg_restore` versions at real library size, and the TTY password prompt (M1-10b).
- Apple catch-up items, still to do before M2: writer rules, display rules, purge, the sync fixtures in use by the Apple client, and the blocker-list and override UI checks on touch devices.
- Flaky or watched: `sync-overrides.test.ts:138` failed once in an M1-11 full run ("terminating connection due to administrator command") and passed in later runs; it passed in this run. The "Save now" browser spec (`sync-editor.spec.ts:227`) was not reproduced as a failure in earlier debugging and passed here. Both stay on watch.
- `sync-editor.spec.ts` cannot be run alone; it depends on the owner account created by `studio.spec.ts`.
- The clean-machine setup check (criterion 6) is pending and is not covered here.
