// Historique tab, seen from the climber's side: the coming days as slots (créneaux); click one and the app lists the routes
// (courses) that Camptocamp outings reported in good condition in comparable past situations (same season, similar
// weather in the days before, similar freezing level). Below: the 3-year calendar, the detail of any day and how the
// verdicts match reported conditions. Loaded on demand by index.html: mount(el, ctx).

const JOURS = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];
const MOIS = ["jan", "fév", "mar", "avr", "mai", "juin", "juil", "août", "sep", "oct", "nov", "déc"];
const LBL = ["Bon", "Limite", "Non"], CLS = ["go", "warn", "no"];
const COND_FR = ["excellentes", "bonnes", "moyennes", "mauvaises", "exécrables"];
const COND_CLS = ["go", "go", "warn", "no", "no"];
const ACT_FR = {skitouring: "ski de rando", snow_ice_mixed: "neige, glace, mixte", mountain_climbing: "alpinisme rocheux", rock_climbing: "escalade",
  ice_climbing: "cascade de glace", hiking: "randonnée", snowshoeing: "raquettes", paragliding: "parapente", mountain_biking: "VTT",
  via_ferrata: "via ferrata", slacklining: "slackline"};
const ACT_ORDER = ["snow_ice_mixed", "mountain_climbing", "skitouring", "ice_climbing", "rock_climbing", "hiking", "snowshoeing", "via_ferrata", "paragliding", "mountain_biking", "slacklining"];
const TZ = "Europe/Paris";
const PL = [850, 700, 600, 500];
const N_ANALOG = 15;       // past days kept as "comparable situations"
const SEASON_WINDOW = 45;  // ± days in the year

