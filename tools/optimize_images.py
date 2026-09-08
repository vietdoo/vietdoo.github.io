#!/usr/bin/env python3
"""
optimize_images.py — Batch image optimizer for an Astro blog repo.

What it does
------------
1. Recursively scans a source directory for .png/.jpg/.jpeg images.
2. Resizes any image wider than --max-width (blog content is rarely
   displayed wider than ~1600-1920px, so a 4000px screenshot is pure waste).
3. Re-encodes to WebP (or JPEG with --format jpeg) at a target quality,
   or — if --target-kb is set — binary-searches quality until the file
   fits the size budget while staying as high quality as possible.
4. Writes output next to the original with the new extension, and
   optionally moves originals into a backup folder (--backup-dir) so
   nothing is destroyed until you've checked the results.
5. Prints a before/after size report.
6. (Optional) Rewrites references to the old filenames inside your
   markdown/mdx content so image tags keep working after the extension
   changes — pass --content-dir for this.

It does NOT touch anything unless you run without --dry-run.

Usage
-----
  # Dry run first — see what would happen, no files written
  python3 optimize_images.py --src ./src/assets/blog --dry-run

  # Real run: WebP, cap width at 1600px, quality 82, keep originals in ./_originals
  python3 optimize_images.py --src ./src/assets/blog \\
      --max-width 1600 --quality 82 --backup-dir ./_originals

  # Target a size budget instead of a fixed quality (e.g. <= 300KB per image)
  python3 optimize_images.py --src ./src/assets/blog \\
      --max-width 1600 --target-kb 300 --backup-dir ./_originals

  # Also update .md/.mdx references from .png/.jpg to .webp
  python3 optimize_images.py --src ./src/assets/blog --content-dir ./src/content/blog \\
      --max-width 1600 --target-kb 300 --backup-dir ./_originals

Requires: pip install pillow --break-system-packages
"""

import argparse
import re
import shutil
import sys
from pathlib import Path

from PIL import Image

SUPPORTED_EXTS = {".png", ".jpg", ".jpeg"}


def human(n_bytes: int) -> str:
    for unit in ("B", "KB", "MB"):
        if n_bytes < 1024:
            return f"{n_bytes:.0f}{unit}" if unit == "B" else f"{n_bytes:.1f}{unit}"
        n_bytes /= 1024
    return f"{n_bytes:.1f}GB"


def resize_if_needed(img: Image.Image, max_width: int) -> Image.Image:
    if img.width <= max_width:
        return img
    ratio = max_width / img.width
    new_size = (max_width, max(1, round(img.height * ratio)))
    return img.resize(new_size, Image.LANCZOS)


def encode(img: Image.Image, out_path: Path, fmt: str, quality: int) -> int:
    save_kwargs = {}
    if fmt == "webp":
        save_kwargs = dict(format="WEBP", quality=quality, method=6)
    elif fmt == "jpeg":
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        save_kwargs = dict(format="JPEG", quality=quality, optimize=True, progressive=True)
    img.save(out_path, **save_kwargs)
    return out_path.stat().st_size


def encode_with_budget(img: Image.Image, out_path: Path, fmt: str, target_bytes: int,
                        q_min: int = 40, q_max: int = 95) -> tuple[int, int]:
    """Binary-search quality to fit under target_bytes. Returns (final_size, quality_used)."""
    best_size = None
    best_q = q_max
    lo, hi = q_min, q_max
    # First check if even the lowest acceptable quality still exceeds budget —
    # if so, just use q_min (don't destroy the image further than that).
    while lo <= hi:
        mid = (lo + hi) // 2
        size = encode(img, out_path, fmt, mid)
        if size <= target_bytes:
            best_size, best_q = size, mid
            lo = mid + 1  # try higher quality, still under budget
        else:
            hi = mid - 1  # too big, lower quality
    if best_size is None:
        # Even q_min didn't fit — accept q_min's result (already encoded on disk)
        best_size = encode(img, out_path, fmt, q_min)
        best_q = q_min
    else:
        # Re-encode at the winning quality since the loop's last write may be a losing attempt
        best_size = encode(img, out_path, fmt, best_q)
    return best_size, best_q


