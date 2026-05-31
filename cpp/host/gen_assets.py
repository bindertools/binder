#!/usr/bin/env python3
"""
gen_assets.py — packages app/frontend/dist/ into a zip and generates
cpp/host/generated/assets_zip.rc (Windows) or assets_zip.cpp (Unix).

Usage: python gen_assets.py <input_dir> <output_dir> <platform>
  platform: "windows" | "unix"

Windows output:
  generated/frontend.zip     — the zip archive (embedded via RC resource)
  generated/assets_zip.rc    — RC file embedding the zip
  generated/assets_data.cpp  — lookup table (empty, zip handles it)

Unix output:
  generated/frontend.zip     — the zip archive
  generated/assets_data.cpp  — declares kFrontendZip[] as raw bytes (via incbin or xxd)
"""
import os
import sys
import zipfile
import hashlib

def main():
    if len(sys.argv) < 4:
        print("Usage: gen_assets.py <input_dir> <output_dir> <platform>", file=sys.stderr)
        sys.exit(1)

    input_dir = os.path.abspath(sys.argv[1])
    output_dir = os.path.abspath(sys.argv[2])
    platform   = sys.argv[3].lower()

    if not os.path.isdir(input_dir):
        print(f"ERROR: input_dir does not exist: {input_dir}", file=sys.stderr)
        print("Run 'npm run build' in app/frontend/ first.", file=sys.stderr)
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)

    # Create a zip archive of the entire dist directory
    zip_path = os.path.join(output_dir, "frontend.zip")
    hasher = hashlib.sha256()
    file_count = 0

    with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, fnames in os.walk(input_dir):
            dirs.sort()
            for fname in sorted(fnames):
                path = os.path.join(root, fname)
                rel  = os.path.relpath(path, input_dir).replace('\\', '/')
                zf.write(path, rel)
                hasher.update(rel.encode())
                file_count += 1

    build_id  = hasher.hexdigest()[:16]
    zip_size  = os.path.getsize(zip_path)

    if platform == "windows":
        # Windows: embed the zip as an RC RCDATA resource named FRONTEND_ZIP
        rc_path = os.path.join(output_dir, "assets_zip.rc")
        with open(rc_path, 'w', newline='\n') as rc:
            rc.write('// AUTO-GENERATED — do not edit\n')
            rc.write('#include <windows.h>\n')
            rc.write(f'FRONTEND_ZIP RCDATA "{zip_path.replace(chr(92), "/")}"\n')

        # Generate a small C++ file with the build ID (the RC embeds the actual data)
        cpp_path = os.path.join(output_dir, "assets_data.cpp")
        with open(cpp_path, 'w', newline='\n') as cpp:
            cpp.write('// AUTO-GENERATED — do not edit\n')
            cpp.write('#include "assets_meta.hpp"\n\n')
            cpp.write(f'const char* kBuildId = "{build_id}";\n')
            cpp.write(f'const int   kAssetFileCount = {file_count};\n')
    else:
        # Unix: generate a uint8_t array via xxd-style embedding
        # For large files this still works because it's a single compile unit per chunk
        cpp_path = os.path.join(output_dir, "assets_data.cpp")
        with open(zip_path, 'rb') as f:
            zip_bytes = f.read()

        with open(cpp_path, 'w', newline='\n') as cpp:
            cpp.write('// AUTO-GENERATED — do not edit\n')
            cpp.write('#include "assets_meta.hpp"\n\n')
            cpp.write(f'const char* kBuildId = "{build_id}";\n')
            cpp.write(f'const int   kAssetFileCount = {file_count};\n\n')
            cpp.write('// Frontend zip archive embedded as raw bytes\n')
            cpp.write('extern "C" {\n')
            cpp.write(f'const unsigned char kFrontendZipData[] = {{\n')
            # Write in rows of 16 bytes
            for i in range(0, len(zip_bytes), 16):
                row = zip_bytes[i:i+16]
                hex_row = ', '.join(f'0x{b:02x}' for b in row)
                cpp.write(f'  {hex_row},\n')
            cpp.write('};\n')
            cpp.write(f'const unsigned long kFrontendZipSize = {len(zip_bytes)}UL;\n')
            cpp.write('} // extern "C"\n')

    zip_mb = zip_size / (1024 * 1024)
    print(f"Generated {zip_path} ({zip_mb:.1f} MB, {file_count} files, build_id={build_id})")
    if platform == "windows":
        print(f"Generated {rc_path} (RC resource)")
    print(f"Generated {cpp_path}")

if __name__ == '__main__':
    main()
