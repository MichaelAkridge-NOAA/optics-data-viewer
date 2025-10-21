# build_index_fixed_sites.py
"""
Build a GitHub Pages–friendly index for Fixed Sites with specific folder structure:
- Fixed Sites structure: region/island/site/year/site_visit
- Example: MARI/GUA/OCC-GUA-015/2022/20220612_OCC-GUA-015_RA2201

- Writes OUT_DIR/index.json         -> grid card list
- Writes OUT_DIR/items/<id>.json    -> per-dataset detail (bounded file list w/ HTTPS)
- Writes OUT_DIR/summary.json       -> rollups for dashboards

Auth:
  gcloud auth application-default login
  gcloud auth application-default set-quota-project <PROJECT_ID>
"""

from __future__ import annotations
import argparse, json, re, time, logging, sys
from pathlib import PurePosixPath, Path
from urllib.parse import quote
from collections import Counter
from datetime import datetime, timezone

import pandas as pd

# Optional fallback lister
import gcsfs
# Fast rich listing
from google.cloud import storage

IMAGE_EXTS = {"jpg","jpeg","png","tif","tiff","bmp","webp"}
VIDEO_EXTS = {"mp4","mov","avi","mkv"}
THUMB_PREF = ("jpg","jpeg","png","webp")

# ---------------- Logging ----------------
def setup_logger(level: str = "INFO", log_file: str | None = None):
    lvl = getattr(logging, level.upper(), logging.INFO)
    handlers = [logging.StreamHandler(sys.stdout)]
    if log_file:
        handlers.append(logging.FileHandler(log_file, encoding="utf-8"))
    logging.basicConfig(
        level=lvl,
        format="%(asctime)s | %(levelname)-8s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=handlers,
    )

# -------------- Helpers -----------------
def gs_to_https(gs_uri: str) -> str:
    assert gs_uri.startswith("gs://"), "gs_to_https expects gs://..."
    b_and_k = gs_uri[5:]
    bucket, key = b_and_k.split("/", 1)
    return f"https://storage.googleapis.com/{bucket}/{quote(key)}"

def parse_gs(gs_uri: str):
    if not gs_uri.startswith("gs://"):
        gs_uri = "gs://" + gs_uri
    _, rest = gs_uri.split("://", 1)
    bucket, *parts = rest.split("/", 1)
    prefix = parts[0] if parts else ""
    if prefix and not prefix.endswith("/"):
        prefix += "/"
    return gs_uri, bucket, prefix

def safe_id(text: str) -> str:
    return re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()

def human_bytes(n: int) -> str:
    units = ["B","KB","MB","GB","TB","PB"]
    val = float(n or 0)
    i = 0
    while val >= 1024 and i < len(units)-1:
        val /= 1024.0
        i += 1
    return f"{val:.2f} {units[i]}"

# -------------- Fast listers -------------
def fast_list_gcs_sdk(bucket_name: str, prefix: str, include_video: bool, max_objects: int = 0):
    """Yield dicts with key,size,updated,etag for images/(optional) videos under prefix using google-cloud-storage."""
    client = storage.Client()
    bucket = client.bucket(bucket_name)
    # Iterator returns Blob with size/updated/etag populated by the API
    it = client.list_blobs(bucket_or_name=bucket, prefix=prefix)  # page_size auto
    count = 0
    for blob in it:
        key = blob.name  # already relative to bucket
        if key.endswith("/"):
            continue
        ext = key.rsplit(".", 1)[-1].lower() if "." in key else ""
        if ext not in IMAGE_EXTS and not (include_video and ext in VIDEO_EXTS):
            continue
        yield {
            "key": key,
            "size": int(blob.size or 0),
            "updated": blob.updated.isoformat() if blob.updated else None,
            "etag": blob.etag,
            "ext": ext,
            "modality": "video" if ext in VIDEO_EXTS else "image",
        }
        count += 1
        if max_objects and count >= max_objects:
            break

