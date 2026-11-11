#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Black Well Foundry
// Dependency-free check that spec fixtures match the JSON Schemas.
// Supports the JSON Schema subset used in schemas/: type, const, enum, pattern,
// minLength, maxLength, minimum, maximum, minItems, maxItems, minProperties, required, properties,
// additionalProperties, items, oneOf and local $ref ("#/$defs/...").
// Usage: node tools/check-schemas.mjs
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLibrary, handle } from "./sync-model.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (p) => JSON.parse(readFileSync(p, "utf8"));
const documentSchema = load(join(root, "schemas/document-v1.schema.json"));
const archiveSchema = load(join(root, "schemas/archive-v1.schema.json"));

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function validate(schema, value, rootSchema, path, errors) {
  if (schema.$ref) {
    const name = schema.$ref.replace(/^#\/\$defs\//, "");
    const target = rootSchema.$defs?.[name];
    if (!target) throw new Error(`unresolved $ref ${schema.$ref}`);
    return validate(target, value, rootSchema, path, errors);
  }
  const t = typeOf(value);
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const ok = allowed.some((a) => a === t || (a === "number" && t === "integer"));
    if (!ok) return errors.push(`${path}: expected ${allowed.join("|")}, got ${t}`);
  }
  if ("const" in schema && JSON.stringify(schema.const) !== JSON.stringify(value))
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value)))
    errors.push(`${path}: not in enum`);
  if (t === "string") {
    const len = [...value].length;
    if (schema.minLength !== undefined && len < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && len > schema.maxLength) errors.push(`${path}: longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${path}: does not match ${schema.pattern}`);
  }
  if (t === "integer" || t === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: above maximum`);
  }
  if (t === "array") {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((item, i) => validate(schema.items, item, rootSchema, `${path}[${i}]`, errors));
  }
  if (t === "object") {
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${path}: missing ${key}`);
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) errors.push(`${path}: fewer than ${schema.minProperties} properties`);
    const props = schema.properties ?? {};
    for (const [key, v] of Object.entries(value)) {
      if (key in props) validate(props[key], v, rootSchema, `${path}.${key}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}: unexpected property ${key}`);
      else if (typeof schema.additionalProperties === "object")
        validate(schema.additionalProperties, v, rootSchema, `${path}.${key}`, errors);
    }
  }
  if (schema.oneOf) {
    const passing = schema.oneOf.filter((s) => {
      const e = [];
      validate(s, value, rootSchema, path, e);
      return e.length === 0;
    }).length;
    if (passing !== 1) errors.push(`${path}: matched ${passing} oneOf branches, expected 1`);
  }
}

const check = (schema, value, rootSchema) => {
  const errors = [];
  validate(schema, value, rootSchema, "$", errors);
  return errors;
};

// Archive path -> $defs name in archive-v1.schema.json.
const archiveFiles = {
  "manifest.json": "manifest",
  "checksums.json": "checksums",
  "library.json": "library",
  "references.json": "references",
  "notes.json": "notes",
  "attachments.json": "attachments",
  "bible/entries.json": "entries",
  "bible/facts.json": "facts",
  "bible/questions.json": "questions",
  "bible/templates.json": "templates",
  "bible/fields.json": "fields",
  "bible/relationships.json": "relationships",
  "continuity/events.json": "events",
  "continuity/state_changes.json": "stateChanges",
};

let failures = 0;
let passes = 0;
const expect = (label, errors, shouldPass) => {
  const ok = shouldPass ? errors.length === 0 : errors.length > 0;
  if (ok) passes++;
  else {
    failures++;
    console.error(`FAIL ${label}${shouldPass ? `\n  ${errors.join("\n  ")}` : ": expected schema rejection"}`);
  }
};

const docs = join(root, "fixtures/documents");
for (const f of readdirSync(join(docs, "valid")))
  expect(`documents/valid/${f}`, check(documentSchema, load(join(docs, "valid", f)), documentSchema), true);
for (const f of readdirSync(join(docs, "normalize")).filter((f) => f.endsWith(".expected.json")))
  expect(`documents/normalize/${f}`, check(documentSchema, load(join(docs, "normalize", f)), documentSchema), true);

// Invalid documents whose violation is expressible in JSON Schema must also fail the schema.
const schemaDetectable = ["unknown-block-type.json", "newer-version.json", "extra-field.json",
  "heading-level-7.json", "uppercase-uuid.json", "unknown-mark.json", "quote-false.json", "align-justify.json",
  "list-on-heading.json", "scene-break-with-content.json", "list-level-8.json"];
for (const f of schemaDetectable)
  expect(`documents/invalid/${f}`, check(documentSchema, load(join(docs, "invalid", f)), documentSchema), false);

