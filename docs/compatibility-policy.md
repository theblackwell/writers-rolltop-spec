# Compatibility policy

Version: 1 (2026-11-02). Applies to every Writers Rolltop edition (Apple native and self-hosted).

## Independent version numbers

| Version | Where | Changes when |
|---|---|---|
| Archive `formatVersion` | `manifest.json` | the archive layout or record semantics change incompatibly |
| Document `version` | each `manuscript/*.json` | new block, inline or mark types, or changed meaning |
| Database schema | each app's local store (`grdb_migrations` on Apple) | any local storage change; never visible in archives |
| Sync protocol version | later (M4) | wire changes |

## Rules

1. **Never silently change data.** A reader that meets a newer archive or document version refuses with an actionable message ("created by a newer version of Writers Rolltop; update to open it"). It never opens a partial or lossy view for editing.
2. **Additive optional fields** on top-level archive records do not bump `formatVersion`. Every reader must preserve them on round trip.
3. **New content types** in documents (for example comments or footnotes) bump document `version`.
4. **Breaking changes** bump `formatVersion`. Each release states the oldest `formatVersion` it can import. That's at least every version released in the previous 24 months, plus ADR approval to drop older ones. Supported old versions are migrated on import and covered by checked-in fixtures in `fixtures/archives/v<N>/`.
5. **Exports always use the newest format** the writer supports. A "save as older version" is only offered when it's lossless.
6. **Database migrations** are forward-only, run inside a transaction after an online backup, and are tested against a fixture database from every released schema version. A store whose schema is newer than the app is refused for writing.
7. **Native and self-hosted parity.** A release of either edition must pass the conformance fixtures of every archive and document version it claims. The Apple and server compatibility matrix is published with each release.

## Conformance

`fixtures/` is normative. An implementation conforms to format version N when it:
- accepts every `fixtures/**/valid` item and reproduces it semantically on export;
- rejects every `invalid` and `malicious` item with the listed error code;
- produces `expected` output for every `normalize` pair.
