# ADR-0003: Replace the library on the self-hosted server

- Status: Owner-approved on 2026-11-15 for the choices below (owner answers to the draft). This ADR adds to ADR-0001 and ADR-0002 and does not change any decision in them, nor the archive format, the document format or the sync protocol.
- Date: 2026-11-15
- Scope: the self-hosted server's "replace library" import (M1-10b) and the operator restore command. Apple's replace import is a separate, already decided matter (owner, 2026-11-12, `PROGRESS.md`).
- Sources: ADR-0001 D2 (`backups/` holds pre-migration and pre-replace backups), ADR-0002 (PostgreSQL, one library per server, `pg_dump` before a migration), `sync-protocol-v1.md` ("Epoch", "Import baseline", "Client rules", "Rollback and epochs"), `PROJECT.md` data rules, owner decisions of 2026-11-12 and 2026-11-15.
- Relation to the architect's draft (R1 to R8): R1 an import replaces whatever library is there (decisions 1 and 5). R2 one all-or-nothing transaction, locks in order, archive validated before any lock (decisions 3 and 5). R3 two requests, confirmation recomputed under the lock (decisions 1 and 3). R4 `pg_dump` inside the lock window, named `<db>-<stamp>-before-replace.dump`, only these pruned to 5 (decision 4). R5 `owner`, `session`, `login_failure` and `schema_migrations` untouched, attachments never deleted (decisions 5 and 7). R6 new epoch, `sync_result` and `sync_conflict` cleared, devices reconnect and take a fresh deviceId (decision 5; Client rules 6). R7 failure before `COMMIT` rolls back everything and removes the attachment files this import wrote, a lost `COMMIT` is checked by the new epoch (decision 5). R8 restore is its own all-or-nothing replace with backup, restoring only library and sync tables, refusing another migration set, moving attachments back from quarantine, starting a new epoch (decision 8). The numbering in this file is its own.

## Context

One library lives on one server. Today an import is allowed only into an empty server (`LIBRARY_EXISTS` otherwise). The owner wants to replace the library with another `.rolltop` archive. A replace destroys the live library, its change log and its open conflicts, and it changes what every connected device must do, so it needs a fresh password check, a confirmation that cannot go stale, a backup that is taken before anything is deleted, and a way back.

## Owner decisions (2026-11-15)

