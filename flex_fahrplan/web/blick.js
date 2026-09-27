/* Dashboard: one plant, one day, before and after, plus the year estimate. Uses the helpers from app.js. */
'use strict';

const BLICK_START = '2026-06-18';
const NUTZUNG_FARBE = { reduktion: BLAU, nachholen: ORANGE, spitze: '#898781' };
const NUTZUNG_NAME = { reduktion: 'Block with load reduction', nachholen: 'Block with day-ahead extra buying', spitze: 'Block with peak shaving' };
let jahrTimer = null;

/* Ranges instead of point values: two significant digits, "a to b", or "about a" when both ends meet. */
function grob(x, stellen = 2) {
  if (x == null || Number.isNaN(x)) return null;
  if (x === 0) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(Math.abs(x))) - stellen + 1);
  return Math.round(x / p) * p;
}
function bereich(paar, einheit, dez = 0, stellen = 2) {
  const lo = grob(paar[0], stellen), hi = grob(paar[1], stellen);
  const f = v => fmt(v, dez);
  if (f(lo) === f(hi)) return `about ${f(lo)} <small>${einheit}</small>`;
  return `${f(lo)} <small>to</small> ${f(hi)} <small>${einheit}</small>`;
}
function bereichText(paar, dez = 0, stellen = 2) {
  const lo = grob(paar[0], stellen), hi = grob(paar[1], stellen);
  return fmt(lo, dez) === fmt(hi, dez) ? `about ${fmt(lo, dez)}` : `${fmt(lo, dez)} to ${fmt(hi, dez)}`;
}

$('#blick-datum').addEventListener('change', e => { S.blickDatum = e.target.value; speicher('blick.datum', S.blickDatum); S.blick = null; ladeBlick(); });

function blickStandardDatum() {
  const st = S.standort;
  if (st && st.lastgang_von && st.lastgang_bis) {
    const von = st.lastgang_von.slice(0, 10), bis = st.lastgang_bis.slice(0, 10);
    if (von <= BLICK_START && BLICK_START <= bis) return BLICK_START;
    return bis;
  }
  return S.status ? S.status.folgetag : BLICK_START;
}

async function ladeBlick() {
  const leer = !S.sid;
  $('#blick-leer').classList.toggle('hidden', !leer);
  $('#blick-body').classList.toggle('hidden', leer);
  if (leer) return;
  if (!S.standort || !S.standort.lastgang_werte) {
    $('#blick-leer').textContent = 'This site has no load data yet. Upload load data under Assets, then the dashboard appears here.';
    $('#blick-leer').classList.remove('hidden'); $('#blick-body').classList.add('hidden');
    return;
  }
  await versuchen(async () => {
    if (!S.blickDatum) S.blickDatum = lesen('blick.datum') || blickStandardDatum();
    $('#blick-datum').value = S.blickDatum;
    if (S.blick && S.blick.datum === S.blickDatum) { zeichneBlick(); return; }
    S.blick = await api(`/api/standorte/${S.sid}/blick?datum=${S.blickDatum}`);
    zeichneBlick();
  });
  ladeJahr();
}

