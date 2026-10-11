"""Construit les données de la vue 3D du massif du Mont-Blanc (dossier 3d/montblanc/) :

  relief.bin / relief.json   altitudes en mètres (uint16, petit-boutiste), Copernicus GLO-30 (30 m)
  sat-4k.jpg, sat-2k.jpg     image Sentinel-2 cloudless 2023 (EOX, CC BY-NC-SA 4.0), même emprise lat/lon
  peaks.json                 sommets étiquetés (position recalée sur le point culminant local du relief)

Usage : python3 scripts/build_3d.py   (télécharge ~80 Mo de relief et ~380 tuiles d'image, une seule fois)
"""
import io, os, json, math, time, urllib.request
import numpy as np
from PIL import Image

W, E, S, N = 6.72, 7.12, 45.74, 46.02
OUT = os.path.join(os.path.dirname(__file__), "..", "3d", "montblanc")
CACHE = os.path.join(os.path.dirname(__file__), "..", ".cache")
UA = {"User-Agent": "alpes-creneaux/1.0 (app perso de prévision montagne)"}
PEAKS = [("Mont Blanc", 45.8326, 6.8652), ("Aiguille du Midi", 45.8786, 6.8874), ("Grandes Jorasses", 45.8689, 6.9886),
         ("Aiguille Verte", 45.9347, 6.9694), ("Dent du Géant", 45.8622, 6.9517), ("Aiguille d'Argentière", 45.9583, 7.0217)]
TOWNS = [("Chamonix", 45.9237, 6.8694, 1035), ("Courmayeur", 45.7969, 6.9689, 1224)]


def get(url):
    for k in range(4):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120).read()
        except Exception:
            if k == 3:
                raise
            time.sleep(3 * (k + 1))


def dem():
    """2 × 2 mosaic of Copernicus 1° tiles (lat 47→45, lon 6→8), then crop to the box."""
    rows = []
    for lat in (46, 45):
        row = []
        for lon in (6, 7):
            name = f"Copernicus_DSM_COG_10_N{lat}_00_E00{lon}_00_DEM"
            path = os.path.join(CACHE, name + ".tif")
            if not os.path.exists(path):
                os.makedirs(CACHE, exist_ok=True)
                open(path, "wb").write(get(f"https://copernicus-dem-30m.s3.amazonaws.com/{name}/{name}.tif"))
            row.append(np.asarray(Image.open(path)))
        rows.append(np.concatenate(row, axis=1))
    a = np.concatenate(rows, axis=0)
    d = 1 / 3600
    return a[round((47 - N) / d):round((47 - S) / d), round((W - 6) / d):round((E - 6) / d)].astype(np.float32)


def sat(width):
    z = 14

    def xy(lon, lat):
        n = 2 ** z
        return (lon + 180) / 360 * n, (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n

    x0, y0 = xy(W, N)
    x1, y1 = xy(E, S)
    tx, ty = range(int(x0), int(x1) + 1), range(int(y0), int(y1) + 1)
    im = Image.new("RGB", (256 * len(tx), 256 * len(ty)))
    for i, x in enumerate(tx):
        for j, y in enumerate(ty):
            path = os.path.join(CACHE, f"s2c23_{z}_{x}_{y}.jpg")
            if not os.path.exists(path):
                open(path, "wb").write(get(f"https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/{z}/{y}/{x}.jpg"))
                time.sleep(0.05)
            im.paste(Image.open(path).convert("RGB"), (256 * i, 256 * j))
    src = np.asarray(im)
    h = round(width * (N - S) / ((E - W) * math.cos(math.radians((N + S) / 2))))
    lons = W + (np.arange(width) + .5) / width * (E - W)
    lats = N - (np.arange(h) + .5) / h * (N - S)
    X = np.array([(xy(lo, N)[0] - tx[0]) * 256 for lo in lons]).astype(int)
    Y = np.array([(xy(W, la)[1] - ty[0]) * 256 for la in lats]).astype(int)
    return Image.fromarray(src[np.clip(Y, 0, src.shape[0] - 1)][:, np.clip(X, 0, src.shape[1] - 1)])


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    h = dem()
    R, C = h.shape
    print("relief", h.shape, "max", h.max())
    peaks = []
    for name, la, lo in PEAKS:  # snap to the local maximum within ~300 m
        r, c = round((N - la) * 3600), round((lo - W) * 3600)
        win = h[r - 10:r + 10, c - 10:c + 10]
        rr, cc = np.unravel_index(win.argmax(), win.shape)
        peaks.append(dict(name=name, lat=round(N - (r - 10 + rr) / 3600, 5), lon=round(W + (c - 10 + cc) / 3600, 5), alt=int(round(win.max()))))
    peaks += [dict(name=n, lat=la, lon=lo, alt=a, town=True) for n, la, lo, a in TOWNS]
    TRUE = {"Mont Blanc": 4808, "Aiguille du Midi": 3842, "Grandes Jorasses": 4208, "Aiguille Verte": 4122, "Dent du Géant": 4013, "Aiguille d'Argentière": 3901}
    for p in peaks:  # labels show the published height; the 30 m relief rounds off the finest spires
        if p["name"] in TRUE:
            p["dem"], p["alt"] = p["alt"], TRUE[p["name"]]
    json.dump(peaks, open(os.path.join(OUT, "peaks.json"), "w"), ensure_ascii=False)
    # resample to 1024 columns (~30 m), store metres as uint16
    w = 1024
    hh = round(w * R / C)
    img = Image.fromarray(h).resize((w, hh), Image.BICUBIC)
    np.clip(np.asarray(img), 0, 65535).round().astype("<u2").tofile(os.path.join(OUT, "relief.bin"))
    json.dump(dict(w=w, h=hh, W=W, E=E, S=S, N=N), open(os.path.join(OUT, "relief.json"), "w"))
    s = sat(4096)
    s.save(os.path.join(OUT, "sat-4k.jpg"), quality=80)
    s.resize((2048, round(2048 * s.size[1] / s.size[0])), Image.LANCZOS).save(os.path.join(OUT, "sat-2k.jpg"), quality=82)
    print("ok", peaks)
