#!/usr/bin/env python3
"""Derive archive conformance fixtures from a valid sample archive.

Usage: python3 tools/make_archive_fixtures.py <sample.rolltop>

Writes fixtures/archives/{valid,invalid,malicious}/ and expected.json. The
sample archive itself is produced by the reference implementation:
`rolltop sample X.rolltoplib && rolltop export X.rolltoplib sample-library.rolltop`.
Standard library only.
"""
import hashlib
import io
import json
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "fixtures" / "archives"


def load(path):
    with zipfile.ZipFile(path) as z:
        return {name: z.read(name) for name in z.namelist()}


def dumps(value):
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode()


def recompute(files):
    """Rebuild checksums.json and the manifest pin after editing files."""
    files = dict(files)
    listed = sorted(p for p in files if p not in ("manifest.json", "checksums.json"))
    checksums = dumps({"algorithm": "sha256", "files": [
        {"path": p, "byteLength": len(files[p]), "sha256": hashlib.sha256(files[p]).hexdigest()} for p in listed]})
    files["checksums.json"] = checksums
    manifest = json.loads(files["manifest.json"])
    manifest["checksums"] = {"path": "checksums.json", "byteLength": len(checksums), "sha256": hashlib.sha256(checksums).hexdigest()}
    files["manifest.json"] = dumps(manifest)
    return files


