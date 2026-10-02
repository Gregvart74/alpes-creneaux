"""Construit l'historique de l'onglet Historique, un fichier par point :

  data/histo/<id>.json   météo jour par jour depuis HIST_START, par modèle (archives Open-Meteo)
  data/c2c/<id>.json     sorties Camptocamp autour du point (API publique, contenus CC BY-NC-ND :
                         on ne garde que date, conditions, activités, altitude, titre, auteur et lien)

Les agrégats suivent les règles de l'app (heures 4h–19h) :
  w    vent max au niveau du sommet (km/h)      pr   précipitation (mm)
  cm   nuages moyens moyens (%)                  cape max 11h–19h (J/kg)
  sat  heures T–Td < 2° entre 8h et 18h          pm   pression moyenne (hPa)
  izd  iso 0° max de la journée (m)              izn  iso 0° min de la nuit 0h–6h (m)
  sn   précipitation tombée quand l'iso 0° est sous le sommet (≈ neige au sommet, mm ≈ cm)

Usage : python3 scripts/build_history.py [id ...]   (sans argument : tous les points)
Camptocamp n'accepte pas les requêtes directes depuis le site : relancer ce script pour mettre à jour.
"""
import json, os, sys, time, math, urllib.request, urllib.parse, datetime as dt

HIST_START = dt.date(2023, 10, 1)  # Météo-France et ICON archivés depuis ~2023-10, ECMWF depuis 2024-02
SPOTS = [  # même liste que index.html
    dict(id="mont-blanc", lat=45.8326, lon=6.8652, alt=4808, lvl=600),
    dict(id="midi", lat=45.8786, lon=6.8874, alt=3842, lvl=600),
    dict(id="verte", lat=45.9347, lon=6.9694, alt=4122, lvl=600),
    dict(id="brevent", lat=45.9342, lon=6.8369, alt=2525, lvl=700),
    dict(id="chamonix", lat=45.9237, lon=6.8694, alt=1035, lvl=850, valley=True),
    dict(id="percee", lat=45.9553, lon=6.5556, alt=2750, lvl=700),
    dict(id="charvin", lat=45.8431, lon=6.4478, alt=2409, lvl=700),
    dict(id="clusaz", lat=45.9047, lon=6.4239, alt=1040, lvl=850, valley=True),
    dict(id="tournette", lat=45.8269, lon=6.2861, alt=2351, lvl=700),
    dict(id="jallouvre", lat=45.9989, lon=6.4606, alt=2408, lvl=700),
    dict(id="parmelan", lat=45.9253, lon=6.2919, alt=1832, lvl=850),
]
MODELS = {"mf": "meteofrance_seamless", "icon": "icon_seamless", "ecmwf": "ecmwf_ifs025"}
PL = [850, 700, 600, 500]
FIELDS = ["w", "pr", "cm", "cape", "sat", "pm", "izd", "izn", "sn"]
C2C_RADIUS = 3500        # m autour du point
C2C_BELOW = 700          # pour un sommet : garder les sorties montées à moins de 700 m sous le sommet
COND = ["excellent", "good", "average", "poor", "awful"]
UA = {"User-Agent": "alpes-creneaux/1.0 (app perso de prévision montagne)"}
ROOT = os.path.join(os.path.dirname(__file__), "..", "data")


def get(url):
    for attempt in range(4):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120))
        except Exception as e:
            if attempt == 3:
                raise
            time.sleep(5 * (attempt + 1))


def iso0(T, Z):
    if any(v is None for v in T + Z):
        return None
    if T[0] < 0:
        return max(0, Z[0] + T[0] / 0.0065)
    for k in range(len(PL) - 1):
        if T[k] >= 0 and T[k + 1] < 0:
            return Z[k] + T[k] * (Z[k + 1] - Z[k]) / (T[k] - T[k + 1])
    return Z[-1] + T[-1] / 0.0065