// Expanded valid archives (directories) under fixtures/archives/valid.
const archivesDir = join(root, "fixtures/archives/valid");
if (existsSync(archivesDir)) {
  for (const name of readdirSync(archivesDir)) {
    const dir = join(archivesDir, name);
    if (!statSync(dir).isDirectory()) continue;
    for (const [path, def] of Object.entries(archiveFiles))
      expect(`archives/valid/${name}/${path}`, check(archiveSchema.$defs[def], load(join(dir, path)), archiveSchema), true);
    const manuscript = join(dir, "manuscript");
    for (const f of readdirSync(manuscript))
      expect(`archives/valid/${name}/manuscript/${f}`, check(documentSchema, load(join(manuscript, f)), documentSchema), true);
  }
}

// Sync protocol v1: every fixture request validates against the schema, and the reference model
// must reproduce every expected response (docs/sync-protocol-v1.md).
const syncSchema = load(join(root, "schemas/sync-v1.schema.json"));
const syncDir = join(root, "fixtures/sync");

// Expected-body matcher. "@name" (name: letter then letters or digits) captures on first use and must repeat.
// Captures are for conflict ids only: the first-use value must be a string of 1 to 64 characters (the conflictId
// schema type); anything else fails. Any other expected string starting with "@" is a fixture error: "@" is reserved.
// "*" matches any string; every other expected value must match exactly.
const CAPTURE = /^@[A-Za-z][A-Za-z0-9]*$/;
function matchBody(expected, actual, captures, path, errors) {
  if (typeof expected === "string" && expected.startsWith("@")) {
    if (!CAPTURE.test(expected)) return errors.push(`${path}: ${JSON.stringify(expected)} is not a valid capture name; "@" is reserved`);
    if (!Object.hasOwn(captures, expected)) {
      if (typeof actual !== "string" || actual.length < 1 || actual.length > 64)
        return errors.push(`${path}: capture ${expected} needs a conflictId string (1 to 64 characters), got ${JSON.stringify(actual)}`);
      captures[expected] = actual;
    } else if (captures[expected] !== actual) errors.push(`${path}: ${expected} was ${JSON.stringify(captures[expected])}, now ${JSON.stringify(actual)}`);
    return;
  }
  if (expected === "*") {
    if (typeof actual !== "string") errors.push(`${path}: expected any string, got ${typeOf(actual)}`);
    return;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return errors.push(`${path}: expected array of ${expected.length}, got ${JSON.stringify(actual)}`);
    expected.forEach((e, i) => matchBody(e, actual[i], captures, `${path}[${i}]`, errors));
    return;
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return errors.push(`${path}: expected object, got ${JSON.stringify(actual)}`);
    const ek = Object.keys(expected).sort(), ak = Object.keys(actual).sort();
    if (JSON.stringify(ek) !== JSON.stringify(ak)) errors.push(`${path}: keys ${ak.join(",")} differ from expected ${ek.join(",")}`);
    for (const k of ek) if (k in actual) matchBody(expected[k], actual[k], captures, `${path}.${k}`, errors);
    return;
  }
  if (expected !== actual) errors.push(`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const substitute = (v, captures) =>
  typeof v === "string" && Object.hasOwn(captures, v) ? captures[v]
    : Array.isArray(v) ? v.map((x) => substitute(x, captures))
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, substitute(x, captures)]))
    : v;

function responseDef(method, path, status) {
  const name = new URL(path, "http://sync.invalid").pathname;
  if (status === 400) return "errorBody";
  if (status === 409) return "resyncError";
  if (status !== 200) return null;
  return { "/api/sync/v1/push": "pushResponse", "/api/sync/v1/changes": "changesResponse", "/api/sync/v1/conflicts": "conflictsResponse" }[name] ?? null;
}

// Sync values are real archive records (docs/sync-protocol-v1.md, "Values"). Archive schema for the value of a create op of this kind,
// or null when the kind has none here. The library record is the `library` property of library.json; the plural defs are arrays of records.
function recordSchema(kind) {
  const d = archiveSchema.$defs;
  if (kind === "library") return d.library.properties.library;
  if (["universe", "series", "book", "manuscriptNode"].includes(kind)) return d[kind];
  const plural = { reference: "references", note: "notes", template: "templates", field: "fields", entry: "entries", fact: "facts", question: "questions", event: "events", stateChange: "stateChanges" }[kind];
  if (plural) return d[plural].items;
  if (kind === "relationshipType") return d.relationships.properties.relationshipTypes.items;
  if (kind === "relationship") return d.relationships.properties.relationships.items;
  return null;
}
const RESERVED_SYNC_FIELDS = new Set(["id", "createdAt", "updatedAt", "deletedAt"]);

// Every create value must validate against the archive def for its kind, every document value against document-v1
// (nodeId equal to the record id), and every set value against the archive property it sets. The one exception is a step marked
// `invalid_value`: it must fail the archive schema and be answered with a rejected INVALID_VALUE.
function checkSyncValues(label, step) {
  const ops = step.request.body?.ops;
  if (!Array.isArray(ops) || step.invalid_request) return;
  let sawInvalid = false;
  ops.forEach((op, i) => {
    const l = `${label} op ${i + 1} (${op.op} ${op.recordKind})`;
    if (op.op === "create" && op.recordKind !== "document") {
      const schema = recordSchema(op.recordKind);
      if (!schema) return expect(`${l} has an archive schema`, [`no archive def for kind ${op.recordKind}`], true);
      const errors = check(schema, op.value, archiveSchema);
      if (step.invalid_value) {
        sawInvalid = true;
        expect(`${l} value is deliberately invalid (invalid_value)`, errors, false);
      } else expect(`${l} value is a valid archive record`, errors, true);
    } else if (op.op === "set" && op.recordKind !== "document") {
      const prop = recordSchema(op.recordKind)?.properties?.[op.field];
      if (prop && !RESERVED_SYNC_FIELDS.has(op.field)) expect(`${l} value fits archive field ${op.field}`, check(prop, op.value, archiveSchema), true);
    } else if (op.op === "document") {
      const errors = check(documentSchema, op.value, documentSchema);
      if (op.value?.nodeId !== op.recordId) errors.push("nodeId differs from recordId");
      expect(`${l} value is a valid document`, errors, true);
    }
  });
  if (step.invalid_value) {
    const codes = (step.response?.body?.results ?? []).map((r) => r.code);
    expect(`${label} invalid_value step is answered INVALID_VALUE`, sawInvalid && codes.includes("INVALID_VALUE") ? [] : ["needs a create op and a rejected INVALID_VALUE result"], true);
  }
}

// The sync fixtures must exist: a missing or empty directory, or a wrong file count, is a failure, never a skip.
const EXPECTED_SYNC_FIXTURES = 18;
let syncFiles = [];
if (!existsSync(syncDir) || !statSync(syncDir).isDirectory()) expect("fixtures/sync exists", ["directory is missing"], true);
else {
  syncFiles = readdirSync(syncDir).filter((f) => f.endsWith(".json"));
  expect("fixtures/sync is not empty", syncFiles.length ? [] : ["no fixture files"], true);
  expect(`fixtures/sync has ${EXPECTED_SYNC_FIXTURES} fixture files`,
    syncFiles.length === EXPECTED_SYNC_FIXTURES ? [] : [`found ${syncFiles.length}`], true);
}
for (const f of syncFiles) {
  const scenario = load(join(syncDir, f));
  const lib = createLibrary(scenario.epoch);
  const captures = Object.create(null);
  scenario.steps.forEach((s, i) => {
    const label = `sync/${f} step ${i + 1}`;
    const { method, path, body } = s.request;
    checkSyncValues(label, s);
    const isPush = method === "POST" && path === "/api/sync/v1/push";
    if (s.invalid_request) {
      // The schema must reject the request, and the model must answer it with the expected 400 and change nothing.
      if (!isPush) expect(`${label} invalid_request is only supported on push steps`, [`${method} ${path} is not a push request; the checker cannot verify it against the schema`], true);
      else expect(`${label} invalid request is rejected by the schema`, check(syncSchema.$defs.pushRequest, body, syncSchema), false);
    } else if (isPush) expect(`${label} request matches pushRequest`, check(syncSchema.$defs.pushRequest, body, syncSchema), true);
    const actual = handle(lib, method, path, substitute(body, captures));
    const def = responseDef(method, path, actual.status);
    expect(`${label} response has a schema`, def ? [] : [`no schema for ${method} ${path} -> ${actual.status}`], true);
    if (def) expect(`${label} response matches ${def}`, check(syncSchema.$defs[def], actual.body, syncSchema), true);
    const errors = [];
    if (!s.response) errors.push("step has no expected response");
    else {
      if (actual.status !== s.response.status) errors.push(`status ${actual.status}, expected ${s.response.status}`);
      matchBody(s.response.body, actual.body, captures, "$", errors);
      if (s.invalid_request && (s.response.status !== 400 || s.response.body?.error?.code !== "INVALID_REQUEST"))
        errors.push("an invalid_request step must expect 400 INVALID_REQUEST");
    }
    expect(`${label} response matches expected`, errors, true);
  });
}

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
