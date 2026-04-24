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