def weather(sp, end):
    hv = [f"wind_speed_{sp['lvl']}hPa", "precipitation", "cloud_cover_mid", "cape", "temperature_2m", "dew_point_2m", "pressure_msl"]
    hv += [f"{v}_{l}hPa" for l in PL for v in ("temperature", "geopotential_height")]
    days = {}
    a = HIST_START
    while a <= end:
        b = min(end, (a.replace(day=1) + dt.timedelta(days=95)).replace(day=1) - dt.timedelta(days=1))  # ~3 mois
        u = ("https://historical-forecast-api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode(dict(
            latitude=sp["lat"], longitude=sp["lon"], hourly=",".join(hv), models=",".join(MODELS.values()),
            start_date=a, end_date=b, timezone="Europe/Paris")))
        h = get(u)["hourly"]
        T = h["time"]
        byday = {}
        for i, t in enumerate(T):
            byday.setdefault(t[:10], []).append(i)
        for m, mid in MODELS.items():
            g = lambda v: h.get(f"{v}_{mid}", [None] * len(T))
            w, pr, cm, cape, t2, td, pm = (g(v) for v in hv[:7])
            iz = [iso0([g(f"temperature_{l}hPa")[i] for l in PL], [g(f"geopotential_height_{l}hPa")[i] for l in PL]) for i in range(len(T))]
            for d, idx in byday.items():
                hr = lambda i: int(T[i][11:13])
                ok = [i for i in idx if 4 <= hr(i) <= 19 and w[i] is not None]
                if len(ok) < 6:
                    continue
                aft = [cape[i] for i in ok if 11 <= hr(i) <= 19 and cape[i] is not None]
                izs = [iz[i] for i in idx if iz[i] is not None]
                izn = [iz[i] for i in idx if hr(i) <= 6 and iz[i] is not None]
                rec = [
                    round(max(w[i] for i in ok)),
                    round(sum(pr[i] or 0 for i in ok), 1),
                    round(sum(cm[i] or 0 for i in ok) / len(ok)),
                    round(max(aft)) if aft else None,
                    sum(1 for i in ok if 8 <= hr(i) <= 18 and t2[i] is not None and td[i] is not None and t2[i] - td[i] < 2),
                    round(sum(pm[i] or 0 for i in ok) / len(ok)),
                    round(max(izs)) if izs else None,
                    round(min(izn)) if izn else None,
                    round(sum(pr[i] or 0 for i in idx if iz[i] is not None and iz[i] < sp["alt"]), 1),
                ]
                days.setdefault(d, {})[m] = rec
        print(f"  météo {a} → {b}")
        a = b + dt.timedelta(days=1)
        time.sleep(0.5)
    keys = sorted(days)
    start = dt.date.fromisoformat(keys[0])
    n = (dt.date.fromisoformat(keys[-1]) - start).days + 1
    out = {m: [None] * n for m in MODELS}
    for k, v in days.items():
        i = (dt.date.fromisoformat(k) - start).days
        for m, rec in v.items():
            out[m][i] = rec
    return {"start": keys[0], "fields": FIELDS, "m": out}


def c2c(sp):
    R = 6378137
    x = math.radians(sp["lon"]) * R
    y = math.log(math.tan(math.pi / 4 + math.radians(sp["lat"]) / 2)) * R
    bbox = ",".join(str(round(v)) for v in (x - C2C_RADIUS, y - C2C_RADIUS, x + C2C_RADIUS, y + C2C_RADIUS))
    out, offset, total = [], 0, None
    while True:
        j = get(f"https://api.camptocamp.org/outings?bbox={bbox}&limit=100&offset={offset}&pl=fr")
        total = j.get("total")
        docs = j.get("documents", [])
        stop = False
        for d in docs:
            if not d.get("date_start") or d["date_start"] < HIST_START.isoformat():
                stop = True
                continue
            em = d.get("elevation_max")
            if not sp.get("valley") and em is not None and em < sp["alt"] - C2C_BELOW:
                continue
            loc = next((l for l in d.get("locales") or [] if l.get("lang") == "fr"), (d.get("locales") or [{}])[0])
            cr = d.get("condition_rating")
            out.append([d["document_id"], d["date_start"], d.get("date_end") or d["date_start"],
                        COND.index(cr) if cr in COND else None, ",".join(d.get("activities") or []), em,
                        (loc.get("title") or "")[:90], (d.get("author") or {}).get("name")])
        offset += len(docs)
        if stop or not docs or offset >= (total or 0):
            break
        time.sleep(1)
    print(f"  camptocamp : {len(out)} sorties retenues ({total} dans la zone, toutes dates)")
    return {"bbox": bbox, "fields": ["id", "date", "end", "cond", "act", "alt", "title", "author"],
            "cond": COND, "outings": sorted(out, key=lambda o: o[1])}


if __name__ == "__main__":
    want = set(sys.argv[1:])
    end = dt.date.today() - dt.timedelta(days=1)
    for sub in ("histo", "c2c"):
        os.makedirs(os.path.join(ROOT, sub), exist_ok=True)
    for sp in SPOTS:
        if want and sp["id"] not in want:
            continue
        print(sp["id"])
        h = weather(sp, end)
        h["built"] = dt.date.today().isoformat()
        json.dump(h, open(os.path.join(ROOT, "histo", sp["id"] + ".json"), "w"), separators=(",", ":"))
        c = c2c(sp)
        c["built"] = dt.date.today().isoformat()
        json.dump(c, open(os.path.join(ROOT, "c2c", sp["id"] + ".json"), "w"), separators=(",", ":"), ensure_ascii=False)
