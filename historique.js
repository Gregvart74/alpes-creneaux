// Historique tab: past days scored with the app's verdict rules, the 7 days before each one,
// Camptocamp outings around the point, how well verdicts match reported conditions, and past situations
// resembling the next good day. Loaded on demand by index.html: mount(el, ctx).

const JOURS = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];
const MOIS = ["jan", "fév", "mar", "avr", "mai", "juin", "juil", "août", "sep", "oct", "nov", "déc"];
const LBL = ["Bon", "Limite", "Non"], CLS = ["go", "warn", "no"];
const COND_FR = ["excellentes", "bonnes", "moyennes", "mauvaises", "exécrables"];
const COND_CLS = ["go", "go", "warn", "no", "no"];
const ACT_FR = {skitouring: "ski de rando", snow_ice_mixed: "neige, glace, mixte", mountain_climbing: "alpinisme rocheux", rock_climbing: "escalade",
  ice_climbing: "cascade de glace", hiking: "randonnée", snowshoeing: "raquettes", paragliding: "parapente", mountain_biking: "VTT",
  via_ferrata: "via ferrata", slacklining: "slackline"};
const TZ = "Europe/Paris";
const PL = [850, 700, 600, 500];

const addDays = (k, n) => { const d = new Date(k + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fmtDay = k => { const d = new Date(k + "T12:00:00Z"); return `${JOURS[d.getUTCDay()]} ${d.getUTCDate()} ${MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const r0 = v => v == null ? "–" : Math.round(v);
const today = () => new Date(new Date().toLocaleString("en-US", {timeZone: TZ})).toISOString().slice(0, 10);

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
    outs = c.outings.map(o => ({id: o[0], date: o[1], end: o[2], cond: o[3], act: o[4], alt: o[5], title: o[6], author: o[7]}));
    byDay = {}; outs.forEach(o => (byDay[o.date] = byDay[o.date] || []).push(o));
    const last = outs.length ? outs[outs.length - 1].date : addDays(today(), -1);
    sel = sel && days[sel] ? sel : last;
    year = +sel.slice(0, 4);
    draw();
  }

  // ---------- verdict with the app's current rules ----------
  function verdict(k) {
    const d = days[k]; if (!d) return null;
    const th = ctx.th();
    const one = s => Math.max(s.w <= th.ok ? 0 : s.w <= th.max ? 1 : 2, s.pr >= th.rain2 ? 2 : s.pr >= th.rain1 ? 1 : 0, s.cm >= th.cloud ? 1 : 0,
      s.cape == null ? 0 : s.cape >= 2 * th.cape ? 2 : s.cape >= th.cape ? 1 : 0);
    const ms = ctx.models.filter(m => d[m]);
    return ms.length ? {v: Math.max(...ms.map(m => one(d[m]))), n: ms.length} : null;
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
      warm3: Math.max(0, ...l3.map(p => p.izd || 0)), dry};
    const high = !ctx.isValley(sp), read = [];
    if (f.sn3 >= 15 && high) read.push({c: "warn", t: `Neige fraîche juste avant (≈ ${r0(f.sn3)} cm au sommet sur 3 jours) : traces à faire, rochers enneigés, risque d'avalanche accru.`});
    else if (f.sn7 >= 30 && high) read.push({c: "warn", t: `Gros apport de neige dans la semaine (≈ ${r0(f.sn7)} cm au sommet).`});
    // the no-refreeze warning only matters with snow or ice: glaciers, snowy season, or recent snow
    const snowy = sp.alt >= 3000 || [11, 12, 1, 2, 3, 4, 5].includes(+k.slice(5, 7)) || f.sn7 >= 5;
    if (f.noRegel >= 2 && high && snowy) read.push({c: "warn", t: `${f.noRegel} nuits sans regel au sommet sur les 3 dernières : neige pourrie, ponts de neige fragiles, chutes de pierres.`});
    else if (f.sn7 >= 10 && f.warm3 > sp.alt + 500 && high) read.push({c: "warn", t: `Redoux après la neige (0 °C jusqu'à ${r0(f.warm3)} m) : purges et coulées probables.`});
    if (f.w3 >= 70) read.push({c: "warn", t: `Vent fort juste avant (${r0(f.w3)} km/h au sommet) : neige soufflée, plaques à vent.`});
    if (f.dry >= 5) read.push({c: "go", t: `${f.dry} jours sans précipitation : rocher sec, traces faites.`});
    if (!read.length) read.push({c: "", t: "Rien de marquant dans les jours d'avant."});
    return {prev, f, read};
  }

  // ---------- similar past situations (days with outings) ----------
  const vec = f => [f.sn7 / 40, f.sn3 / 20, f.w3 / 100, Math.min(f.noRegel, 3) / 3, Math.min(f.dry, 10) / 10];
  function analogs(k, n = 5) {
    const b = before(k); if (!b) return [];
    const x = vec(b.f), res = [];
    for (const d in byDay) {
      if (d >= addDays(k, -1) || byDay[d].every(o => o.cond == null)) continue;
      // same season only (± 45 days in the year), otherwise winter and summer mix
      const doy = s => (Date.UTC(2001, +s.slice(5, 7) - 1, +s.slice(8, 10)) - Date.UTC(2001, 0, 1)) / 864e5;
      const dd = Math.abs(doy(d) - doy(k)); if (Math.min(dd, 365 - dd) > 45) continue;
      const be = before(d); if (!be) continue;
      res.push({d, dist: Math.hypot(...x.map((v, i) => v - vec(be.f)[i]))});
    }
    return res.sort((a, b) => a.dist - b.dist).slice(0, n);
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
    const t0 = today(), up = Object.keys(days).filter(k => k >= t0 && (verdict(k) || {}).v === 0).sort()[0];
    el.innerHTML = `
      <section class="panel">
        <div class="h-head"><h2>Historique : ${sp.name}</h2><select id="h-year" aria-label="Année">${years.map(y => `<option>${y}</option>`).join("")}</select></div>
        <div class="h-cal" id="h-cal"></div>
        <p class="h-legend"><i class="sw go"></i>Bon <i class="sw warn"></i>Limite <i class="sw no"></i>Non (règles actuelles) · <b class="dot go">●</b><b class="dot warn">●</b><b class="dot no">●</b> sorties Camptocamp (couleur = conditions rapportées) · cadre = prévision</p>
      </section>
      <section class="panel">
        <h2>Les verdicts collent-ils au terrain ?</h2>
        <div class="h-score">${sc.map((s, v) => `<div><span class="h-badge ${CLS[v]}">${LBL[v]}</span><b>${s.days ? (10 * s.outs / s.days).toFixed(1) : "–"}</b><small>sorties pour 10 jours (${s.days} jours, ${s.outs} sorties)</small><small>${s.n ? Math.round(100 * s.good / s.n) + " % en conditions bonnes ou excellentes" : ""}</small></div>`).join("")}</div>
        <p class="h-small">Sorties Camptocamp ${ctx.isValley(sp) ? "autour du point" : `montées au-dessus de ${sp.alt - 700} m`} depuis octobre 2023, classées selon le verdict que l'app aurait donné ce jour-là. Le bon signe : beaucoup plus de sorties les jours « Bon » que les jours « Non ». La part de bonnes conditions reste haute partout : on sort surtout quand c'est beau et on note souvent bien.</p>
      </section>
      <section class="panel" id="h-up"></section>
      <section class="panel" id="h-day"></section>
      <p class="h-note">Météo : archives de prévisions Open-Meteo (Météo-France et ICON depuis octobre 2023, ECMWF depuis février 2024), mises à jour le ${built} puis complétées en direct. Neige au sommet estimée d'après les précipitations quand le 0 °C est sous le sommet. Sorties : <a href="https://www.camptocamp.org" target="_blank" rel="noopener">camptocamp.org</a>, contenus de leurs auteurs sous licence CC BY-NC-ND.</p>`;
    const $ = id => el.querySelector("#" + id);
    $("h-year").value = year;
    $("h-year").onchange = e => { year = +e.target.value; drawCal(); };
    drawCal(); drawUp(up); drawDay();
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
    cal.querySelectorAll("button[data-k]").forEach(b => b.onclick = () => go(b.dataset.k));
  }
  function go(k) { sel = k; if (+k.slice(0, 4) !== year) { year = +k.slice(0, 4); el.querySelector("#h-year").value = year; } drawCal(); drawDay(); el.querySelector("#h-day").scrollIntoView({behavior: "smooth", block: "start"}); }

  function beforeHtml(b) {
    const row = (lbl, f) => `<tr><th>${lbl}</th>${b.prev.map(p => `<td>${p.ok ? f(p) : "–"}</td>`).join("")}</tr>`;
    const hi = !ctx.isValley(sp);
    return `<div class="h-scroll"><table class="h-before"><thead><tr><th></th>${b.prev.map((p, i) => `<th title="${fmtDay(p.k)}">J−${7 - i}</th>`).join("")}</tr></thead><tbody>
      ${hi ? row("Neige sommet (cm)", p => r0(p.sn)) : ""}${row("Vent sommet", p => r0(p.w))}${row("Précip. (mm)", p => r0(p.pr))}
      ${row("0 °C jour (m)", p => p.izd ? (p.izd / 1000).toFixed(1) + "k" : "–")}${row("0 °C nuit (m)", p => p.izn ? `<span class="${hi && p.izn > sp.alt ? "hum" : ""}">${(p.izn / 1000).toFixed(1)}k</span>` : "–")}</tbody></table></div>
      ${b.read.map(x => `<p class="h-read ${x.c}">${x.t}</p>`).join("")}`;
  }
  const outHtml = o => `<li><span class="h-ev ${o.cond == null ? "" : COND_CLS[o.cond]}">${o.cond == null ? "conditions non notées" : "conditions " + COND_FR[o.cond]}</span> <a href="https://www.camptocamp.org/outings/${o.id}" target="_blank" rel="noopener">${o.title || "Sortie"} ↗</a>
    <small>${o.act.split(",").filter(Boolean).map(a => ACT_FR[a] || a).join(", ")}${o.alt ? ` · ${o.alt} m` : ""}${o.end && o.end !== o.date ? ` · jusqu'au ${fmtDay(o.end)}` : ""}${o.author ? ` · ${o.author}` : ""}</small></li>`;

  function drawDay() {
    const k = sel, d = days[k] || {}, v = verdict(k), b = before(k), os = byDay[k] || [];
    const line = m => { const s = d[m]; return s ? `<span>${ctx.lbl(m)} : vent ${r0(s.w)} km/h · précip. ${Math.round(s.pr * 10) / 10} mm · nuages ${r0(s.cm)} %${s.cape != null ? ` · CAPE ${r0(s.cape)}` : ""}${s.sat ? ` · <span class="hum">humide ${s.sat} h</span>` : ""}</span>` : ""; };
    const fc = Object.values(d).some(x => x.fc);
    el.querySelector("#h-day").innerHTML = `
      <div class="h-head"><h2 class="h-title">${fmtDay(k)}</h2>${v ? `<span class="h-badge ${CLS[v.v]}">${fc ? "Prévu" : "Verdict"} : ${LBL[v.v]}${v.n === 1 ? " (1 modèle)" : ""}</span>` : ""}</div>
      <p class="h-metrics">${ctx.models.map(line).filter(Boolean).join("<br>") || "Pas de données météo ce jour-là."}</p>
      <h3>Les 7 jours d'avant</h3>${b ? beforeHtml(b) : "<p class='h-read'>Pas assez de données.</p>"}
      <h3>Sorties Camptocamp ce jour-là</h3>${os.length ? `<ul class="h-evs">${os.map(outHtml).join("")}</ul>` : `<p class="h-read">Aucune sortie enregistrée ce jour-là autour du point.</p>`}`;
  }

  function drawUp(up) {
    const box = el.querySelector("#h-up");
    if (!up) { box.innerHTML = `<h2>Prochain créneau</h2><p class="h-read">Aucun jour « Bon » dans les 10 jours de prévision.</p>`; return; }
    const b = before(up), an = analogs(up);
    const all = an.flatMap(a => byDay[a.d] || []).filter(o => o.cond != null), cnt = [0, 0, 0];
    all.forEach(o => cnt[o.cond <= 1 ? 0 : o.cond === 2 ? 1 : 2]++);
    box.innerHTML = `<div class="h-head"><h2>Prochain créneau : ${fmtDay(up)}</h2><button class="h-go" data-k="${up}">Détail</button></div>
      ${b ? b.read.map(x => `<p class="h-read ${x.c}">${x.t}</p>`).join("") : ""}
      <h3>Situations passées les plus proches (même saison, jours d'avant comparables)</h3>
      ${all.length ? `<p class="h-read">${an.length} situations, ${all.length} sorties notées : <b class="dot go">●</b> ${cnt[0]} bonnes ou excellentes · <b class="dot warn">●</b> ${cnt[1]} moyennes · <b class="dot no">●</b> ${cnt[2]} mauvaises.</p>` : ""}
      <div class="h-an">${an.map(a => { const os = byDay[a.d] || []; const cs = os.filter(o => o.cond != null), best = cs.length ? Math.min(...cs.map(o => o.cond)) : null;
        return `<button class="h-an-c" data-k="${a.d}"><span class="h-an-d">${fmtDay(a.d)}</span><span class="h-ev ${best == null ? "" : COND_CLS[best]}">${os.length} sortie${os.length > 1 ? "s" : ""}${best == null ? "" : ", " + COND_FR[best]}</span><span>${os[0] ? os[0].title.slice(0, 40) : ""}</span></button>`; }).join("")}</div>
      <p class="h-small">Comparaison sur la neige au sommet (7 et 3 derniers jours), le vent et le regel des 3 derniers jours, et le nombre de jours secs.</p>`;
    box.querySelectorAll("button[data-k]").forEach(x => x.onclick = () => go(x.dataset.k));
  }

  await load();
  return {reload: load, refresh: draw};
}