const addDays = (k, n) => { const d = new Date(k + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fmtDay = k => { const d = new Date(k + "T12:00:00Z"); return `${JOURS[d.getUTCDay()]} ${d.getUTCDate()} ${MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const fmtShort = k => { const d = new Date(k + "T12:00:00Z"); return `${JOURS[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`; };
const r0 = v => v == null ? "–" : Math.round(v);
const today = () => new Date(new Date().toLocaleString("en-US", {timeZone: TZ})).toISOString().slice(0, 10);
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
// One key per route: same title whatever the case, spacing or a trailing "(but)"
const routeKey = t => (t || "").toLowerCase().replace(/\s*\((but|échec|echec|demi-tour|renoncement)\)\s*$/, "").replace(/\s+/g, " ").trim();

function iso0(T, Z) {
  if (T.some(v => v == null) || Z.some(v => v == null)) return null;
  if (T[0] < 0) return Math.max(0, Z[0] + T[0] / 0.0065);
  for (let k = 0; k < PL.length - 1; k++) if (T[k] >= 0 && T[k + 1] < 0) return Z[k] + T[k] * (Z[k + 1] - Z[k]) / (T[k] - T[k + 1]);
  return Z[PL.length - 1] + T[PL.length - 1] / 0.0065;
}
// Same daily summary as scripts/build_history.py, from hourly arrays: get(var) → array
function summarize(time, get, sp) {
  const byDay = {};
  time.forEach((t, i) => (byDay[t.slice(0, 10)] = byDay[t.slice(0, 10)] || []).push(i));
  const w = get(`wind_speed_${sp.lvl}hPa`), pr = get("precipitation"), cm = get("cloud_cover_mid"), cape = get("cape"),
    t2 = get("temperature_2m"), td = get("dew_point_2m"), pm = get("pressure_msl");
  const iz = time.map((_, i) => iso0(PL.map(l => get(`temperature_${l}hPa`)[i]), PL.map(l => get(`geopotential_height_${l}hPa`)[i])));
  const out = {};
  for (const k in byDay) {
    const idx = byDay[k], hr = i => +time[i].slice(11, 13), ok = idx.filter(i => hr(i) >= 4 && hr(i) <= 19 && w[i] != null);
    if (ok.length < 6) continue;
    const aft = ok.filter(i => hr(i) >= 11 && cape[i] != null).map(i => cape[i]), izs = idx.map(i => iz[i]).filter(v => v != null),
      izn = idx.filter(i => hr(i) <= 6).map(i => iz[i]).filter(v => v != null);
    out[k] = {w: Math.max(...ok.map(i => w[i])), pr: ok.reduce((a, i) => a + (pr[i] || 0), 0), cm: ok.reduce((a, i) => a + (cm[i] || 0), 0) / ok.length,
      cape: aft.length ? Math.max(...aft) : null, sat: ok.filter(i => hr(i) >= 8 && hr(i) <= 18 && t2[i] != null && td[i] != null && t2[i] - td[i] < 2).length,
      pm: ok.reduce((a, i) => a + (pm[i] || 0), 0) / ok.length, izd: izs.length ? Math.max(...izs) : null, izn: izn.length ? Math.min(...izn) : null,
      sn: idx.reduce((a, i) => a + (iz[i] != null && iz[i] < sp.alt ? (pr[i] || 0) : 0), 0)};
  }
  return out;
}

export async function mount(el, ctx) {
  let sp, days, outs, built, byDay, sel, year;

  async function load() {
    sp = ctx.spot();
    el.innerHTML = `<p class="h-load">Chargement de l'historique de ${sp.name}…</p>`;
    const [h, c] = await Promise.all([fetch(`data/histo/${sp.id}.json`).then(r => r.json()), fetch(`data/c2c/${sp.id}.json`).then(r => r.json())]);
    built = h.built;
    days = {};
    const F = h.fields;
    for (const m in h.m) h.m[m].forEach((rec, i) => { if (!rec) return; const k = addDays(h.start, i), o = {}; F.forEach((f, j) => o[f] = rec[j]); (days[k] = days[k] || {})[m] = o; });
    // Recent days since the build, then the forecast: Open-Meteo forecast API with past days
    try {
      const vars = [`wind_speed_${sp.lvl}hPa`, "precipitation", "cloud_cover_mid", "cape", "temperature_2m", "dew_point_2m", "pressure_msl",
        ...PL.flatMap(l => [`temperature_${l}hPa`, `geopotential_height_${l}hPa`])];
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${sp.lat}&longitude=${sp.lon}&hourly=${vars.join(",")}&models=${ctx.models.map(m => ctx.modelId(m)).join(",")}&past_days=14&forecast_days=10&timezone=${encodeURIComponent(TZ)}`;
      const j = await (await fetch(u)).json(), hh = j.hourly, t0 = today();
      for (const m of ctx.models) {
        const s = summarize(hh.time, v => hh[`${v}_${ctx.modelId(m)}`] || hh.time.map(() => null), sp);
        for (const k in s) if (k > built || k >= t0) (days[k] = days[k] || {})[m] = Object.assign(s[k], k >= t0 ? {fc: 1} : {});
      }
    } catch (e) { /* offline: archive only */ }
    outs = c.outings.map(o => ({id: o[0], date: o[1], end: o[2], cond: o[3], act: o[4], alt: o[5], title: (o[6] || "").trim(), author: o[7]}));
    byDay = {}; outs.forEach(o => (byDay[o.date] = byDay[o.date] || []).push(o));
    // Start on the first good slot to come, else today
    const t0 = today(), slots = upcoming();
    const first = slots.find(k => (verdict(k) || {}).v === 0) || slots[0] || t0;
    sel = sel && days[sel] ? sel : first;
    year = +sel.slice(0, 4);
    draw();
  }

  const upcoming = () => { const t0 = today(); return Object.keys(days).filter(k => k >= t0).sort().slice(0, 10); };

  // ---------- verdict with the app's current rules ----------
  function verdict(k) {
    const d = days[k]; if (!d) return null;
    const th = ctx.th();
    const one = s => Math.max(s.w <= th.ok ? 0 : s.w <= th.max ? 1 : 2, s.pr >= th.rain2 ? 2 : s.pr >= th.rain1 ? 1 : 0, s.cm >= th.cloud ? 1 : 0,
      s.cape == null ? 0 : s.cape >= 2 * th.cape ? 2 : s.cape >= th.cape ? 1 : 0);
    const ms = ctx.models.filter(m => d[m]);
    return ms.length ? {v: Math.max(...ms.map(m => one(d[m]))), n: ms.length} : null;
  }
  function reason(k) {
    const d = days[k], th = ctx.th(); if (!d) return "";
    const ms = ctx.models.filter(m => d[m]).map(m => d[m]), mx = f => Math.max(...ms.map(s => s[f] == null ? -1 : s[f]));
    const w = mx("w"), pr = mx("pr"), cm = mx("cm"), cape = mx("cape");
    if (cape >= th.cape) return `orages (CAPE ${r0(cape)})`;
    if (w > th.ok) return `vent ${r0(w)} km/h`;
    if (pr >= th.rain1) return `précip. ${Math.round(pr * 10) / 10} mm`;
    if (cm >= th.cloud) return "couvert";
    return "calme, sans pluie";
  }
  // worst-case daily value across models (max) or best (min)
  const agg = (k, f, mode = "max") => { const d = days[k]; if (!d) return null; const v = ctx.models.map(m => d[m] && d[m][f]).filter(x => x != null); return v.length ? (mode === "max" ? Math.max(...v) : Math.min(...v)) : null; };

  // ---------- the 7 days before ----------
  function before(k) {
    const prev = [-7, -6, -5, -4, -3, -2, -1].map(n => { const kk = addDays(k, n); return {k: kk, ok: !!days[kk], sn: agg(kk, "sn"), w: agg(kk, "w"), pr: agg(kk, "pr"), izd: agg(kk, "izd"), izn: agg(kk, "izn", "min"), cape: agg(kk, "cape")}; });
    const ok = prev.filter(p => p.ok); if (ok.length < 4) return null;
    const l3 = prev.slice(4).filter(p => p.ok), sum = (a, f) => a.reduce((s, p) => s + (p[f] || 0), 0);
    let dry = 0; for (let n = 1; n <= 14; n++) { const v = agg(addDays(k, -n), "pr"); if (v == null || v >= 0.5) break; dry++; }
    const f = {sn7: sum(ok, "sn"), sn3: sum(l3, "sn"), w3: Math.max(0, ...l3.map(p => p.w || 0)), noRegel: l3.filter(p => p.izn != null && p.izn > sp.alt).length,
      warm3: Math.max(0, ...l3.map(p => p.izd || 0)), dry, izd: agg(k, "izd"), izn: agg(k, "izn", "min")};
    const high = !ctx.isValley(sp), read = [];
    if (f.sn3 >= 15 && high) read.push({c: "warn", t: `Neige fraîche juste avant (≈ ${r0(f.sn3)} cm au sommet sur 3 jours) : traces à faire, rochers enneigés, risque d'avalanche accru.`});
    else if (f.sn7 >= 30 && high) read.push({c: "warn", t: `Gros apport de neige dans la semaine (≈ ${r0(f.sn7)} cm au sommet).`});
    // the no-refreeze warning only matters with snow or ice: glaciers, snowy season, or recent snow
    const snowy = sp.alt >= 3000 || [11, 12, 1, 2, 3, 4, 5].includes(+k.slice(5, 7)) || f.sn7 >= 5;
    if (f.noRegel >= 2 && high && snowy) read.push({c: "warn", t: `${f.noRegel} nuits sans regel au sommet sur les 3 dernières : neige pourrie, ponts de neige fragiles, chutes de pierres.`});
    else if (f.sn7 >= 10 && f.warm3 > sp.alt + 500 && high) read.push({c: "warn", t: `Redoux après la neige (0 °C jusqu'à ${r0(f.warm3)} m) : purges et coulées probables.`});
    if (f.w3 >= 70) read.push({c: "warn", t: `Vent fort juste avant (${r0(f.w3)} km/h au sommet) : neige soufflée, plaques à vent.`});
    if (f.dry >= 5) read.push({c: "go", t: `${f.dry} jours sans précipitation : rocher sec, traces faites.`});
    if (f.izn != null && high && snowy && f.izn < sp.alt - 300 && f.noRegel === 0) read.push({c: "go", t: `Regel nocturne franc (0 °C la nuit vers ${r0(f.izn)} m) : neige portante le matin, goulottes et ponts de neige tenus.`});
    if (!read.length) read.push({c: "", t: "Rien de marquant dans les jours d'avant."});
    return {prev, f, read};
  }

  // ---------- comparable past situations (days with outings) ----------
  // Snow of the last 7 and 3 days, wind and refreeze of the last 3, dry spell, and the freezing level of the day itself
  const vec = f => [f.sn7 / 40, f.sn3 / 20, f.w3 / 100, Math.min(f.noRegel, 3) / 3, Math.min(f.dry, 10) / 10, (f.izd == null ? 3000 : f.izd) / 4000];
  const doy = s => (Date.UTC(2001, +s.slice(5, 7) - 1, +s.slice(8, 10)) - Date.UTC(2001, 0, 1)) / 864e5;
  const beforeCache = {};
  const beforeC = d => (d in beforeCache ? beforeCache[d] : (beforeCache[d] = before(d)));
  function analogs(k, n = N_ANALOG) {
    const b = before(k); if (!b) return [];
    const x = vec(b.f), res = [], t0 = today();
    for (const d in byDay) {
      if (d >= t0 || d >= addDays(k, -1)) continue;
      const dd = Math.abs(doy(d) - doy(k)); if (Math.min(dd, 365 - dd) > SEASON_WINDOW) continue;
      const be = beforeC(d); if (!be) continue;
      const y = vec(be.f);
      res.push({d, dist: Math.hypot(...x.map((v, i) => v - y[i]))});
    }
    return res.sort((a, b) => a.dist - b.dist).slice(0, n);
  }

  // ---------- routes likely in condition for a slot ----------
  // Each outing of a comparable day votes for its route: weight = closeness of the situation × reported condition
  // (excellent 1, good 0.8, not rated 0.35, average 0.2, poor/awful 0). Routes are ranked by the sum of votes.
  function suggest(k) {
    const an = analogs(k); if (!an.length) return null;
    const routes = {}, condW = [1, 0.8, 0.2, 0, 0];
    let nOut = 0;
    for (const a of an) {
      const close = 1 / (1 + 3 * a.dist);
      for (const o of byDay[a.d] || []) {
        nOut++;
        const key = routeKey(o.title); if (!key) continue;
        const r = routes[key] = routes[key] || {key, title: o.title, score: 0, n: 0, good: 0, rated: 0, last: null, lastGood: null, act: o.act, alt: o.alt};
        r.score += close * (o.cond == null ? 0.35 : condW[o.cond]);
        r.n++;
        if (o.cond != null) { r.rated++; if (o.cond <= 1) r.good++; }
        if (!r.last || o.date > r.last.date) r.last = o;
        if (o.cond != null && o.cond <= 1 && (!r.lastGood || o.date > r.lastGood.date)) r.lastGood = o;
        if (o.alt && (!r.alt || o.alt > r.alt)) r.alt = o.alt;
      }
    }
    const list = Object.values(routes).filter(r => r.score > 0 && (r.good >= 1 || r.rated === 0)).sort((a, b) => b.score - a.score);
    return {an, nOut, list};
  }

  // ---------- how verdicts match reported conditions ----------
  // Two signals: outings per day (people go out when it's good) and share of good/excellent reported conditions
  function scorecard() {
    const s = [0, 1, 2].map(() => ({days: 0, outs: 0, n: 0, good: 0})), t0 = today();
    for (const k in days) { if (k >= t0) continue; const v = verdict(k); if (v) s[v.v].days++; }
    for (const o of outs) { const v = verdict(o.date); if (!v) continue; s[v.v].outs++; if (o.cond == null) continue; s[v.v].n++; if (o.cond <= 1) s[v.v].good++; }
    return s;
  }

  // ---------- UI ----------
  function draw() {
    const years = [...new Set(Object.keys(days).map(k => +k.slice(0, 4)))].sort((a, b) => b - a);
    const sc = scorecard();
    el.innerHTML = `
      <section class="panel">
        <div class="h-head"><h2>Créneaux à venir : ${sp.name}</h2></div>
        <p class="h-small h-intro">Choisissez un jour : l'app retrouve les situations passées qui lui ressemblent et liste les courses que les sorties Camptocamp y ont trouvées en bonnes conditions.</p>
        <div class="h-slots" id="h-slots"></div>
      </section>
      <section class="panel" id="h-day"></section>
      <section class="panel">
        <div class="h-head"><h2>Trois ans de recul</h2><select id="h-year" aria-label="Année">${years.map(y => `<option>${y}</option>`).join("")}</select></div>
        <div class="h-cal" id="h-cal"></div>
        <p class="h-legend"><i class="sw go"></i>Bon <i class="sw warn"></i>Limite <i class="sw no"></i>Non (règles actuelles) · <b class="dot go">●</b><b class="dot warn">●</b><b class="dot no">●</b> sorties Camptocamp (couleur = conditions rapportées) · cadre = prévision</p>
        <p class="h-small">Cliquez un jour passé pour voir sa météo, les jours d'avant et les sorties faites ce jour-là.</p>
      </section>
      <section class="panel">
        <details class="fold"><summary><h2>Les verdicts collent-ils au terrain ?</h2></summary>
        <div class="h-score">${sc.map((s, v) => `<div><span class="h-badge ${CLS[v]}">${LBL[v]}</span><b>${s.days ? (10 * s.outs / s.days).toFixed(1) : "–"}</b><small>sorties pour 10 jours (${s.days} jours, ${s.outs} sorties)</small><small>${s.n ? Math.round(100 * s.good / s.n) + " % en conditions bonnes ou excellentes" : ""}</small></div>`).join("")}</div>
        <p class="h-small">Sorties Camptocamp ${ctx.isValley(sp) ? "autour du point" : `montées au-dessus de ${sp.alt - 700} m`} depuis octobre 2023, classées selon le verdict que l'app aurait donné ce jour-là. Le bon signe : beaucoup plus de sorties les jours « Bon » que les jours « Non ». La part de bonnes conditions reste haute partout : on sort surtout quand c'est beau et on note souvent bien.</p>
        </details>
      </section>
      <p class="h-note">Météo : archives de prévisions Open-Meteo (Météo-France et ICON depuis octobre 2023, ECMWF depuis février 2024), mises à jour le ${built} puis complétées en direct. Neige au sommet estimée d'après les précipitations quand le 0 °C est sous le sommet. Sorties : <a href="https://www.camptocamp.org" target="_blank" rel="noopener">camptocamp.org</a>, contenus de leurs auteurs sous licence CC BY-NC-ND.</p>`;
    const $ = id => el.querySelector("#" + id);
    $("h-year").value = year;
    $("h-year").onchange = e => { year = +e.target.value; drawCal(); };
    drawSlots(); drawCal(); drawDay();
  }

  function drawSlots() {
    const box = el.querySelector("#h-slots"), ks = upcoming();
    if (!ks.length) { box.innerHTML = `<p class="h-read">Prévision indisponible (hors ligne ?) : seules les archives sont affichées.</p>`; return; }
    box.innerHTML = ks.map(k => { const v = verdict(k); if (!v) return ""; const b = beforeC(k), warn = b && b.read.some(x => x.c === "warn");
      return `<button class="day h-slot ${CLS[v.v]}" data-k="${k}" aria-pressed="${k === sel}"><b>${fmtShort(k)}</b><span class="v">${LBL[v.v]}</span><small class="why">${reason(k)}</small>${warn ? `<small class="hum">jours d'avant ⚠</small>` : ""}</button>`; }).join("");
    box.querySelectorAll("button[data-k]").forEach(b => b.onclick = () => go(b.dataset.k, false));
  }

  function drawCal() {
    const cal = el.querySelector("#h-cal"); let html = "";
    for (let m = 0; m < 12; m++) {
      const n = new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
      html += `<div class="h-row"><span class="h-m">${MOIS[m]}</span>`;
      for (let d = 1; d <= 31; d++) {
        if (d > n) { html += `<span class="h-c empty"></span>`; continue; }
        const k = `${year}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`, v = verdict(k), os = byDay[k] || [];
        const cs = os.map(o => o.cond).filter(c => c != null), mean = cs.length ? cs.reduce((a, b) => a + b, 0) / cs.length : null;
        const dot = os.length ? `<b class="dot ${mean == null ? "" : mean <= 1.4 ? "go" : mean <= 2.4 ? "warn" : "no"}">●</b>` : "";
        const fc = Object.values(days[k] || {}).some(x => x.fc) ? " fc" : "";
        html += `<button class="h-c ${v ? CLS[v.v] : "none"}${fc}${k === sel ? " sel" : ""}" data-k="${k}" title="${fmtDay(k)}${v ? " · " + LBL[v.v] : ""}${os.length ? ` · ${os.length} sortie${os.length > 1 ? "s" : ""}` : ""}">${dot}</button>`;
      }
      html += `</div>`;
    }
    cal.innerHTML = html;
    cal.querySelectorAll("button[data-k]").forEach(b => b.onclick = () => go(b.dataset.k, true));
  }
  function go(k, scroll) {
    sel = k; if (+k.slice(0, 4) !== year) { year = +k.slice(0, 4); el.querySelector("#h-year").value = year; }
    drawSlots(); drawCal(); drawDay();
    if (scroll) el.querySelector("#h-day").scrollIntoView({behavior: "smooth", block: "start"});
  }

  function beforeHtml(b) {
    const row = (lbl, f) => `<tr><th>${lbl}</th>${b.prev.map(p => `<td>${p.ok ? f(p) : "–"}</td>`).join("")}</tr>`;
    const hi = !ctx.isValley(sp);
    return `<div class="h-scroll"><table class="h-before"><thead><tr><th></th>${b.prev.map((p, i) => `<th title="${fmtDay(p.k)}">J−${7 - i}</th>`).join("")}</tr></thead><tbody>
      ${hi ? row("Neige sommet (cm)", p => r0(p.sn)) : ""}${row("Vent sommet", p => r0(p.w))}${row("Précip. (mm)", p => r0(p.pr))}
      ${row("0 °C jour (m)", p => p.izd ? (p.izd / 1000).toFixed(1) + "k" : "–")}${row("0 °C nuit (m)", p => p.izn ? `<span class="${hi && p.izn > sp.alt ? "hum" : ""}">${(p.izn / 1000).toFixed(1)}k</span>` : "–")}</tbody></table></div>`;
  }
  const acts = a => (a || "").split(",").filter(Boolean).map(x => ACT_FR[x] || x).join(", ");
  const outHtml = o => `<li><span class="h-ev ${o.cond == null ? "" : COND_CLS[o.cond]}">${o.cond == null ? "conditions non notées" : "conditions " + COND_FR[o.cond]}</span> <a href="https://www.camptocamp.org/outings/${o.id}" target="_blank" rel="noopener">${esc(o.title) || "Sortie"} ↗</a>
    <small>${acts(o.act)}${o.alt ? ` · ${o.alt} m` : ""}${o.end && o.end !== o.date ? ` · jusqu'au ${fmtDay(o.end)}` : ""}${o.author ? ` · ${esc(o.author)}` : ""}</small></li>`;

  // Routes grouped by activity, best first
  function coursesHtml(k, sg) {
    if (!sg) return `<p class="h-read">Pas assez de recul météo pour comparer ce jour à des situations passées.</p>`;
    if (!sg.list.length) return `<p class="h-read">Aucune course trouvée en bonnes conditions dans les ${sg.an.length} situations passées les plus proches (${sg.nOut} sorties).</p>`;
    const groups = {};
    sg.list.forEach(r => { const a = (r.act || "").split(",").filter(Boolean)[0] || "autre"; (groups[a] = groups[a] || []).push(r); });
    // activities in the order of their best route (lists are already sorted), fixed order only to break ties
    const order = Object.keys(groups).sort((a, b) => groups[b][0].score - groups[a][0].score || (ACT_ORDER.indexOf(a) + 1 || 99) - (ACT_ORDER.indexOf(b) + 1 || 99));
    const top = sg.list[0].score;
    const row = r => { const ref = r.lastGood || r.last, bar = Math.max(8, Math.round(100 * r.score / top));
      const tag = r.rated ? `${r.good}/${r.rated} sortie${r.rated > 1 ? "s" : ""} en bonnes conditions` : `${r.n} sortie${r.n > 1 ? "s" : ""}, conditions non notées`;
      return `<li class="h-course"><i class="h-bar" style="width:${bar}%"></i><a href="https://www.camptocamp.org/outings/${ref.id}" target="_blank" rel="noopener">${esc(r.title)} ↗</a>
        <small><span class="h-ev ${r.rated ? (r.good / r.rated >= 0.6 ? "go" : "warn") : ""}">${tag}</span>${r.alt ? ` · ${r.alt} m` : ""} · dernière fois le ${fmtDay(ref.date)}${ref.cond != null ? ` (${COND_FR[ref.cond]})` : ""}</small></li>`; };
    return order.map(a => `<h4 class="h-act">${ACT_FR[a] || a}</h4><ul class="h-courses">${groups[a].slice(0, 12).map(row).join("")}</ul>`).join("") +
      `<p class="h-small">Classement : chaque sortie d'une journée comparable vote pour sa course, d'autant plus que la situation est proche et que les conditions rapportées étaient bonnes. ${sg.an.length} journées comparables, ${sg.nOut} sorties. Ce sont des indices tirés de ce que d'autres ont trouvé : à recouper avec les derniers comptes rendus et le bulletin d'avalanches.</p>`;
  }
  function analogHtml(an) {
    return `<div class="h-an">${an.map(a => { const os = byDay[a.d] || []; const cs = os.filter(o => o.cond != null), best = cs.length ? Math.min(...cs.map(o => o.cond)) : null;
      return `<button class="h-an-c" data-k="${a.d}"><span class="h-an-d">${fmtDay(a.d)}</span><span class="h-ev ${best == null ? "" : COND_CLS[best]}">${os.length} sortie${os.length > 1 ? "s" : ""}${best == null ? "" : ", " + COND_FR[best]}</span><span>${esc((os[0] ? os[0].title : "").slice(0, 40))}</span></button>`; }).join("")}</div>`;
  }

  function drawDay() {
    const k = sel, d = days[k] || {}, v = verdict(k), b = before(k), os = byDay[k] || [], fut = k >= today();
    const line = m => { const s = d[m]; return s ? `<span>${ctx.lbl(m)} : vent ${r0(s.w)} km/h · précip. ${Math.round(s.pr * 10) / 10} mm · nuages ${r0(s.cm)} %${s.cape != null ? ` · CAPE ${r0(s.cape)}` : ""}${s.izn != null ? ` · 0 °C nuit ${r0(s.izn)} m` : ""}${s.sat ? ` · <span class="hum">humide ${s.sat} h</span>` : ""}</span>` : ""; };
    const fc = Object.values(d).some(x => x.fc);
    let body;
    if (fut) {
      const sg = suggest(k);
      body = `<h3>Situation</h3>${b ? b.read.map(x => `<p class="h-read ${x.c}">${x.t}</p>`).join("") : "<p class='h-read'>Pas assez de données sur les jours d'avant.</p>"}
        ${v && v.v === 2 ? `<p class="h-read no">Verdict « Non » ce jour-là : les courses ci-dessous sont celles qui seraient en condition si la météo s'améliorait.</p>` : ""}
        <h3>Courses qui pourraient être en condition</h3>${coursesHtml(k, sg)}
        ${sg && sg.an.length ? `<details class="fold h-more"><summary><h3>Les ${sg.an.length} journées comparables</h3></summary>${analogHtml(sg.an)}<p class="h-small">Même saison (± ${SEASON_WINDOW} jours), comparées sur la neige au sommet des 7 et 3 derniers jours, le vent et le regel des 3 derniers jours, les jours secs et l'altitude du 0 °C. Cliquez une journée pour la revoir.</p></details>` : ""}
        <details class="fold h-more"><summary><h3>Les 7 jours d'avant en chiffres</h3></summary>${b ? beforeHtml(b) : "<p class='h-read'>Pas assez de données.</p>"}</details>`;
    } else {
      body = `<h3>Les 7 jours d'avant</h3>${b ? beforeHtml(b) + b.read.map(x => `<p class="h-read ${x.c}">${x.t}</p>`).join("") : "<p class='h-read'>Pas assez de données.</p>"}
        <h3>Sorties Camptocamp ce jour-là</h3>${os.length ? `<ul class="h-evs">${os.map(outHtml).join("")}</ul>` : `<p class="h-read">Aucune sortie enregistrée ce jour-là autour du point.</p>`}`;
    }
    el.querySelector("#h-day").innerHTML = `
      <div class="h-head"><h2 class="h-title">${fut ? "Si je pars " : ""}${fmtDay(k)}</h2>${v ? `<span class="h-badge ${CLS[v.v]}">${fc ? "Prévu" : "Verdict"} : ${LBL[v.v]}${v.n === 1 ? " (1 modèle)" : ""}</span>` : ""}</div>
      <p class="h-metrics">${ctx.models.map(line).filter(Boolean).join("<br>") || "Pas de données météo ce jour-là."}</p>${body}`;
    el.querySelector("#h-day").querySelectorAll("button[data-k]").forEach(x => x.onclick = () => go(x.dataset.k, true));
  }

  await load();
  return {reload: load, refresh: draw};
}
