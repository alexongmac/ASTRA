#!/usr/bin/env python3
"""Build pymysql-layer.zip and oee-ingest.zip deterministically.

Same source always produces the same zip bytes (fixed per-entry mtime,
sorted entry order, normalized permissions) so Terraform's
filebase64sha256() doesn't force a new Lambda/layer version on every
CI run when nothing actually changed.
"""
import os
import subprocess
import sys
import zipfile

LAMBDA_DIR = os.path.dirname(os.path.abspath(__file__))


def build_zip(root, out_path, strip_prefix_len):
    entries = []
    for dirpath, dirnames, filenames in os.walk(root):
        # dist-info/RECORD varies across otherwise-identical reinstalls
        # (pip re-derives it per install), and __pycache__/*.pyc embeds the
        # source mtime/hash at compile time - neither is needed at runtime
        # (Lambda compiles .py on cold start) and both break reproducibility.
        dirnames[:] = sorted(
            d for d in dirnames
            if not d.endswith(".dist-info") and d != "__pycache__"
        )
        for fname in sorted(filenames):
            full = os.path.join(dirpath, fname)
            arcname = full[strip_prefix_len:]
            entries.append((full, arcname))
    entries.sort(key=lambda e: e[1])

    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for full, arcname in entries:
            zi = zipfile.ZipInfo(arcname, date_time=(2026, 1, 1, 0, 0, 0))
            zi.external_attr = 0o644 << 16
            with open(full, "rb") as f:
                data = f.read()
            zf.writestr(zi, data, compress_type=zipfile.ZIP_DEFLATED)


def main():
    layer_python = os.path.join(LAMBDA_DIR, "layer", "python")
    os.makedirs(layer_python, exist_ok=True)
    subprocess.run(
        [
            sys.executable, "-m", "pip", "install",
            "-r", os.path.join(LAMBDA_DIR, "requirements.txt"),
            "-t", layer_python,
            "--upgrade",
            "--quiet",
        ],
        check=True,
    )

    build_zip(
        os.path.join(LAMBDA_DIR, "layer"),
        os.path.join(LAMBDA_DIR, "pymysql-layer.zip"),
        len(os.path.join(LAMBDA_DIR, "layer") + os.sep),
    )
    build_zip(
        os.path.join(LAMBDA_DIR, "oee-ingest"),
        os.path.join(LAMBDA_DIR, "oee-ingest.zip"),
        len(os.path.join(LAMBDA_DIR, "oee-ingest") + os.sep),
    )


if __name__ == "__main__":
    main()
