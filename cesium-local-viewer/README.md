# Cesium 3TZ Local Viewer

A self-contained Docker Compose app for viewing **Cesium 3D Tiles (`.3tz`)** files locally in your browser using [CesiumJS](https://cesium.com/platform/cesiumjs/).

![CesiumJS viewer](https://cesium.com/downloads/cesiumjs/releases/latest/Build/CesiumUnminified/Assets/Images/ion-credit.png)

---

## Quick Start

### 1 — Prerequisites
- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/) installed.

### 2 — Add your `.3tz` files
Copy your Cesium 3D Tiles archive files into the `data/` directory:

```
cesium-local-viewer/
└── data/
    ├── my-coral-reef.3tz
    ├── site-alpha.3tz
    └── ...
```

### 3 — Start the viewer
```bash
cd cesium-local-viewer
docker compose up
```

Open your browser at **http://localhost:8080**

### 4 — Stop the viewer
```bash
docker compose down
```

---

## What you get

| Feature | Detail |
|---------|--------|
| **Auto-discovery** | All `.3tz` files in `data/` are listed in the sidebar automatically |
| **One-click load** | Click **Load** next to any file to add it to the globe |
| **Fly-to** | Click **Fly** to zoom the camera directly to a loaded tileset |
| **Layer manager** | Loaded layers shown in the sidebar; click **✕** to remove |
| **Custom URL** | Load any remote or local `.3tz` / `tileset.json` by URL |
| **Ion token** | Optionally paste your [Cesium ion token](https://ion.cesium.com) for ion-hosted assets |
| **Default imagery** | OpenStreetMap basemap — no token required out of the box |
| **Range requests** | Nginx is configured to serve `.3tz` archives with full `Accept-Ranges: bytes` support, required by CesiumJS to stream data within the archive |
| **Click-to-Photo** | Click any point on a loaded reef model to instantly see the original camera photos that covered that spot |

---

## Click-to-Photo Feature

When a `.3tz` tileset has a companion **`cameras.json`** sidecar file, clicking anywhere on the 3D model shows a panel with the nearest original camera photos.

### cameras.json format

Place a file named `<dataset-name>.cameras.json` in the same `data/` folder as your `.3tz` file.

**Example:** if your archive is `my-reef.3tz`, create `my-reef.cameras.json`:

```json
{
  "image_base_url": "https://your-bucket.example.com/images/my-reef",
  "thumbnail_base_url": "https://your-bucket.example.com/thumbs/my-reef",
  "cameras": [
    { "name": "IMG_0001", "lon": -157.1234, "lat": 21.4567, "height": -14.5 },
    { "name": "IMG_0002", "lon": -157.1238, "lat": 21.4569, "height": -14.2 }
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `image_base_url` | ✅ | Base URL for full-resolution images. Each image is fetched as `<base_url>/<name>.JPG` |
| `thumbnail_base_url` | ✗ | Base URL for smaller preview images (falls back to `image_base_url` if omitted) |
| `cameras[].name` | ✅ | Image filename stem (without extension), or full filename with extension |
| `cameras[].lon` | ✅ | Longitude in decimal degrees (WGS 84) |
| `cameras[].lat` | ✅ | Latitude in decimal degrees (WGS 84) |
| `cameras[].height` | ✗ | Ellipsoidal height in metres (0 if omitted) |

> **Note:** The `lon`/`lat`/`height` values must be in the same geographic reference frame (WGS 84) as your `.3tz` tileset.

### Exporting camera positions from Metashape

1. Open your Agisoft Metashape project.
2. Go to **File → Export → Export Cameras…**
3. Set the coordinate system to **WGS 84** (Geographic).
4. Export as **CSV** or **JSON** (Metashape 2.x).
5. Convert the export to the `cameras.json` format above.

A minimal Python conversion script for a Metashape CSV export:

```python
import csv, json, pathlib

# Metashape CSV columns: Label, X (lon), Y (lat), Z (height), …
rows = list(csv.DictReader(open("cameras_export.csv")))
out = {
    "image_base_url": "https://your-bucket/images/my-reef",
    "cameras": [
        {"name": r["Label"], "lon": float(r["X"]), "lat": float(r["Y"]), "height": float(r["Z"])}
        for r in rows
    ]
}
pathlib.Path("my-reef.cameras.json").write_text(json.dumps(out, indent=2))
```

### How it works

1. When you click **Load** for a `.3tz` file, the viewer automatically tries to fetch `<stem>.cameras.json` from `/data/`.
2. If found, camera positions are stored as 3D Cartesian coordinates.
3. When you click anywhere on the model, the viewer computes the 3D distance from the clicked point to every camera position and displays the 6 nearest photos in a slide-up panel.
4. Click any thumbnail to open the full-resolution image in a lightbox viewer (keyboard: `←` / `→` to navigate, `Esc` to close).

---

## Port / volume configuration

Edit `docker-compose.yml` to change the host port (default `8080`) or point to a different data directory:

```yaml
ports:
  - "9000:80"          # change host port
volumes:
  - /path/to/my/data:/usr/share/nginx/data:ro   # custom data path
```

---

## About `.3tz` files

`.3tz` is the [OGC 3D Tiles archive format](https://docs.ogc.org/cs/22-025r4/22-025r4.html) — a single ZIP-like container that packages an entire 3D Tiles dataset. CesiumJS ≥ 1.87 loads them natively over HTTP using byte-range requests.

Create `.3tz` files with:
- [Cesium ion](https://ion.cesium.com) (convert & host)
- [3D Tiles Tools](https://github.com/CesiumGS/3d-tiles-tools) (`npx 3d-tiles-tools archive`)

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| No files listed | Make sure `.3tz` files are in the `data/` folder and click **↻ Refresh** |
| "Failed to load" error | Check the browser console; the file may be corrupt or not a valid 3D Tiles archive |
| Blank globe | Provide a Cesium ion token in the sidebar for ion imagery/terrain |
| Port conflict | Change `8080:80` to another host port in `docker-compose.yml` |

---

## License

See [LICENSE.md](../LICENSE.md) in the repository root.