def slow_list_gcsfs(bucket_name: str, prefix: str, include_video: bool, max_objects: int = 0, token="google_default"):
    """Fallback: gcsfs find + per-object info(). Slower; use only if SDK is unavailable."""
    fs = gcsfs.GCSFileSystem(token=token)
    keys = fs.find(f"{bucket_name}/{prefix}")
    keys = [k for k in keys if not k.endswith("/")]
    if max_objects > 0:
        keys = keys[:max_objects]
    for full in keys:
        key = full.split("/", 1)[1]
        ext = key.rsplit(".", 1)[-1].lower() if "." in key else ""
        if ext not in IMAGE_EXTS and not (include_video and ext in VIDEO_EXTS):
            continue
        info = fs.info(full)
        yield {
            "key": key,
            "size": int(info.get("size", 0) or 0),
            "updated": info.get("updated"),
            "etag": info.get("etag"),
            "ext": ext,
            "modality": "video" if ext in VIDEO_EXTS else "image",
        }

# -------------- Summary builder ----------
def build_summary(cards: list[dict], df_files: pd.DataFrame, root_norm: str, scanned: int, kept: int, duration_s: float):
    by_year, by_region, by_island, by_site = Counter(), Counter(), Counter(), Counter()
    total_images = sum(int(c.get("counts", {}).get("images", 0)) for c in cards)
    total_videos = sum(int(c.get("counts", {}).get("videos", 0) or 0) for c in cards)
    total_size = int(df_files["size"].sum()) if not df_files.empty else 0

    for c in cards:
        tags = c.get("tags", [])
        year = next((t for t in tags if t.isdigit() and len(t)==4), None)
        if year: by_year[year] += 1
        
        # Fixed Sites structure: region/island/site/year/site_visit
        # tags should be: [region, island, site, year, site_visit]
        if len(tags) >= 1: by_region[tags[0]] += 1
        if len(tags) >= 2: by_island[tags[1]] += 1
        if len(tags) >= 3: by_site[tags[2]] += 1

    largest_by_images, largest_by_size = [], []
    if not df_files.empty:
        df_img = df_files[df_files["modality"]=="image"]
        img_counts = (df_img.groupby("dataset_rel")["key"].count()
                      .reset_index(name="images")).sort_values("images", ascending=False)
        size_sums = (df_files.groupby("dataset_rel")["size"].sum()
                     .reset_index(name="size")).sort_values("size", ascending=False)

        def rel_to_card(rel):
            cid = safe_id(rel)
            return next((c for c in cards if c["id"]==cid), None)

        for _, row in img_counts.head(25).iterrows():
            rel = row["dataset_rel"]; card = rel_to_card(rel)
            if card:
                largest_by_images.append({"id": card["id"], "title": card["title"], "gs_prefix": card["gs_prefix"], "images": int(row["images"])})
        for _, row in size_sums.head(25).iterrows():
            rel = row["dataset_rel"]; card = rel_to_card(rel)
            if card:
                sz = int(row["size"])
                largest_by_size.append({"id": card["id"], "title": card["title"], "gs_prefix": card["gs_prefix"], "size_bytes": sz, "size_human": human_bytes(sz)})

    updated_min = str(df_files["updated"].min()) if "updated" in df_files.columns and not df_files["updated"].isna().all() else ""
    updated_max = str(df_files["updated"].max()) if "updated" in df_files.columns and not df_files["updated"].isna().all() else ""

    return {
        "build_info": {
            "root": root_norm,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "duration_s": round(duration_s, 3),
            "objects_scanned": int(scanned),
            "media_kept": int(kept),
        },
        "totals": {
            "datasets": len(cards),
            "images": int(total_images),
            "videos": int(total_videos),
            "size_bytes": total_size,
            "size_human": human_bytes(total_size),
        },
        "by_year": dict(sorted(by_year.items(), key=lambda x: x[0])),
        "by_region_top10": dict(by_region.most_common(10)),
        "by_island_top10": dict(by_island.most_common(10)),
        "by_site_top10": dict(by_site.most_common(10)),
        "largest_datasets_by_images_top25": largest_by_images,
        "largest_datasets_by_size_top25":   largest_by_size,
        "updated_range": {"first": updated_min, "last": updated_max},
    }

