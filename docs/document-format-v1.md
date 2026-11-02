# Canonical document format, version 1

Schema: [`schemas/document-v1.schema.json`](../schemas/document-v1.schema.json). Design rationale: [ADR-0001 D1](adr/0001-m0-foundation.md).

A canonical document is the editor-independent body of one manuscript node of kind `scene`, `frontMatter` or `backMatter`. It is the source of truth. Editor formats (TextKit attributed strings, ProseMirror JSON) are derived from it and converted back to it.

> Version 1 is a **draft** until the first public release. Until then it may change in place; afterwards every change follows the [compatibility policy](compatibility-policy.md).

## Shape

```json
{
  "schema": "writers-rolltop/document",
  "version": 1,
  "nodeId": "20000000-0000-4000-8000-000000000001",
  "blocks": [
    { "id": "b0000000-0000-4000-8000-000000000001", "type": "heading", "level": 2, "align": "center",
      "content": [ { "type": "text", "text": "The letter" } ] },
    { "id": "b0000000-0000-4000-8000-000000000002", "type": "paragraph",
      "content": [
        { "type": "text", "text": "The rain arrived " },
        { "type": "text", "text": "just", "marks": [ { "type": "emphasis" } ] },
        { "type": "text", "text": " before the letter." },
        { "type": "hardBreak" },
        { "type": "text", "text": "Mara read it twice.",
          "marks": [ { "type": "anchor", "id": "a0000000-0000-4000-8000-000000000001" } ] } ] },
    { "id": "b0000000-0000-4000-8000-000000000003", "type": "paragraph", "quote": true,
      "content": [ { "type": "text", "text": "Come home before the tide turns." } ] },
    { "id": "b0000000-0000-4000-8000-000000000004", "type": "sceneBreak" },
    { "id": "b0000000-0000-4000-8000-000000000005", "type": "paragraph", "list": { "style": "bullet", "level": 0 },
      "content": [ { "type": "text", "text": "salt" } ] }
  ]
}
```

### Blocks

| Block | Fields |
|---|---|
| `paragraph` | `id`, `content`; optional `align`, `quote`, `list` |
| `heading` | `id`, `level` (integer 1–6), `content`; optional `align`, `quote` |
| `sceneBreak` | `id` only. A semantic scene break (exporters render it as their scene-break ornament, e.g. `* * *` or a fleuron), never typed asterisks |

Optional block properties (omitted when not set):

| Property | Values | Meaning |
|---|---|---|
| `align` | `"left"`, `"center"`, `"right"` | Explicit alignment. Omitted means *natural*: follows the text direction (left for English, right for Arabic or Hebrew). Justification is a layout preference, not content |
| `quote` | `true` | The block is part of a quotation (a letter, an epigraph, a quoted document). Consecutive quoted blocks form one quotation |
| `list` | `{ "style": "bullet" \| "ordered", "level": 0–7 }` | The paragraph is a list item. Consecutive list items form one list; `level` is the nesting depth |

Blocks are **flat**. Quotations and lists are expressed by properties on consecutive blocks, not by nesting. Editors that nest (ProseMirror) group and ungroup on conversion.

### Inline content and marks

| Element | Fields |
|---|---|
| `text` inline | `text` (non-empty string), `marks` (optional array; omitted when empty) |
| `hardBreak` inline | no other fields |
| `strong`, `emphasis`, `underline` mark | no other fields |
| `link` mark | `href` (non-empty string, stored byte-for-byte; not URL-normalized) |
| `anchor` mark | `id` (UUID): a stable passage identifier used by `references.json` and future comments |

UUIDs are lowercase canonical form: `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`.

## Validity rules (a reader MUST reject violations)

1. **Closed schema.** No other block, inline or mark types and no extra fields. A `version` greater than the reader supports is rejected with `DOCUMENT_UNSUPPORTED_VERSION`, never partially read.
2. Block IDs are unique within the document.
3. Text must not contain U+0000–U+0008, U+000B, U+000C, U+000E–U+001F or U+007F after normalization. Line terminators are handled by normalization (rule N1). Tab (U+0009) is allowed.
4. A text node has at most one `link` mark. A mark type other than `anchor` appears at most once per text node. An `anchor` id appears at most once per text node.
5. All text nodes carrying a given anchor id are in **one block** and form **one contiguous run** of text nodes. A `hardBreak` inside the run is allowed; a text node without the anchor is not.
6. Anchor IDs are unique across blocks: the same anchor never appears in two blocks.
7. `quote` is only `true` (never `false`), and a block can't have both `quote` and `list` in version 1.
8. **List structure.** In each run of consecutive list items, the first item has `level` 0, and each item's `level` is at most one more than the previous item's. Ordered items are numbered from 1 within each run and level. A list can't start at another number in version 1.

Consequences of the flat model, accepted for version 1: two separate quotations or lists with nothing between them are read as one. Authors separate them with an ordinary paragraph.

## Normalization (writers MUST emit normalized documents; readers normalize on input)

Normalization is idempotent and is applied by every adapter before comparison or storage.

- **N1. Line terminators.** In text, `\r\n`, `\r`, `\n`, U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR become a `hardBreak` inline that splits the text node. Both halves keep the original marks.
- **N2. Empty text.** Text nodes with `""` are removed.
- **N3. Marks.** Duplicate marks are removed. Marks are sorted in canonical order: `strong`, `emphasis`, `underline`, `link`, then `anchor`s by `id` ascending (bytewise). A `marks` array that ends up empty is omitted.
- **N4. Merging.** Adjacent text nodes whose mark arrays are equal merge into one.
- **N5. No Unicode normalization.** Code points are preserved exactly; NFC/NFD forms are distinct text. Implementations compare text by code-unit or scalar sequence, never by canonical equivalence. (Swift's `String ==` uses canonical equivalence and MUST NOT be used for this.)
- **N6. Key order** is not significant. Serializers SHOULD emit sorted keys for readable diffs.

Block properties are never rewritten by normalization. In particular, explicit `"align": "left"` is kept, because it differs from natural alignment in right-to-left text.

## Equality

Two documents are semantically equal when their normalized forms are structurally identical under N5 text comparison. Archive file bytes may differ between implementations. Round-trip tests compare normalized structure, not bytes.

## Word count

Implementations count words over the concatenated text of all blocks, with blocks and `hardBreak`s acting as separators. Scene breaks contribute nothing. M0 uses Unicode default word boundaries (UAX #29) as exposed by the platform. Counts are informational and never stored in archives.

## Fixtures

- `fixtures/documents/valid/*.json`: must be accepted. Each is already normalized.
- `fixtures/documents/normalize/<name>.input.json` + `<name>.expected.json`: normalizing the input must equal the expected output.
- `fixtures/documents/invalid/*.json`: must be rejected. `fixtures/documents/invalid/expected.json` maps each file to its error code.
