#!/usr/bin/env python3
"""
Create 256x256 thumbnails from images in a single folder (non-recursive).

Key behavior:
- Only reads images directly inside --src (no subfolders).
- Writes thumbnails directly into --dst (flat output).
- Aspect ratio preserved, padded to square so output is exactly 256x256.
- If output is JPG, uses ".JPG" (uppercase) extension.
- Skips if output exists and is newer than input (unless --force).
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Iterable, Set

from PIL import Image, ImageOps

SUPPORTED_EXTS: Set[str] = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp", ".bmp"}


def iter_images_non_recursive(folder: Path) -> Iterable[Path]:
    """Yield image files in folder only (no recursion)."""
    for p in folder.iterdir():
        if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS:
            yield p


def is_newer(src: Path, dst: Path) -> bool:
    """Return True if dst exists and is newer (or same mtime) than src."""
    if not dst.exists():
        return False
    return dst.stat().st_mtime >= src.stat().st_mtime


def ensure_rgb(img: Image.Image) -> Image.Image:
    """Normalize image mode to RGB for consistent thumbnail saving."""
    if img.mode == "RGB":
        return img
    if img.mode in ("RGBA", "LA", "P"):
        return img.convert("RGBA").convert("RGB")
    try:
        img8 = ImageOps.autocontrast(img.convert("L"))
        return img8.convert("RGB")
    except Exception:
        return img.convert("RGB")


def make_thumb_square(img: Image.Image, size: int = 256) -> Image.Image:
    """Resize to fit within size x size and pad to exact square."""
    img = ensure_rgb(img)
    img.thumbnail((size, size), resample=Image.Resampling.LANCZOS)

    thumb = Image.new("RGB", (size, size), (0, 0, 0))
    x = (size - img.width) // 2
    y = (size - img.height) // 2
    thumb.paste(img, (x, y))
    return thumb


def open_image_any(path: Path) -> Image.Image:
    """Open image; if multi-frame (e.g., TIFF), uses first frame."""
    img = Image.open(path)
    try:
        if getattr(img, "n_frames", 1) > 1:
            img.seek(0)
    except Exception:
        pass
    return img


def normalize_out_ext(out_ext: str) -> str:
    """Force JPG extension casing to '.JPG'."""
    out_ext = out_ext.strip()
    if not out_ext.startswith("."):
        out_ext = "." + out_ext
    if out_ext.lower() in (".jpg", ".jpeg"):
        return ".JPG"
    return out_ext.upper()  # keep others consistent too (.PNG/.WEBP)


def output_path_flat(src_img: Path, dst_dir: Path, out_ext: str) -> Path:
    """Flat output: same base name, new extension, directly in dst_dir."""
    return dst_dir / f"{src_img.stem}{out_ext}"


def save_thumb(img: Image.Image, out_path: Path, quality: int = 85) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)

    ext_lower = out_path.suffix.lower()
    if ext_lower in (".jpg", ".jpeg"):
        img.save(out_path, "JPEG", quality=quality, optimize=True)
    elif ext_lower == ".png":
        img.save(out_path, "PNG", optimize=True)
    elif ext_lower == ".webp":
        img.save(out_path, "WEBP", quality=quality, method=6)
    else:
        # Fallback to PNG if something unexpected happens
        fallback = out_path.with_suffix(".PNG")
        img.save(fallback, "PNG", optimize=True)


def create_thumbnails(
    src_dir: Path,
    dst_dir: Path,
    size: int = 256,
    out_ext: str = ".JPG",
    quality: int = 85,
    force: bool = False,
) -> None:
    """
    Create thumbnails from images in src_dir (non-recursive) into dst_dir (flat).
    """
    if not src_dir.exists():
        raise FileNotFoundError(f"Source folder not found: {src_dir}")
    if not src_dir.is_dir():
        raise NotADirectoryError(f"Source is not a directory: {src_dir}")

    dst_dir.mkdir(parents=True, exist_ok=True)

    out_ext = normalize_out_ext(out_ext)

    total = made = skipped = failed = 0

    for src_path in iter_images_non_recursive(src_dir):
        total += 1
        out_path = output_path_flat(src_path, dst_dir, out_ext)

        if (not force) and is_newer(src_path, out_path):
            skipped += 1
            continue

        try:
            with open_image_any(src_path) as img:
                thumb = make_thumb_square(img, size=size)
                save_thumb(thumb, out_path, quality=quality)
            made += 1
        except Exception as e:
            failed += 1
            print(f"[WARN] Failed: {src_path} -> {e}")

    print("\n[Done]")
    print(f"Source:  {src_dir}")
    print(f"Dest:    {dst_dir}")
    print(f"Size:    {size}x{size}")
    print(f"Format:  {out_ext}")
    print(f"Seen:    {total}")
    print(f"Made:    {made}")
    print(f"Skipped: {skipped}")
    print(f"Failed:  {failed}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Create 256x256 thumbnails from a single folder (non-recursive).")
    parser.add_argument("--src", required=True, help="Source folder containing images (no recursion).")
    parser.add_argument("--dst", required=True, help="Destination folder for thumbnails.")
    parser.add_argument("--size", type=int, default=256, help="Thumbnail size (square). Default 256.")
    parser.add_argument("--out-ext", default=".JPG", choices=[".JPG", ".PNG", ".WEBP", ".jpg", ".png", ".webp"],
                        help='Output extension. JPG will be forced to ".JPG".')
    parser.add_argument("--quality", type=int, default=85, help="JPEG/WEBP quality (1-100). Default 85.")
    parser.add_argument("--force", action="store_true", help="Rebuild thumbnails even if outputs are newer.")
    args = parser.parse_args()

    create_thumbnails(
        src_dir=Path(args.src),
        dst_dir=Path(args.dst),
        size=args.size,
        out_ext=args.out_ext,
        quality=args.quality,
        force=args.force,
    )


if __name__ == "__main__":
    main()