function datumLang(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function zeichneBlick() {
  const b = S.blick; const k = b.kennzahlen; const an = b.annahmen;
  $('#blick-body').classList.remove('hidden'); $('#blick-leer').classList.add('hidden');
  $('#blick-titel').textContent = `${b.standort.name}, ${datumLang(b.datum)}`;
  $('#blick-quelle').textContent = b.preisquelle ? `Prices: ${b.preisquelle}` : 'No prices for this day';
  $('#blick-csv').href = `/api/standorte/${S.sid}/blick/${b.datum}/fahrplan.csv`;
  const sp = b.spanne;
  $('#blick-kacheln').innerHTML = [
    kachel('Balancing reserve held, up', bereich(sp.afrr_pos_mw, 'MW on average', 1), `most of the day, safe to expected value`, sp.afrr_pos_mw[1] > 0 ? 'gut' : ''),
    kachel('Balancing reserve held, down', bereich(sp.afrr_neg_mw, 'MW on average', 1), `about half of the day, safe to expected value`, sp.afrr_neg_mw[1] > 0 ? 'gut' : ''),
    kachel('Revenue on this day', bereich(sp.tag_eur, 'EUR'), `balancing reserve ${bereichText(sp.afrr_eur)} EUR, day-ahead ${bereichText(sp.da_eur)} EUR`, sp.tag_eur[1] > 0 ? 'gut' : ''),
    kachel('Peak shaved', bereich(sp.gesenkt_mw, 'MW', 1), `worth ${bereichText(sp.spitze_eur)} EUR per year at ${fmt(an.leistungspreis_eur_kw_a, 0)} EUR per kW`, sp.gesenkt_mw[1] > 0 ? 'gut' : ''),
    kachel('Energy shifted', bereich(sp.verschoben_mwh, 'MWh', 1), `roughly ${fmt(grob(k.anteil_verschoben_prozent, 1), 0)} percent of the daily energy`),
  ].join('');

  const x = b.zeiten;
  const bereiche = b.bloecke.map((bl, i) => {
    const art = bl.nutzung.split('+').find(t => t !== 'afrr');
    return art && NUTZUNG_FARBE[art] ? { von: i * 16, bis: (i + 1) * 16, farbe: NUTZUNG_FARBE[art], name: NUTZUNG_NAME[art] } : null;
  }).filter(Boolean);
  linienChart($('#blick-last'), {
    W: 720, H: 270, x, xSchritt: 16, einheit: 'MW', bereiche,
    serien: [
      { name: b.hat_ist ? 'Before, measured' : 'Before, forecast', werte: b.vorher, farbe: BLAU },
      { name: 'After, with flex schedule', werte: b.nachher, farbe: ORANGE },
    ],
    baender: [{ name: 'Balancing reserve held', oben: b.nachher.map((v, i) => v + b.afrr_neg_vorgehalten[i]), unten: b.nachher.map((v, i) => v - b.afrr_pos_vorgehalten[i]), farbe: ORANGE }],
    hlinien: k.gesenkt_mw > 0 ? [{ wert: b.kappe, text: `Target peak ${fmt(b.kappe)} MW` }] : [],
    extra: i => { const bl = b.bloecke[Math.floor(i / 16)]; return `<br>Block ${bl.von} to ${bl.bis}: ${esc(bl.nutzung_text)}`; },
  });
  const rest = (a, g, r) => a.map((v, i) => Math.max(0, v - g[i] - r[i]));
  balkenChart($('#blick-flex'), {
    W: 720, H: 270, x, xSchritt: 16, einheit: 'MW',
    oben: [
      { name: 'Reduction for peak shaving and shifting', werte: b.pos_genutzt, farbe: BLAU },
      { name: 'Reduction held as balancing reserve', werte: b.afrr_pos_vorgehalten, farbe: BLAU, deckung: 0.6 },
      { name: 'Reduction free', werte: rest(b.pos_p10, b.pos_genutzt, b.afrr_pos_vorgehalten), farbe: BLAU, deckung: 0.25 },
    ],
    unten: [
      { name: 'Increase for day-ahead extra buying', werte: b.neg_genutzt, farbe: ORANGE },
      { name: 'Increase held as balancing reserve', werte: b.afrr_neg_vorgehalten, farbe: ORANGE, deckung: 0.6 },
      { name: 'Increase free', werte: rest(b.neg_p10, b.neg_genutzt, b.afrr_neg_vorgehalten), farbe: ORANGE, deckung: 0.25 },
    ],
    extra: i => `<br>Product ${b.produkt_pos[i]}, limit: ${GRUND[b.begrenzung_pos[i]]}`,
  });

  // End product: strip and table of the 96 quarter hours
  streifen($('#blick-streifen'), x, [
    { name: 'aFRR positive', werte: b.afrr_pos_vorgehalten, rampe: RAMPE_BLAU },
    { name: 'aFRR negative', werte: b.afrr_neg_vorgehalten, rampe: RAMPE_ORANGE },
    { name: 'Reduction day-ahead', werte: b.pos_da, rampe: RAMPE_BLAU },
    { name: 'Day-ahead extra buying', werte: b.neg_da.map((v, i) => v + b.neg_spitze[i]), rampe: RAMPE_ORANGE },
    { name: 'Peak shaving', werte: b.pos_spitze, rampe: RAMPE_BLAU },
  ]);
  const tb = $('#blick-96 tbody');
  tb.innerHTML = x.map((von, i) => `<tr data-i="${i}"><td>${von}</td><td class="zahl">${fmt(b.vorher[i])}</td><td class="zahl">${fmt(b.nachher[i])}</td><td class="zahl">${fmt(b.afrr_pos_vorgehalten[i])}</td><td class="zahl">${fmt(b.afrr_neg_vorgehalten[i])}</td><td class="zahl">${fmt(b.pos_da[i])}</td><td class="zahl">${fmt(b.neg_da[i] + b.neg_spitze[i])}</td><td class="zahl">${fmt(b.pos_spitze[i])}</td><td class="zahl">${b.preis[i] == null ? '' : fmt(b.preis[i])}</td><td class="zahl">${fmt(b.erloes_afrr[i] + b.erloes_da[i], 1)}</td></tr>`).join('');

  // Derivation
  linienChart($('#blick-preis'), {
    W: 720, H: 220, x, xSchritt: 16, einheit: 'EUR/MWh',
    serien: [{ name: 'Day-ahead price', werte: b.preis, farbe: BLAU }],
    hlinien: (k.preis_min != null && k.preis_min < 0) ? [{ wert: 0, text: '' }] : [],
  });
  balkenChart($('#blick-erloes'), {
    W: 720, H: 220, x, xSchritt: 16, einheit: 'EUR',
    oben: [
      { name: 'Balancing reserve positive', werte: b.erloes_afrr_pos, farbe: BLAU, deckung: 0.6 },
      { name: 'Balancing reserve negative', werte: b.erloes_afrr_neg, farbe: BLAU, deckung: 0.35 },
      { name: 'Day-ahead, value of the load reduction', werte: b.erloes_da.map(v => Math.max(0, v)), farbe: BLAU },
    ],
    unten: [{ name: 'Day-ahead, cost of extra buying', werte: b.erloes_da.map(v => Math.max(0, -v)), farbe: ORANGE }],
    extra: i => b.preis[i] == null ? '' : `<br>Price ${fmt(b.preis[i])} EUR/MWh`,
  });
  $('#blick-bloecke tbody').innerHTML = b.bloecke.map(bl => `<tr><td>${bl.von} to ${bl.bis}</td><td>${esc(bl.nutzung_text)}</td><td class="zahl">${fmt(bl.afrr_pos_mw)}</td><td class="zahl">${fmt(bl.afrr_neg_mw)}</td><td class="zahl">${fmt(bl.afrr_eur, 0)}</td><td class="zahl">${bl.preis_mittel == null ? '' : fmt(bl.preis_mittel, 1)}</td><td class="zahl">${fmt(bl.da_eur, 0)}</td><td class="zahl">${fmt(bl.verschoben_mwh)}</td><td class="zahl">${fmt(bl.gekappt_mwh)}</td></tr>`).join('');

  const saetze = [];
  if (k.afrr_eur > 0) saetze.push(`<p><b>Balancing reserve.</b> aFRR is offered per quarter hour. After peak shaving and shifting, on average ${fmt(k.afrr_pos_mittel_mw)} MW positive and ${fmt(k.afrr_neg_mittel_mw)} MW negative balancing reserve remain, in ${fmt(k.afrr_stunden_pos, 1)} and ${fmt(k.afrr_stunden_neg, 1)} hours of the day with at least 0.1 MW. Capacity price ${fmt(k.afrr_pos_eur, 0)} EUR positive and ${fmt(k.afrr_neg_eur, 0)} EUR negative at ${fmt(an.afrr_eur_mw_h, 1)} and ${fmt(an.afrr_neg_eur_mw_h, 1)} EUR per MW and hour on average (${esc(an.afrr_preisquelle || 'assumption per site')}). With 365 such days that is about ${fmt(k.afrr_jahr_eur, 0)} EUR per year, activation payments not counted.</p>`);
  else saetze.push('<p><b>Balancing reserve.</b> On this day no aFRR-capable power is left.</p>');
  if (k.gesenkt_mw > 0) saetze.push(`<p><b>Peak shaved.</b> The peak load drops from ${fmt(k.spitze_vorher)} to ${fmt(k.spitze_nachher)} MW. At ${fmt(an.leistungspreis_eur_kw_a, 0)} EUR per kW demand charge that is ${fmt(k.spitze_wert_jahr_eur, 0)} EUR per year, if this day sets the annual peak. The shaved energy is caught up below the target peak in the cheapest quarter hours.</p>`);
  else saetze.push('<p><b>Peak.</b> On this day the peak load cannot be lowered, because no load reduction is free at the peak.</p>');
  for (const v of b.verschiebungen) {
    saetze.push(`<p><b>Day-ahead, ${v.vorziehen ? 'pulled forward' : 'caught up'}.</b> Load reduction from ${v.reduktion_von} to ${v.reduktion_bis} with up to ${fmt(v.leistung_mw)} MW at ${fmt(v.preis_reduktion, 0)} EUR per MWh on average. The ${fmt(v.energie_mwh, 1)} MWh are ${v.vorziehen ? 'stored in advance' : 'caught up afterwards'} from ${v.nachholen_von} to ${v.nachholen_bis} at ${fmt(v.preis_nachholen, 0)} EUR per MWh. Value ${fmt(v.erloes_eur, 0)} EUR, cost ${fmt(v.kosten_eur, 0)} EUR, leaving ${fmt(v.netto_eur, 0)} EUR. That is more than the ${fmt(v.entgangene_regelleistung_eur, 0)} EUR of balancing reserve given up for it.</p>`);
  }
  if (!b.verschiebungen.length && b.hat_preis) saetze.push('<p><b>Day-ahead.</b> The price spread of the day is not enough to shift energy at a profit.</p>');
  if (an.puffer_reduktion_mwh != null) saetze.push(`<p><b>Limits.</b> Per call at most ${fmt(an.puffer_reduktion_mwh, 1)} MWh of load reduction (buffer of the assets) and at most ${fmt(an.max_dauer_min, 0)} minutes at a stretch, then recovery time.</p>`);
  $('#blick-text').innerHTML = saetze.join('');
  $('#blick-hinweise').innerHTML = (b.hinweise || []).map(h => `<li>${esc(h)}</li>`).join('');
}

/* Colour strip as SVG: 96 cells per row, colour is the value. Click jumps to the table row. */
function streifen(el, x, zeilen) {
  el.innerHTML = '';
  const W = 1200, L = 290, R = 10, T = 22, ZH = 24, GAP = 6;
  const H = T + zeilen.length * (ZH + GAP) + 4;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const bw = (W - L - R) / 96;
  for (let h = 0; h < 24; h++) { const t = svgEl('text', { x: L + h * 4 * bw, y: 14, 'font-size': 11, fill: '#1d1f20' }); t.textContent = h; svg.appendChild(t); }
  zeilen.forEach((z, r) => {
    const max = Math.max(0.01, ...z.werte);
    const y = T + r * (ZH + GAP);
    const t = svgEl('text', { x: 0, y: y + ZH / 2 + 5, 'font-size': 14, fill: '#1d1f20' }); t.textContent = `${z.name}, up to ${fmt(max)} MW`; svg.appendChild(t);
    z.werte.forEach((v, i) => {
      const c = svgEl('rect', { x: L + i * bw + 1, y, width: Math.max(1, bw - 2), height: ZH, rx: 2, fill: (!v || v <= 0) ? '#eeeeee' : rampenFarbe(v, max, z.rampe), cursor: 'pointer' });
      const tt = svgEl('title'); tt.textContent = `${x[i]}, ${z.name}: ${fmt(v)} MW`; c.appendChild(tt);
      c.addEventListener('click', () => {
        const tr = $(`#blick-96 tr[data-i="${i}"]`);
        $$('#blick-96 tr.markiert').forEach(t2 => t2.classList.remove('markiert'));
        if (tr) { tr.classList.add('markiert'); tr.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      });
      svg.appendChild(c);
    });
  });
  el.appendChild(svg);
  const leg = document.createElement('div'); leg.className = 'legende';
  leg.innerHTML = `<span><i class="flaeche" style="background:${BLAU}"></i>Load reduction, light is little, dark is much</span><span><i class="flaeche" style="background:${ORANGE}"></i>Load increase</span><span>No colour is 0 MW</span>`;
  el.appendChild(leg);
}

/* PNG export of a chart box: the SVG plus its legend on a white background, at double resolution. */
async function pngExport(id) {
  const url = await pngDaten(id); if (!url) return;
  const a = document.createElement('a'); a.download = `${id}-${S.blick ? S.blick.datum : 'chart'}.png`; a.href = url; a.click();
}
async function pngDaten(id) {
  const box = $('#' + id); const svg = box.querySelector('svg'); if (!svg) return null;
  const vb = svg.viewBox.baseVal; const W = vb.width, H = vb.height, scale = 2;
  const legende = Array.from(box.querySelectorAll('.legende span')).map(sp => { const i = sp.querySelector('i'); return { text: sp.textContent, farbe: i ? getComputedStyle(i).backgroundColor : null, deckung: i ? getComputedStyle(i).opacity : 1, breit: i && i.classList.contains('flaeche') }; });
  const zeilen = []; let zeile = []; let breite = 0;
  const ctxMess = document.createElement('canvas').getContext('2d'); ctxMess.font = '14px Arial';
  for (const l of legende) { const w = ctxMess.measureText(l.text).width + 34; if (breite + w > W - 20 && zeile.length) { zeilen.push(zeile); zeile = []; breite = 0; } zeile.push(l); breite += w; }
  if (zeile.length) zeilen.push(zeile);
  const LH = 22, legH = zeilen.length * LH + 10;
  const canvas = document.createElement('canvas'); canvas.width = W * scale; canvas.height = (H + legH) * scale;
  const ctx = canvas.getContext('2d'); ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H + legH);
  const klon = svg.cloneNode(true); klon.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); klon.setAttribute('width', W); klon.setAttribute('height', H);
  klon.querySelectorAll('text').forEach(t => t.setAttribute('font-family', 'Arial, Helvetica, sans-serif'));
  const blob = new Blob([new XMLSerializer().serializeToString(klon)], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  await new Promise((ok, nein) => { const img = new Image(); img.onload = () => { ctx.drawImage(img, 0, 0, W, H); URL.revokeObjectURL(url); ok(); }; img.onerror = nein; img.src = url; });
  ctx.font = '14px Arial, Helvetica, sans-serif'; ctx.fillStyle = '#1d1f20'; ctx.textBaseline = 'middle';
  zeilen.forEach((z, r) => {
    let xpos = 12; const y = H + 8 + r * LH + LH / 2;
    for (const l of z) {
      if (l.farbe) { ctx.globalAlpha = Number(l.deckung) || 1; ctx.fillStyle = l.farbe; if (l.breit) ctx.fillRect(xpos, y - 6, 16, 12); else ctx.fillRect(xpos, y - 1.5, 16, 3); ctx.globalAlpha = 1; }
      ctx.fillStyle = '#1d1f20'; ctx.fillText(l.text, xpos + (l.farbe ? 22 : 0), y);
      xpos += ctx.measureText(l.text).width + 34;
    }
  });
  return canvas.toDataURL('image/png');
}
$$('.png-knopf').forEach(b => b.addEventListener('click', () => versuchen(() => pngExport(b.dataset.png))));

// ------------------------------------------------------------- Year estimate
async function ladeJahr() {
  clearTimeout(jahrTimer);
  const sid = S.sid;
  if (!sid) return;
  const box = $('#blick-jahr');
  try {
    const j = await api(`/api/standorte/${sid}/jahr`);
    if (sid !== S.sid) return;
    if (j.status === 'laeuft') {
      const anteil = j.gesamt ? j.fertig / j.gesamt : 0;
      box.innerHTML = `<div class="stand">Computing the year estimate: ${fmt(j.fertig, 0)} of ${fmt(j.gesamt, 0)} days done. Every day of the last 12 months is optimised once, this takes about a minute the first time.<div class="fortschritt"><i style="width:${Math.round(anteil * 100)}%"></i></div></div>`;
      jahrTimer = setTimeout(ladeJahr, 2500);
      return;
    }
    if (j.status === 'fehler') { box.innerHTML = `<div class="stand">Year estimate failed: ${esc(j.fehler)}</div>`; return; }
    zeichneJahr(j);
  } catch (e) {
    box.innerHTML = `<div class="stand">${esc(e.message)}</div>`;
  }
}

function zeichneJahr(j) {
  const box = $('#blick-jahr');
  if (!j.tage) { box.innerHTML = `<div class="stand">${esc(j.hinweis || 'No complete day in the load data.')}</div>`; return; }
  const s = j.summen, y = j.jahr_spanne || { afrr_eur: [j.jahr.afrr_eur, j.jahr.afrr_eur], da_eur: [j.jahr.da_eur, j.jahr.da_eur], spitze_eur: [j.jahr.spitze_eur, j.jahr.spitze_eur], gesamt_eur: [j.jahr.gesamt_eur, j.jahr.gesamt_eur] }, an = j.annahmen;
  const links = document.createElement('div');
  links.innerHTML = `<div class="kacheln">
    ${kachel('Balancing reserve per year', bereich(y.afrr_eur, 'EUR'), `roughly ${fmt(grob(s.afrr_pos_mw_mittel, 1), 1)} MW up and ${fmt(grob(s.afrr_neg_mw_mittel, 1), 1)} MW down held on average`, 'gut')}
    ${kachel('Day-ahead shifting per year', bereich(y.da_eur, 'EUR'), `depends on the price spread of the year`, y.da_eur[1] > 0 ? 'gut' : '')}
    ${kachel('Peak shaving per year', bereich(y.spitze_eur, 'EUR'), `annual peak from about ${fmt(grob(s.spitze_vorher_mw, 2), 1)} to ${fmt(grob(s.spitze_nachher_mw, 2), 1)} MW at ${fmt(an.leistungspreis_eur_kw_a, 0)} EUR per kW`, y.spitze_eur[1] > 0 ? 'gut' : '')}
    ${kachel('Total per year', bereich(y.gesamt_eur, 'EUR'), `range from safe to expected flexibility and from weak to strong months, ${j.tage} days of history, capacity prices: ${an.afrr_preisquelle || 'assumption'}, activation payments not counted`, 'gut')}
  </div>`;
  const rechts = document.createElement('div'); rechts.className = 'chart-box';
  rechts.innerHTML = '<h3>Revenue per month: balancing reserve and day-ahead</h3><div class="chart" id="blick-jahr-chart"></div>';
  box.innerHTML = ''; box.appendChild(links); box.appendChild(rechts);
  const m = j.monate;
  balkenChart($('#blick-jahr-chart'), {
    W: 720, H: 250, x: m.map(t => t.monat), xSchritt: 1, einheit: 'EUR',
    oben: [
      { name: 'Balancing reserve', werte: m.map(t => t.afrr_eur), farbe: BLAU, deckung: 0.6 },
      { name: 'Day-ahead shifting', werte: m.map(t => Math.max(0, t.da_eur)), farbe: BLAU },
    ],
    unten: [{ name: 'Day-ahead loss', werte: m.map(t => Math.max(0, -t.da_eur)), farbe: ORANGE }],
    extra: i => `<br>${m[i].tage} days, aFRR on average ${fmt(m[i].afrr_pos_mw)} MW up and ${fmt(m[i].afrr_neg_mw)} MW down<br>peak ${fmt(m[i].spitze_vorher)} MW before, ${fmt(m[i].spitze_nachher)} MW after`,
  });
}

/* Columns upwards and downwards, stacked. oben and unten: [{name, werte, farbe, deckung}] */
function balkenChart(el, cfg) {
  el.innerHTML = '';
  const W = cfg.W || 640, H = cfg.H || 250, L = 46, R = 12, T = 12, B = 28;
  const n = cfg.x.length;
  const summe = serien => cfg.x.map((_, i) => serien.reduce((s, r) => s + (r.werte[i] || 0), 0));
  const oben = summe(cfg.oben || []), unten = summe(cfg.unten || []);
  const maxO = schoenMax(Math.max(0.0001, ...oben) * 1.05), maxU = (cfg.unten && cfg.unten.length && Math.max(...unten) > 0) ? schoenMax(Math.max(0.0001, ...unten) * 1.05) : 0;
  const Y = v => T + (maxO - v) / (maxO + maxU) * (H - T - B);
  const band = (W - L - R) / n, breite = Math.min(n <= 12 ? 40 : 24, Math.max(2, band - 2));
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const schritt = (maxO + maxU) / 5;
  for (let v = -maxU; v <= maxO + 1e-9; v += schritt) {
    const y = Y(v);
    svg.appendChild(svgEl('line', { x1: L, x2: W - R, y1: y, y2: y, stroke: Math.abs(v) < 1e-9 ? '#c3c2b7' : '#e1e0d9', 'stroke-width': 1 }));
    const t = svgEl('text', { x: L - 6, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#1d1f20' }); t.textContent = fmt(v, (maxO + maxU) >= 20 ? 0 : 1); svg.appendChild(t);
  }
  const xs = cfg.xSchritt || Math.max(1, Math.round(n / 8));
  for (let i = 0; i < n; i++) {
    const x0 = L + band * i + (band - breite) / 2;
    let cum = 0;
    for (const r of cfg.oben || []) {
      const v = r.werte[i] || 0; if (v <= 0) continue;
      const y1 = Y(cum + v), y0 = Y(cum);
      svg.appendChild(svgEl('rect', { x: x0, y: y1, width: breite, height: Math.max(0, y0 - y1 - 1), fill: r.farbe, opacity: r.deckung ?? 0.9 }));
      cum += v;
    }
    cum = 0;
    for (const r of cfg.unten || []) {
      const v = r.werte[i] || 0; if (v <= 0) continue;
      const y0 = Y(-cum), y1 = Y(-cum - v);
      svg.appendChild(svgEl('rect', { x: x0, y: y0 + 1, width: breite, height: Math.max(0, y1 - y0 - 1), fill: r.farbe, opacity: r.deckung ?? 0.9 }));
      cum += v;
    }
    const fang = svgEl('rect', { x: L + band * i, y: T, width: band, height: H - T - B, fill: 'transparent' });
    fang.addEventListener('mousemove', ev => {
      let html = `<b>${cfg.x[i]}</b>`;
      for (const r of [...(cfg.oben || []), ...(cfg.unten || [])]) html += `<br>${esc(r.name)}: ${fmt(r.werte[i] || 0, cfg.einheit === 'EUR' ? 0 : 2)} ${cfg.einheit || ''}`;
      if (cfg.extra) html += cfg.extra(i);
      tipZeigen(html, ev);
    });
    fang.addEventListener('mouseleave', tipWeg);
    svg.appendChild(fang);
    if (i % xs === 0) { const t = svgEl('text', { x: L + band * i + band / 2, y: H - 8, 'text-anchor': 'middle', 'font-size': 11, fill: '#1d1f20' }); t.textContent = cfg.x[i]; svg.appendChild(t); }
  }
  el.appendChild(svg);
  const leg = document.createElement('div'); leg.className = 'legende';
  leg.innerHTML = [...(cfg.oben || []), ...(cfg.unten || [])].map(r => `<span><i class="flaeche" style="background:${r.farbe}; opacity:${r.deckung ?? 0.9}"></i>${esc(r.name)}</span>`).join('');
  el.appendChild(leg);
}