1. Retention: only pre-replace dumps are pruned, keeping the newest 5. Pre-migration dumps are never pruned.
2. Restore is an operator command, not an HTTP route and not a studio button.
3. The owner re-enters the password to replace or to restore. It is checked with `verifyPassword`, and failures are counted in `login_failure`, sharing the sign-in limit.
4. Old attachment files are kept until the owner deletes them by hand. A replace never deletes attachment files.
5. Backups go in `ROLLTOP_DATA_DIR/backups`. (The folder is 0700 and the files 0600 as for the existing pre-migration backups; that is the code's convention, not an owner decision.)
6. A replace shows the count of open conflicts and a warning in the confirmation. It is not refused while conflicts are open.

## Decisions

### 1. Two requests: preview, then replace

- `POST /api/import/preview` (body: the archive, `application/zip`) reads and validates the archive in the import worker and changes nothing. It answers `200`:
  `{ current, incoming, confirmation }`. `current` is the library now (`libraryId` or null, `title`, `counts` per library table, `trashed` per table that has a trash, `epoch`, `head`, `openConflicts`). `incoming` is `{ libraryId, summary, warnings, trashed, archiveSha256 }`; `trashed` counts records in the trash, shown apart from the totals. The two `trashed` objects are keyed differently: `current.trashed` by database table name (every table that has a trash, zeros included), `incoming.trashed` by archive record kind (only kinds with at least one). The client maps between them (for example `manuscript_node` and `manuscriptNode`) or shows each side as it comes. `confirmation` is the set of values the client sends back: `{ libraryId, counts, epoch, head, openConflicts, archiveSha256 }`.
- `POST /api/import` with the headers below is the replace. Without them it is the existing import into an empty server, unchanged (`LIBRARY_EXISTS` when a library exists).
- The body is the archive, so the confirmation and the owner password travel in headers, each base64url of UTF-8 (`X-Rolltop-Replace`: the confirmation as JSON; `X-Rolltop-Password`: the password). Never in the URL. Both headers must be present together, or the request is `400 BAD_REQUEST`.
- Both routes sit behind the existing auth guard and the single import slot. The password is checked in the API process, never in the worker.

### 2. The password re-entry

The check is the sign-in check (same scrypt verification, same dummy-hash timing, same serialisation, same lockout, same `login_failure` rows). A wrong password is `401 REPLACE_AUTH_FAILED`; a locked sign-in is `429 TOO_MANY_ATTEMPTS`; both happen before any archive work. A right password clears the failure count, as a sign-in does. It starts no session. Five failures lock sign-in as well as replace (the limit is shared).

### 3. Confirmation values checked under the lock

The replace takes the locks in the documented order: the `sync_state` row `FOR UPDATE`, then the `library` table in `EXCLUSIVE` mode (the order a sync op uses; see the lock comment in `archive-io.ts`). Under those locks it reads the current state with the same function the preview used and compares the library id, the per-table counts, the epoch, the head, the open-conflict count and the SHA-256 of the archive bytes. Any difference is `409 REPLACE_MISMATCH`, nothing has changed, and no backup was made. The epoch and head make a retry of a committed replace fail the same way.

### 4. Backup before delete

Under the same locks (so nothing can change between the dump and the delete) the server runs `pg_dump --format=custom` into `ROLLTOP_DATA_DIR/backups` (folder 0700, file 0600, as for pre-migration backups; the password goes in `PGPASSWORD`). The rows of `owner`, `session` and `login_failure` are left out of the dump (`--exclude-table-data`): restore never reads them, and an old dump should not keep an old password hash. The file is written under a `.partial` name and takes its final name only when `pg_dump` has succeeded, so a killed process never leaves a truncated file under a trusted name. If the dump fails, the replace stops: `500 BACKUP_FAILED`, nothing replaced. The dump shares one function with the pre-migration backup (`backup.ts`). The connection idles in the transaction while `pg_dump` runs, so the server's idle-in-transaction limit is lifted for that time, and `pg_dump` has its own time limit (the import time budget).

File names are `<db>-<UTC stamp>-before-<label>.dump`: the label is a migration id for a pre-migration dump, `replace` for a pre-replace dump, `restore` for the dump a restore takes first. Only `replace` dumps are pruned: pruning happens only after the replace has committed: it keeps the newest 5 pre-replace dumps of this database and deletes the rest, together with stale `.partial` files. A replace that fails (a refusal, a failed load, an error before `COMMIT`) after its dump removes that dump, so a failure never pushes an older backup out. When the worker is killed by the time budget after the dump has been given its final name but before the commit, nothing can remove it: that dump stays as an extra pre-replace file, and the next committed replace prunes to 5 as usual. A worker killed by the time budget also kills its `pg_dump` (the API signals the child's process group). Pre-migration and pre-restore dumps are never pruned by any code path.

### 5. Delete and load in one transaction, new epoch

After the backup, in the same transaction: delete every library and sync row (children first; `DELETE`, never `TRUNCATE`), load the archive as an import does, write the import baseline as the new epoch's first changes (`sync-protocol-v1.md`, "Import baseline"), set the new epoch with head from the baseline, and commit. `sync_result` and `sync_conflict` are cleared, as for any import: they belong to the old epoch. The `owner`, `session`, `login_failure` and `schema_migrations` tables are never touched, so the owner's password and sessions survive.

The new epoch uuid is generated in advance, in the application. When a `COMMIT` answer is lost, the server asks on a fresh connection whether `sync_state.epoch` is the new epoch. (The library id cannot tell, because a replace may bring the same library id.) This also fixes the same check for the plain import.

Any failure, a timeout or a killed worker before commit leaves the library, epoch, change log and conflicts as they were (the transaction rolls back). A worker killed between `COMMIT` and its reply is reported as a timeout although the replace happened; a retry is then refused by decision 3.

A sync push that was held by the locks answers, after the commit, with the new epoch (`409 RESYNC_REQUIRED`), per Client rules 2, 3 and 7. A device whose library is replaced stays connected to its server and must reconnect (owner decision of 2026-11-12). A pull from `after=0` under the new epoch returns the new baseline.

### 6. A migration, because the change log is append-only

The change log refuses every `DELETE`. Migration `0008-replace-library` lets the `DELETE` through only while the transaction-local setting `rt.replace` is `on`, which the replace and the restore set for their own transaction. `TRUNCATE` and `UPDATE` stay refused. The old revision history (`document_revision`) is deleted under the existing `rt.purge` setting, set for that one statement as a purge does.

### 7. Attachment files

A replace deletes attachment rows, never files. The new archive's files are written first (a file with the same hash is reused). Files that no row names any more stay in the attachments folder until the owner deletes them by hand; the next start moves them to the quarantine folder beside it (`attachments-quarantine`), as the startup sweep already does, and nothing deletes them. The file cleanup that follows a purge now runs under the `sync_state` lock, only for a hash that has no row, and moves the file to quarantine instead of deleting it, so it cannot remove a file a replace has just reused (this closes the open note in `PROGRESS.md` for the replace path; an upload route would still need the same lock).

### 8. Restore is an operator command

`node packages/api/src/restore.ts --dump <file in ROLLTOP_DATA_DIR/backups>`, with `DATABASE_URL` and `ROLLTOP_DATA_DIR` in the environment. There is no HTTP route and no studio button. It reads the owner password from standard input (hidden prompt on a terminal), never from the command line, and checks it as in decision 2.

It restores the library tables and the sync log (and open conflicts) from the chosen dump, and never reads or writes the `owner`, `session` or `login_failure` tables. Every refusal comes before any change:

- the file must be a pre-replace dump of this database, a plain file in the backup folder;
- the dump's migration ids and checksums must equal this build's (`MIGRATION_HISTORY_MISMATCH`, `MIGRATION_CHECKSUM_MISMATCH`); a dump from another build is restored with that build;
- every attachment file the dump names must exist, with its hash, in the attachments folder or the quarantine folder (`INTEGRITY_FAILED` otherwise); this is checked under the replace locks, after they are taken and before the backup.

Then, in one transaction under the replace locks: take a backup (label `restore`, never pruned), delete, load every table from the dump, move the needed files back from quarantine, start a new epoch (head is the dump's last seq; `sync_result` is empty), and commit. If the transaction fails, the files are moved back and the library is as it was. The restore starts a new epoch as `sync-protocol-v1.md` ("Rollback and epochs") requires. The dump is read with `pg_restore --data-only`, one table at a time, and its rows are inserted with ordinary statements, so the command needs `pg_restore` but no extra database privileges.

### 9. Errors

New codes: `REPLACE_MISMATCH` (409), `BACKUP_FAILED` (500), `REPLACE_AUTH_FAILED` (401). Existing codes keep their meaning: `LIBRARY_EXISTS`, `IMPORT_BUSY`, `IMPORT_TIMEOUT`, `TOO_MANY_ATTEMPTS`, `BAD_REQUEST`. No answer carries a file-system path, a password or an attachment hash. (The preview does return `archiveSha256`, the SHA-256 of the archive the client itself uploaded.)

## Consequences

- The studio's replace dialog (a later task) shows `current`, `incoming`, the open-conflict count and a warning, asks for the password, and sends `confirmation` back. It never sees a backup path.
- The migration set grows to `0008`. A dump made by an older build cannot be restored by this build (decision 8).
- A replace does not refuse while conflicts are open: the open conflicts are lost with the old epoch, and the confirmation says so (owner decision 6). They are in the pre-replace dump.
- Disk use: up to 5 pre-replace dumps plus every pre-migration and pre-restore dump, which the operator removes by hand.

## Not covered

- Restore to a different database or server, and restore of a pre-migration dump (use the build that made it).
- The `pg_dump` child runs in its own process group (so the API can kill it with the worker). Ctrl-C at a terminal, or a signal sent to the server's own group, therefore no longer reaches a running dump, and the same is true of the pre-migration dump, which shares the code. A dump interrupted that way is not atomic: a pre-migration dump is written under its final name and may be left truncated (it is removed only by the process that made it), and a pre-replace dump is left as a `.partial` file, which the next replace removes. The API forgets the dump's process id as soon as `pg_dump` exits, so it never signals a reused id.
- Prune and restore treat only files named as above; any other file in the folder is left alone.
- Apple's replace import, and the studio dialog.
