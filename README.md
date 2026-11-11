# writers-rolltop-spec

The open, implementation-independent specification for **Writers Rolltop** project data: the canonical document format, the portable `.rolltop` archive, the compatibility policy, JSON Schemas, and conformance fixtures.

Any implementation (the native Apple apps, the self-hosted web studio, or a third-party tool) can read and write Writers Rolltop projects from this repository alone, with no vendor service involved.

> Status: **M0 draft, format version 1.** See [ADR-0001](docs/adr/0001-m0-foundation.md) for the decisions and the owner approvals still open.

## Contents

| Path | What |
|---|---|
| [`docs/adr/0001-m0-foundation.md`](docs/adr/0001-m0-foundation.md) | Architecture decision record: document model, storage, scope integrity, archive, adapters |
| [`docs/document-format-v1.md`](docs/document-format-v1.md) | Canonical scene document: shape, validity rules, normalization |
| [`docs/archive-format-v1.md`](docs/archive-format-v1.md) | `.rolltop` archive layout, records, integrity rules, reader safety limits, error codes |
| [`docs/compatibility-policy.md`](docs/compatibility-policy.md) | Versioning and forward/backward-compatibility rules |
| [`docs/sync-protocol-v1.md`](docs/sync-protocol-v1.md) | Sync protocol v1: change model, push, pull, conflicts, errors (M1-5 draft) |
| [`docs/m0-verification.md`](docs/m0-verification.md) | M0 verification report across all three repositories |
| `schemas/` | JSON Schema 2020-12 for documents and every archive file |
| `schemas/sync-v1.schema.json` | JSON Schema 2020-12 for the sync protocol wire shapes |
| `fixtures/documents/` | `valid/`, `normalize/` (input → expected), `invalid/` (+ `expected.json` error codes) |
| `fixtures/archives/` | `valid/` (including an expanded copy of the sample), `invalid/`, `malicious/`, and `expected.json` |
| `fixtures/sync/` | Sync protocol scenarios (request/response steps) |
| `tools/sync-model.mjs` | Reference model of sync protocol v1, used by the checker |
| `tools/check-schemas.mjs` | Dependency-free check that fixtures match the schemas |
| `tools/make_archive_fixtures.py` | Regenerates the invalid and malicious archives from a valid sample (stdlib only) |

## Checks

```bash
node tools/check-schemas.mjs
```

Conformance is defined in the [compatibility policy](docs/compatibility-policy.md#conformance). The reference implementation (Apple `RolltopKit`) and the web document adapter (server repo) both run these fixtures in their test suites.

## Regenerating archive fixtures

The valid sample comes from the reference implementation (`rolltop sample …` then `rolltop export …`, in `writers-rolltop-apple`):

```bash
python3 tools/make_archive_fixtures.py path/to/sample-library.rolltop
```

## License

Licensed under the [Apache License, Version 2.0](LICENSE): documents, schemas, fixtures and tools. Anyone may implement the format, including in proprietary software. The license doesn't grant rights to the "Writers Rolltop" name or logos (see [NOTICE](NOTICE)).
