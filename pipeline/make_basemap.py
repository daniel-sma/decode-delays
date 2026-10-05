"""Build the bundled satellite basemap: NASA Blue Marble (public domain) for the whole world,
reprojected from equirectangular to Web Mercator so it lines up with deck.gl's map view at any zoom.

The app draws this image under Esri World Imagery tiles. Where the tile host is reachable (local dev,
a normal deployment) the tiles win; where it isn't (sandboxed previews) the bundled image still gives
a satellite look.

Usage: python pipeline/make_basemap.py
"""

import io
import math
import urllib.request
from pathlib import Path

from PIL import Image, ImageEnhance

SRC = "https://raw.githubusercontent.com/vasturiano/three-globe/master/example/img/earth-blue-marble.jpg"
OUT = Path(__file__).resolve().parent.parent / "public" / "basemap" / "world.jpg"
# Web Mercator's full extent. Bounds must match BASEMAP_BOUNDS in src/components/FlightMap.tsx
MAX_LAT = 85.0511
WEST, EAST, SOUTH, NORTH = -180.0, 180.0, -MAX_LAT, MAX_LAT
WIDTH = 4096


def merc_y(lat):
    return math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def main():
    with urllib.request.urlopen(SRC, timeout=60) as r:
        src = Image.open(io.BytesIO(r.read())).convert("RGB")
    sw, sh = src.size
    # Crop the equirectangular source with a little margin, upsample once, then remap rows.
    x0 = max(0, int((WEST + 180) / 360 * sw) - 2)
    x1 = min(sw, int((EAST + 180) / 360 * sw) + 2)
    y0 = max(0, int((90 - NORTH) / 180 * sh) - 2)
    y1 = min(sh, int((90 - SOUTH) / 180 * sh) + 2)
    crop = src.crop((x0, y0, x1, y1))
    lon_w = (x0 / sw) * 360 - 180
    lon_e = (x1 / sw) * 360 - 180
    lat_n = 90 - (y0 / sh) * 180
    lat_s = 90 - (y1 / sh) * 180
    up = crop.resize((max(WIDTH, crop.width), crop.height * 2), Image.BICUBIC)

    ym_n, ym_s = merc_y(NORTH), merc_y(SOUTH)
    height = int(WIDTH * (ym_n - ym_s) / math.radians(EAST - WEST))
    out = Image.new("RGB", (WIDTH, height))
    px_out = out.load()
    px_up = up.load()
    uw, uh = up.size
    for j in range(height):
        lat = math.degrees(2 * math.atan(math.exp(ym_n - (j + 0.5) / height * (ym_n - ym_s))) - math.pi / 2)
        v = (lat_n - lat) / (lat_n - lat_s) * (uh - 1)
        vi = min(uh - 1, max(0, int(round(v))))
        for i in range(WIDTH):
            lon = WEST + (i + 0.5) / WIDTH * (EAST - WEST)
            u = (lon - lon_w) / (lon_e - lon_w) * (uw - 1)
            px_out[i, j] = px_up[min(uw - 1, max(0, int(round(u)))), vi]
    # Dim and desaturate slightly so data overlays read first, as on an operations map.
    out = ImageEnhance.Color(out).enhance(0.8)
    out = ImageEnhance.Brightness(out).enhance(0.72)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.save(OUT, quality=78, optimize=True, progressive=True)
    print(f"{OUT} {out.size} {OUT.stat().st_size / 1e3:.0f} KB")


if __name__ == "__main__":
    main()