def write(path, files, extra=()):
    """files: {name: bytes}; extra: [(ZipInfo or name, bytes)] appended verbatim (may be unsafe)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    buf = io.BytesIO()
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # duplicate-name fixtures are intentional
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for name in ["manifest.json", "checksums.json"] + sorted(n for n in files if n not in ("manifest.json", "checksums.json")):
                if name in files:
                    z.writestr(name, files[name])
            for info, data in extra:
                if isinstance(info, zipfile.ZipInfo):
                    z.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
                else:
                    z.writestr(info, data)
    path.write_bytes(buf.getvalue())


def edit_json(files, path, fn):
    value = json.loads(files[path])
    fn(value)
    files = dict(files)
    files[path] = dumps(value)
    return files


def main(sample):
    base = load(sample)
    if ROOT.exists():
        shutil.rmtree(ROOT)
    expected = {}

    # valid/
    valid = ROOT / "valid"
    shutil.copy(sample, valid.mkdir(parents=True) or valid / "sample-library.rolltop")
    with zipfile.ZipFile(sample) as z:
        z.extractall(valid / "sample-library")
    expected["valid/sample-library.rolltop"] = "VALID"

    def add_future(v):
        v["books"][0]["x-futureBookProperty"] = {"series": "preserve me", "n": 7}
    future = recompute(edit_json(base, "library.json", add_future))
    future = edit_json(future, "manifest.json", lambda m: m.__setitem__("x-futureManifestProperty", True))
    write(valid / "unknown-optional-fields.rolltop", future)
    expected["valid/unknown-optional-fields.rolltop"] = "VALID"

    # malicious/
    mal = ROOT / "malicious"
    cases = {
        "path-traversal.rolltop": [("../evil.txt", b"x")],
        "absolute-path.rolltop": [("/tmp/evil.txt", b"x")],
        "backslash-traversal.rolltop": [("..\\evil.txt", b"x")],
        "dot-segment.rolltop": [("bible/./entries.json", b"[]")],
        "duplicate-path.rolltop": [("references.json", b"[]")],
        "duplicate-path-case.rolltop": [("References.json", b"[]")],
        "unexpected-file.rolltop": [("notes.txt", b"hello")],
        "unexpected-directory-file.rolltop": [("manuscript/readme.txt", b"hello")],
    }
    codes = {
        "path-traversal.rolltop": "ARCHIVE_PATH_TRAVERSAL", "absolute-path.rolltop": "ARCHIVE_PATH_TRAVERSAL",
        "backslash-traversal.rolltop": "ARCHIVE_PATH_TRAVERSAL", "dot-segment.rolltop": "ARCHIVE_PATH_TRAVERSAL",
        "duplicate-path.rolltop": "ARCHIVE_DUPLICATE_PATH", "duplicate-path-case.rolltop": "ARCHIVE_DUPLICATE_PATH",
        "unexpected-file.rolltop": "ARCHIVE_UNEXPECTED_FILE", "unexpected-directory-file.rolltop": "ARCHIVE_UNEXPECTED_FILE",
    }
    for name, extra in cases.items():
        write(mal / name, base, extra)
        expected[f"malicious/{name}"] = codes[name]

    link = zipfile.ZipInfo("attachments/" + "0" * 64)
    link.create_system = 3
    link.external_attr = (0o120777 << 16)
    write(mal / "symlink.rolltop", base, [(link, b"/etc/passwd")])
    expected["malicious/symlink.rolltop"] = "ARCHIVE_SYMLINK"

    zeros = b"\0" * (50 << 20)
    bomb = zipfile.ZipInfo("attachments/" + hashlib.sha256(zeros).hexdigest())
    write(mal / "zip-bomb.rolltop", base, [(bomb, zeros)])
    expected["malicious/zip-bomb.rolltop"] = "ARCHIVE_TOO_LARGE"

    # invalid/
    inv = ROOT / "invalid"
    doc_path = sorted(p for p in base if p.startswith("manuscript/"))[0]
    entries = json.loads(base["bible/entries.json"])
    library = json.loads(base["library.json"])
    standalone_book = next(b["id"] for b in library["books"] if "seriesId" not in b)
    universe_entry = next(i for i, e in enumerate(entries) if e["scope"]["kind"] == "universe" and "templateId" in e)

    tampered = dict(base)
    tampered[doc_path] = base[doc_path].replace(b'"paragraph"', b'"paragraph" ', 1)
    write(inv / "bad-checksum.rolltop", tampered)
    expected["invalid/bad-checksum.rolltop"] = "ARCHIVE_CHECKSUM_MISMATCH"

    missing = {k: v for k, v in base.items() if k != "references.json"}
    write(inv / "missing-file.rolltop", missing)
    expected["invalid/missing-file.rolltop"] = "ARCHIVE_MISSING_FILE"

    attachment = sorted(p for p in base if p.startswith("attachments/"))[0]
    write(inv / "missing-attachment.rolltop", recompute({k: v for k, v in base.items() if k != attachment}))
    expected["invalid/missing-attachment.rolltop"] = "ARCHIVE_MISSING_FILE"

    write(inv / "unsupported-version.rolltop", edit_json(base, "manifest.json", lambda m: m.__setitem__("formatVersion", 2)))
    expected["invalid/unsupported-version.rolltop"] = "ARCHIVE_UNSUPPORTED_VERSION"

    write(inv / "not-rolltop.rolltop", edit_json(base, "manifest.json", lambda m: m.__setitem__("format", "someone-elses-format")))
    expected["invalid/not-rolltop.rolltop"] = "ARCHIVE_NOT_ROLLTOP"

    bad_utf8 = dict(base)
    bad_utf8["library.json"] = base["library.json"].replace(b"The Lost Lexicon", b"The Lost \xff\xfe Lexicon", 1)
    write(inv / "invalid-utf8.rolltop", recompute(bad_utf8))
    expected["invalid/invalid-utf8.rolltop"] = "ARCHIVE_INVALID_UTF8"

    bad_json = dict(base)
    bad_json["references.json"] = b"[{"
    write(inv / "invalid-json.rolltop", recompute(bad_json))
    expected["invalid/invalid-json.rolltop"] = "ARCHIVE_INVALID_JSON"

    write(inv / "broken-reference.rolltop", recompute(edit_json(base, "references.json",
          lambda refs: refs[0].__setitem__("entryId", "99999999-9999-4999-8999-999999999999"))))
    expected["invalid/broken-reference.rolltop"] = "REFERENCE_UNRESOLVED"

    write(inv / "invalid-document.rolltop", recompute(edit_json(base, doc_path,
          lambda d: d["blocks"].append({"id": "eeeeeeee-0000-4000-8000-000000000001", "type": "blockquote", "content": []}))))
    expected["invalid/invalid-document.rolltop"] = "DOCUMENT_INVALID"

    write(inv / "newer-document-version.rolltop", recompute(edit_json(base, doc_path, lambda d: d.__setitem__("version", 2))))
    expected["invalid/newer-document-version.rolltop"] = "DOCUMENT_UNSUPPORTED_VERSION"

    write(inv / "override-outside-scope.rolltop", recompute(edit_json(base, "bible/entries.json",
          lambda es: es[universe_entry]["overrides"].append({"bookId": standalone_book, "values": {}}))))
    expected["invalid/override-outside-scope.rolltop"] = "INTEGRITY_VIOLATION"

    write(inv / "scene-at-root.rolltop", recompute(edit_json(base, "library.json",
          lambda lib: next(n for n in lib["manuscriptNodes"] if n["kind"] == "scene").pop("parentId"))))
    expected["invalid/scene-at-root.rolltop"] = "INTEGRITY_VIOLATION"

    (ROOT / "expected.json").write_bytes(dumps(dict(sorted(expected.items()))))
    print(f"wrote {len(expected)} archive fixtures to {ROOT}")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
