# Canonical document format, version 1

Schema: [`schemas/document.schema.json`](../schemas/document.schema.json). Design rationale: [ADR-0001 D1](adr/0001-m0-foundation.md).

A canonical document is the editor-independent body of one manuscript node of kind `scene`, `frontMatter` or `backMatter`. It is the source of truth. Editor formats (TextKit attributed strings, ProseMirror JSON) are derived from it and converted back to it.

## Shape

```json
{
  "schema": "writers-rolltop/document",
  "version": 1,
  "nodeId": "20000000-0000-4000-8000-000000000001",
  "blocks": [
    { "id": "b0000000-0000-4000-8000-000000000001", "type": "heading", "level": 2,
      "content": [ { "type": "text", "text": "The letter" } ] },
    { "id": "b0000000-0000-4000-8000-000000000002", "type": "paragraph",
      "content": [
        { "type": "text", "text": "The rain arrived " },
        { "type": "text", "text": "just", "marks": [ { "type": "emphasis" } ] },
        { "type": "text", "text": " before the letter." },
        { "type": "hardBreak" },
        { "type": "text", "text": "Mara read it twice.",
          "marks": [ { "type": "anchor", "id": "a0000000-0000-4000-8000-000000000001" } ] } ] }
  ]
}
```

| Element | Fields |
|---|---|
| document | `schema` = `"writers-rolltop/document"`, `version` = `1`, `nodeId` (UUID), `blocks` (array, may be empty) |
| `paragraph` block | `id` (UUID), `content` (inline array, may be empty) |
| `heading` block | `id`, `level` (integer 1–6), `content` |
| `text` inline | `text` (non-empty string), `marks` (optional array; omitted when empty) |
| `hardBreak` inline | no other fields |
| `strong`, `emphasis` mark | no other fields |
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

## Normalization (writers MUST emit normalized documents; readers normalize on input)

Normalization is idempotent and is applied by every adapter before comparison or storage.

- **N1. Line terminators.** In text, `\r\n`, `\r`, `\n`, U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR become a `hardBreak` inline that splits the text node. Both halves keep the original marks.
- **N2. Empty text.** Text nodes with `""` are removed.
- **N3. Marks.** Duplicate marks are removed. Marks are sorted in canonical order: `strong`, `emphasis`, `link`, then `anchor`s by `id` ascending (bytewise). A `marks` array that ends up empty is omitted.
- **N4. Merging.** Adjacent text nodes whose mark arrays are equal merge into one.
- **N5. No Unicode normalization.** Code points are preserved exactly; NFC/NFD forms are distinct text. Implementations compare text by code-unit or scalar sequence, never by canonical equivalence. (Swift's `String ==` uses canonical equivalence and MUST NOT be used for this.)
- **N6. Key order** is not significant. Serializers SHOULD emit sorted keys for readable diffs.

## Equality

Two documents are semantically equal when their normalized forms are structurally identical under N5 text comparison. Archive file bytes may differ between implementations. Round-trip tests compare normalized structure, not bytes.

## Word count

Implementations count words over the concatenated text of all blocks, with blocks and `hardBreak`s acting as separators. M0 uses Unicode default word boundaries (UAX #29) as exposed by the platform. Counts are informational and never stored in archives.

## Fixtures

- `fixtures/documents/valid/*.json`: must be accepted. Each is already normalized.
- `fixtures/documents/normalize/<name>.input.json` + `<name>.expected.json`: normalizing the input must equal the expected output.
- `fixtures/documents/invalid/*.json`: must be rejected. `fixtures/documents/invalid/expected.json` maps each file to its error code.
