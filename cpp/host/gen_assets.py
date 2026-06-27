#!/usr/bin/env python3
"""
gen_assets.py — zips app/frontend/dist/ into generated/frontend.zip.
The zip is then embedded as a Windows RC RCDATA resource so the host exe
is fully self-contained (no www/ sidecar directory needed).

Usage: python gen_assets.py <input_dir> <output_zip>
"""
import os
import sys
import zipfile
import hashlib

def main():
    if len(sys.argv) < 3:
        print("Usage: gen_assets.py <input_dir> <output_zip>", file=sys.stderr)
        sys.exit(1)

    input_dir  = os.path.abspath(sys.argv[1])
    output_zip = os.path.abspath(sys.argv[2])

    if not os.path.isdir(input_dir):
        print(f"ERROR: input_dir does not exist: {input_dir}", file=sys.stderr)
        print("Run 'npm run build' in app/frontend/ first.", file=sys.stderr)
        sys.exit(1)

    os.makedirs(os.path.dirname(output_zip), exist_ok=True)

    file_count = 0
    hasher = hashlib.sha256()

    with zipfile.ZipFile(output_zip, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, fnames in os.walk(input_dir):
            dirs.sort()
            for fname in sorted(fnames):
                path = os.path.join(root, fname)
                rel  = os.path.relpath(path, input_dir).replace('\\', '/')
                zf.write(path, rel)
                hasher.update(rel.encode())
                file_count += 1

    size_mb = os.path.getsize(output_zip) / (1024 * 1024)
    print(f"Generated {output_zip} ({size_mb:.1f} MB, {file_count} files)")

if __name__ == '__main__':
    main()
