#!/usr/bin/env python3
"""Package a committed portal delta for review. Does not deploy or run SQL."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import zipfile


BASELINE = "390fff7"


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], timeout=30)


def safe_path(name):
    parts = PurePosixPath(name).parts
    if not parts or name.startswith("/") or any(p in ("..", ".") for p in parts):
        raise ValueError("unsafe archive path")
    lower = name.lower()
    forbidden = (".env", "node_modules", ".git", "__pycache__", "private", "secrets", "data", "test-results")
    if any(p in forbidden or p.startswith(".env.") for p in (x.lower() for x in parts)):
        raise ValueError("runtime/secret path cannot enter release: " + name)
    if lower.endswith((".pem", ".key", ".sqlite", ".db", ".log", ".dump")):
        raise ValueError("runtime/secret file cannot enter release: " + name)
    return name


def add(archive, name, data):
    info = zipfile.ZipInfo(name, date_time=(2026, 11, 5, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    archive.writestr(info, data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--base", default=BASELINE)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    head = git(root, "rev-parse", "HEAD").decode().strip()
    base = git(root, "rev-parse", args.base + "^{commit}").decode().strip()
    if not re.fullmatch(r"[a-f0-9]{40}", head + ""):
        raise SystemExit("Unexpected HEAD")
    git(root, "merge-base", "--is-ancestor", base, head)
    if git(root, "diff", "--name-only", "HEAD").strip():
        raise SystemExit("Commit tracked changes before packaging")
    output = args.output.resolve()
    if output.is_relative_to(root):
        raise SystemExit("Write release outside the worktree")
    if output.exists():
        raise SystemExit("Refusing to overwrite existing release")
    if git(root, "diff", "--name-only", "--diff-filter=DR", base, head).strip():
        raise SystemExit("Deletions/renames require a separately reviewed release")
    names = git(root, "diff", "--name-only", "--diff-filter=ACM", base, head).decode().splitlines()
    if not names:
        raise SystemExit("No committed portal changes")
    entries, files = [], []
    for name in names:
        safe_path(name)
        contents = git(root, "show", head + ":" + name)
        if len(contents) > 5 * 1024 * 1024:
            raise SystemExit("Review large file separately: " + name)
        old = subprocess.run(["git", "-C", str(root), "show", base + ":" + name],
                             capture_output=True, timeout=30)
        previous = old.stdout if old.returncode == 0 else None
        entries.append({"path": name, "size": len(contents),
                        "sha256": hashlib.sha256(contents).hexdigest(),
                        "base_sha256": hashlib.sha256(previous).hexdigest() if previous is not None else None,
                        "mode": "compare_then_review_overlay" if previous is not None else "new_file"})
        files.append(("candidate/" + name, contents))
    manifest = {"source_commit": head, "base_commit": base,
                "production_authorized": False, "automatic_apply_supported": False,
                "warning": "Candidate only. Compare live files, restore backups in isolation, then obtain release authorization.",
                "files": entries}
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "x") as archive:
        add(archive, "manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False).encode() + b"\n")
        for name, contents in sorted(files):
            add(archive, name, contents)
        add(archive, "source.patch", git(root, "diff", "--binary", base, head))
    print(json.dumps({"file": str(output), "source_commit": head, "files": len(entries),
                      "sha256": hashlib.sha256(output.read_bytes()).hexdigest()}, indent=2))


if __name__ == "__main__":
    main()
