"""Calage des seuils sur les sorties Camptocamp (data/histo + data/c2c, voir build_history.py).

Pour chaque critère, taux de sorties relatif à la normale du même sommet et du même mois
(1.00 = fréquentation habituelle), pour neutraliser la saison et la popularité du sommet.
Puis comparaison de jeux de seuils : un bon jeu sépare nettement Bon > Limite (~1) > Non.

Usage : python3 scripts/calibrate.py
"""
import json, os, datetime as dt, collections

ROOT = os.path.join(os.path.dirname(__file__), "..", "data")
SUMMITS = ["mont-blanc", "midi", "verte", "percee", "charvin", "tournette", "jallouvre", "parmelan"]  # hors vallées et falaises du Brévent

rows = []  # (spot, month, [daily records per model], outings)
for sp in SUMMITS:
    h = json.load(open(os.path.join(ROOT, "histo", sp + ".json")))
    c = json.load(open(os.path.join(ROOT, "c2c", sp + ".json")))
    cnt = collections.Counter(o[1] for o in c["outings"])
    s0 = dt.date.fromisoformat(h["start"])
    for k in range(len(next(iter(h["m"].values())))):
        rs = [h["m"][m][k] for m in h["m"] if h["m"][m][k]]
        if rs:
            d = (s0 + dt.timedelta(days=k)).isoformat()
            rows.append((sp, int(d[5:7]), rs, cnt.get(d, 0)))

base = collections.defaultdict(lambda: [0, 0])
for sp, m, rs, n in rows:
    base[(sp, m)][0] += n
    base[(sp, m)][1] += 1
expected = lambda sp, m: base[(sp, m)][0] / base[(sp, m)][1]


def rate(sel):
    o = sum(r[3] for r in sel)
    e = sum(expected(r[0], r[1]) for r in sel)
    return (o / e if e else float("nan")), len(sel)


def bins(name, f, edges):
    print(f"\n{name}")
    for lo, hi in zip(edges, edges[1:]):
        x, n = rate([r for r in rows if lo <= f(r[2]) < hi])
        print(f"  {lo:>6} – {hi:<6} {x:5.2f}  ({n} jours)")


bins("Vent max au sommet (km/h)", lambda rs: max(r[0] for r in rs), [0, 20, 30, 40, 50, 60, 70, 80, 100, 999])
bins("Précipitations max (mm, 4h–19h)", lambda rs: max(r[1] for r in rs), [0, 0.2, 0.5, 1, 2, 5, 10, 999])
bins("Nuages moyens max (%)", lambda rs: max(r[2] for r in rs), [0, 40, 60, 80, 90, 101])
bins("CAPE max (J/kg)", lambda rs: max((r[3] or 0) for r in rs), [0, 200, 500, 1000, 1500, 2000, 9999])


def verdict(th):
    def one(r):
        return max(0 if r[0] <= th["ok"] else 1 if r[0] <= th["max"] else 2,
                   2 if r[1] >= th["rain2"] else 1 if r[1] >= th["rain1"] else 0,
                   1 if r[2] >= th["cloud"] else 0,
                   0 if r[3] is None else 2 if r[3] >= 2 * th["cape"] else 1 if r[3] >= th["cape"] else 0)
    return one


def compare(name, th):
    one = verdict(th)
    o, e, nd = [0] * 3, [0] * 3, [0] * 3
    for sp, m, rs, n in rows:
        v = max(one(r) for r in rs)
        o[v] += n
        e[v] += expected(sp, m)
        nd[v] += 1
    print(f"{name:34}" + "   ".join(f"{l} {o[v] / e[v]:.2f} ({100 * nd[v] / len(rows):.0f} % des jours)" for v, l in enumerate(["Bon", "Limite", "Non"])))


print("\nJeux de seuils (taux relatif par verdict)")
compare("départ (copié de Chaltén)", dict(ok=40, max=60, rain1=0.2, rain2=1, cloud=80, cape=1000))
compare("calé (app actuelle)", dict(ok=60, max=80, rain1=1, rain2=5, cloud=60, cape=1500))