def update_content_references(content_dir: Path, renames: dict[str, str]) -> int:
    """renames: {old_filename: new_filename}. Simple string replace across .md/.mdx files."""
    count = 0
    for f in list(content_dir.rglob("*.md")) + list(content_dir.rglob("*.mdx")):
        text = f.read_text(encoding="utf-8")
        original = text
        for old_name, new_name in sorted(renames.items(), key=lambda x: len(x[0]), reverse=True):
            text = text.replace(old_name, new_name)
        if text != original:
            f.write_text(text, encoding="utf-8")
            count += 1
    return count


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", required=True, help="Directory to scan recursively for images")
    ap.add_argument("--format", choices=["webp", "jpeg"], default="webp", help="Output format (default: webp)")
    ap.add_argument("--max-width", type=int, default=1600, help="Max width in px, larger images are downscaled (default: 1600)")
    ap.add_argument("--quality", type=int, default=82, help="Fixed quality 1-95 (ignored if --target-kb set)")
    ap.add_argument("--target-kb", type=int, default=None, help="Target max size per image in KB; script searches quality to fit")
    ap.add_argument("--backup-dir", default=None, help="Move originals here (preserving relative path) instead of deleting")
    ap.add_argument("--content-dir", default=None, help="Directory of .md/.mdx files to update image references in")
    ap.add_argument("--dry-run", action="store_true", help="Report what would happen, write nothing")
    args = ap.parse_args()

    src_dir = Path(args.src)
    if not src_dir.is_dir():
        sys.exit(f"Not a directory: {src_dir}")

    images = [p for p in src_dir.rglob("*") if p.suffix.lower() in SUPPORTED_EXTS]
    if not images:
        print("No PNG/JPG images found.")
        return

    total_before = total_after = 0
    renames: dict[str, str] = {}

    print(f"Found {len(images)} images under {src_dir}\n")

    for path in images:
        orig_size = path.stat().st_size
        new_path = path.with_suffix(".webp" if args.format == "webp" else ".jpg")

        if args.dry_run:
            print(f"[dry-run] {path.name} ({human(orig_size)}) -> {new_path.name}")
            total_before += orig_size
            continue

        img = Image.open(path)
        img = resize_if_needed(img, args.max_width)

        if args.target_kb:
            new_size, used_q = encode_with_budget(img, new_path, args.format, args.target_kb * 1024)
        else:
            new_size = encode(img, new_path, args.format, args.quality)
            used_q = args.quality

        total_before += orig_size
        total_after += new_size
        renames[path.name] = new_path.name

        print(f"{path.name:40s} {human(orig_size):>9s} -> {human(new_size):>9s}  (q={used_q}, {new_path.name})")

        if new_path != path:
            if args.backup_dir:
                backup_path = Path(args.backup_dir) / path.relative_to(src_dir)
                backup_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(path), str(backup_path))
            else:
                path.unlink()

    if args.dry_run:
        print(f"\nTotal current size: {human(total_before)} across {len(images)} images.")
        print("Re-run without --dry-run to actually optimize.")
        return

    print(f"\nTotal: {human(total_before)} -> {human(total_after)} "
          f"({(1 - total_after / total_before) * 100:.0f}% smaller)" if total_before else "No files processed.")

    if args.content_dir and renames:
        n = update_content_references(Path(args.content_dir), renames)
        print(f"Updated image references in {n} content file(s).")
    elif renames and not args.content_dir:
        print("\nNote: filenames changed extension. Pass --content-dir to auto-update "
              "references in your .md/.mdx files, or update them manually.")


if __name__ == "__main__":
    main()