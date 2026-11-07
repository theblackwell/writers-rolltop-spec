#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Black Well Foundry
// Dependency-free check that spec fixtures match the JSON Schemas.
// Supports the JSON Schema subset used in schemas/: type, const, enum, pattern,
// minLength, maxLength, minimum, maximum, minItems, minProperties, required, properties,
// additionalProperties, items, oneOf and local $ref ("#/$defs/...").
// Usage: node tools/check-schemas.mjs
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
