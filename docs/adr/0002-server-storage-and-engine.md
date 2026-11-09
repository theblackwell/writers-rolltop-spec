# ADR-0002: Self-hosted server storage and engine

- Status: Accepted by the owner on 2026-11-09 (stack confirmed). This ADR adds to ADR-0001 and does not change any of its decisions.
- Date: 2026-11-09
- Scope: the self-hosted edition's language, web framework, database, migrations, and test tooling (M1).
- Sources: `PLAN.md` (M1 row, server engine), ADR-0001 D2, D4 and D7, `Spec/docs/compatibility-policy.md`, `ROADMAP.md` (React and TypeScript for the web studio).

## Context

ADR-0001 D7 puts the self-hosted engine in `Server/`. M0 built only the Tiptap document adapter there. M1 needs a server that stores libraries in PostgreSQL, imports and exports `.rolltop` archives, runs the sync protocol, and serves a browser studio. This ADR fixes the stack for M1. It does not change the Apple side or the format.

The server must pass the same conformance fixtures as the Apple engine (compatibility policy, rule 7). Its archive validator is written in TypeScript, using the same spec and fixtures.

## Decisions

### S1. Language and runtime: TypeScript on Node.js

- Node.js 22.18 or later (the existing `document-adapter` engine), run with native type stripping.
- TypeScript strict mode, `module` and `moduleResolution` set to `NodeNext`, as in `packages/document-adapter`.
- The adapter package is kept as it is. Other packages import it.

### S2. Packages (npm workspaces, `packages/*`)

- `packages/document-adapter`: existing (M0-7). Unchanged.
- `packages/archive`: the TypeScript archive engine (M1-2). Created in M1-2, not in M1-1.
- `packages/api`: HTTP API (Fastify). Created in M1-1 with a health route only.
- `packages/web`: browser studio (React, Vite). Created in M1-1 as a placeholder page only.

No package is shared across the browser and server unless a later section needs it.

### S3. API: Fastify 5

- Fastify 5 with JSON schema validation on routes. The same schema style as the spec's JSON Schemas where it fits.
- Errors use the envelope style in ADR-0001 (stable error codes, no stack traces to clients).

### S4. Database: PostgreSQL with `pg`

- PostgreSQL 16 or later, accessed with the `pg` driver and plain SQL. No ORM.
- Migrations are plain ordered SQL files, applied forward only, each in a transaction, after a backup, as compatibility policy rule 6 requires. A small in-repo runner applies them. Its design is part of M1-3.
- Tombstones (`deleted_at`), document revisions with compare-and-swap, and attachments stored by hash follow ADR-0001 D2 and D3 as closely as PostgreSQL allows. The exact schema is decided in M1-3.

### S5. Web studio: React 19 and Vite

- React 19 with TypeScript, built by Vite. No server-side rendering. The studio is a single-page app that calls the API.
- The Tiptap editor reuses the adapter's `rolltopSchema` (M0-7 carry-forward).

### S6. Testing

- Node's built-in test runner (`node --test`), as the adapter uses today. No second runner for unit tests.
- Browser tests (Playwright) start in M1-8, when there is a UI to test.
- Typecheck with `tsc --noEmit` in every package.

### S7. Version pins

- Exact versions are pinned in each `package.json`. A version is used only when it was published at least two weeks before it is adopted.
- Pins adopted in M1-1 (checked against registry publish dates on 2026-11-09): `fastify` 5.12.7 (5.12.8 was published 2026-11-02 and is too new), `react` and `react-dom` 19.3.1, `@types/react` and `@types/react-dom` 19.3.0, `typescript` 7.0.2, `@types/node` 26.6.6, `vite` 8.3.5, `@vitejs/plugin-react` 6.1.2, `@tiptap/pm` 3.33.0 (kept from M0). `pg` 8.23.1 is not yet used; it is checked when M1-3 adds it.

## Consequences

- One language (TypeScript) for the server and the web studio. The Apple side stays Swift.
- No ORM and no extra framework layers. Each choice is one library, as the owner asked for the smallest maintainable change.
- The container image (M1-11) runs Node and PostgreSQL. It does not bundle a database.

## Open

- The migration runner and the schema are M1-3 decisions. This ADR does not fix them.
- Image architectures (ARM64 and x86-64) are owner item 3 in `M1-PLAN.md`. The owner has confirmed it applies, so M1-11 builds both.