# -------------- Main ---------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True, help='GCS prefix. e.g., gs://nmfs_odp_pifsc/.../Fixed_Sites/')
    ap.add_argument("--out-dir", required=True, help="Local output folder (e.g., docs/datasets/optical/fixed_sites)")
    ap.add_argument("--group-depth", type=int, default=5, help="Depth under ROOT to group datasets (region/island/site/year/site_visit)")
    ap.add_argument("--max", type=int, default=0, help="Limit total media objects for quick tests (0 = all)")
    ap.add_argument("--per-dataset-max-files", type=int, default=500, help="Cap files listed per dataset detail JSON")
    ap.add_argument("--include-video", action="store_true", help="Include video assets")
    ap.add_argument("--token", default="google_default", help="gcsfs auth for fallback path")
    ap.add_argument("--use-gcs-sdk", action="store_true", default=True, help="Use google-cloud-storage fast listing (default: on)")
    ap.add_argument("--log-level", default="INFO", help="DEBUG, INFO, WARNING, ERROR")
    ap.add_argument("--log-file", default=None, help="Optional path to write a logfile")
    ap.add_argument("--no-summary", action="store_true", help="Do not write summary.json")
    args = ap.parse_args()

    setup_logger(args.log_level, args.log_file)

    t_start = time.time()
    root_norm, bucket, prefix = parse_gs(args.root)
    out_dir = Path(args.out_dir); items_dir = out_dir / "items"
    out_dir.mkdir(parents=True, exist_ok=True); items_dir.mkdir(parents=True, exist_ok=True)

    logging.info(f"Root: {root_norm}")
    logging.info(f"Output dir: {out_dir}")
    logging.info("Listing objects (fast path: google-cloud-storage SDK)...")

    # 1) List and filter media
    rows = []
    errors = 0
    try:
        if args.use_gcs_sdk:
            it = fast_list_gcs_sdk(bucket, prefix, include_video=args.include_video, max_objects=args.max)
        else:
            it = slow_list_gcsfs(bucket, prefix, include_video=args.include_video, max_objects=args.max, token=args.token)

        t_list = time.time()
        for i, rec in enumerate(it, 1):
            # rec: key,size,updated,etag,ext,modality
            rows.append({
                "uri": f"gs://{bucket}/{rec['key']}",
                "bucket": bucket,
                "key": rec["key"],
                "size": rec["size"],
                "updated": rec.get("updated"),
                "etag": rec.get("etag"),
                "ext": rec["ext"],
                "modality": rec["modality"],
            })
            if i % 5000 == 0:
                logging.info(f"  processed {i:,} media in {time.time()-t_list:.1f}s")
    except Exception as e:
        logging.error(f"Listing failed: {e}")
        sys.exit(2)

    scanned_objects = len(rows)
    if not rows:
        logging.warning("No media found. Check extensions or flags.")
        return

    df = pd.DataFrame(rows)
    base_parts = PurePosixPath(prefix).parts
    rel_parts = df["key"].apply(lambda k: PurePosixPath(k).parts[len(base_parts):])
    df["dataset_rel"] = rel_parts.apply(lambda parts: "/".join(parts[:args.group_depth]))
    df["dataset_gs"]  = df["dataset_rel"].apply(lambda rel: f"{root_norm}{rel}/")

    # 2) Aggregate to dataset cards
    groups = df.groupby("dataset_rel", as_index=False)
    agg = groups.agg(
        images=("modality", lambda s: int((s=="image").sum())),
        videos=("modality", lambda s: int((s=="video").sum())),
        total_size=("size", "sum"),
        first_updated=("updated", "min"),
        last_updated=("updated", "max"),
    )

    # 3) Pick a thumbnail (prefer jpeg/png/webp)
    thumb_map = {}
    for rel, g in groups:
        sub = g[g["modality"]=="image"]
        thumb_uri = ""
        if len(sub):
            for pref in THUMB_PREF:
                cand = sub[sub["ext"]==pref]
                if len(cand):
                    thumb_uri = cand.iloc[0]["uri"]; break
            if not thumb_uri:
                thumb_uri = sub.iloc[0]["uri"]
        thumb_map[rel] = thumb_uri

    # 4) Build cards
    def tags_from_rel(rel: str):
        parts = rel.split("/")
        tags = []
        # Fixed Sites structure: region/island/site/year/site_visit
        if len(parts) > 0: tags.append(parts[0])  # region
        if len(parts) > 1: tags.append(parts[1])  # island
        if len(parts) > 2: tags.append(parts[2])  # site
        if len(parts) > 3 and re.fullmatch(r"\d{4}", parts[3]): tags.append(parts[3])  # year
        if len(parts) > 4: tags.append(parts[4])  # site_visit
        return [t for t in tags if t]  # Preserve order for positional logic

    cards = []
    for _, r in agg.iterrows():
        rel = r["dataset_rel"]
        total_size_bytes = int(r["total_size"] or 0)
        
        # Create a more descriptive title from the site visit
        title_parts = rel.split("/")
        if len(title_parts) >= 5:
            site = title_parts[2]  # e.g., "OCC-GUA-015" 
            year = title_parts[3]  # e.g., "2022"
            site_visit = title_parts[4]  # e.g., "20220612_OCC-GUA-015_RA2201"
            title = f"{site} ({year})"
        else:
            title = rel.split("/")[-1]
            
        cards.append({
            "id": safe_id(rel),
            "title": title,
            "updated": r["last_updated"],
            "category": "optical-data",
            "thumbnail": thumb_map.get(rel, ""),
            "gs_prefix": f"{root_norm}{rel}/",
            "tags": tags_from_rel(rel),
            "size_bytes": total_size_bytes,
            "size_human": human_bytes(total_size_bytes),
            "counts": {
                "images": int(r["images"]),
                **({"videos": int(r["videos"])} if int(r["videos"])>0 else {})
            }
        })

    # 5) Write per-dataset details (bounded list) with HTTPS
    t_details = time.time()
    written_details = 0
    for rel, g in groups:
        did = safe_id(rel)
        g = g.sort_values("updated", ascending=True).head(args.per_dataset_max_files)
        files = [{
            "uri": f"gs://{bucket}/{row['key']}",
            "url": gs_to_https(f"gs://{bucket}/{row['key']}"),
            "size": int(row["size"]),
            "updated": row["updated"],
            "ext": row["ext"],
            "modality": row["modality"],
        } for _, row in g.iterrows()]

        # Build title same as card
        title_parts = rel.split("/")
        if len(title_parts) >= 5:
            site = title_parts[2]
            year = title_parts[3]
            detail_title = f"{site} ({year})"
        else:
            detail_title = rel.split("/")[-1]

        detail = {
            "id": did,
            "title": detail_title,
            "gs_prefix": f"{root_norm}{rel}/",
            "updated_first": str(g["updated"].min()) if len(g) else "",
            "updated_last":  str(g["updated"].max()) if len(g) else "",
            "counts": {
                "files_listed": len(files),
                "images": int((g["modality"]=="image").sum()),
                "videos": int((g["modality"]=="video").sum()),
            },
            "files": files
        }
        (Path(args.out_dir) / "items" / f"{did}.json").write_text(json.dumps(detail, indent=2))
        written_details += 1
        if written_details % 200 == 0:
            logging.info(f"  wrote {written_details:,} detail JSONs in {time.time()-t_details:.1f}s")

    # 6) Write card list + optional summary
    (Path(args.out_dir) / "index.json").write_text(json.dumps(cards, indent=2))
    duration_s = time.time() - t_start
    if not args.no_summary:
        summary = build_summary(cards, df, root_norm, scanned=scanned_objects, kept=len(df), duration_s=duration_s)
        (Path(args.out_dir) / "summary.json").write_text(json.dumps(summary, indent=2))

    # 7) Final logs
    logging.info(f"Media kept: {len(df):,} (scanned keys ≈ {scanned_objects:,})")
    logging.info(f"Wrote cards:    {len(cards):,} -> {Path(args.out_dir) / 'index.json'}")
    logging.info(f"Wrote details:  {written_details:,} -> {Path(args.out_dir) / 'items' / '<id>.json'} (cap {args.per_dataset_max_files})")
    if not args.no_summary:
        logging.info(f"Wrote summary: {Path(args.out_dir) / 'summary.json'}")
    logging.info(f"Total time: {duration_s:.2f}s | Size sum: {human_bytes(int(df['size'].sum()))}")

if __name__ == "__main__":
    main()