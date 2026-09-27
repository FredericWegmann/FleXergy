/* Flex Schedule, user interface. No framework, four screens, hand-made SVG charts. */
'use strict';

const S = { standorte: [], sid: null, standort: null, datum: null, fp: null, qh: null, plan: null, genau: null, status: null, abrufe: null, blick: null, blickDatum: null };
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const TYP = { kaelte: 'Refrigeration', waerme: 'Heat', pumpe: 'Pump', lueftung: 'Ventilation', elektrolyse: 'Electrolysis', schaltbar: 'Switchable block', sonstiges: 'Other' };
const GRUND = { technisch: 'Technical limit of the asset', prozessual: 'Production plan', energetisch: 'Buffer or catch-up', vertraglich: 'Release window of the plant' };
const STATUS = { entwurf: 'Draft', angefordert: 'Approval requested', freigegeben: 'Approved', abgelehnt: 'Rejected' };
const TYPTAG = { werktag: 'weekday', samstag: 'Saturday', sonntag: 'Sunday or holiday' };
const WOCHENTAGE = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SCHICHTEN = ['', 'Early', 'Late', 'Night', 'none'];
const BLAU = '#2a78d6', ORANGE = '#eb6834';
const RAMPE_BLAU = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#2a78d6', '#1c5cab', '#0d366b'];
const RAMPE_ORANGE = ['#fbe0d3', '#f7c3ab', '#f2a382', '#ec835a', '#eb6834', '#c94f21', '#9a3a14'];

function fmt(x, n = 2) {
  if (x === null || x === undefined || Number.isNaN(x)) return '';
  return Number(x).toLocaleString('en-US', { minimumFractionDigits: n, maximumFractionDigits: n });
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function speicher(k, v) { try { localStorage.setItem('flex.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
function lesen(k) { try { return JSON.parse(localStorage.getItem('flex.' + k)); } catch (e) { return null; } }
function zeitText(t) { return (t || '').replace('T', ' ').slice(0, 16); }

async function api(pfad, opt = {}) {
  const o = { method: opt.method || 'GET', headers: {} };
  if (opt.json !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opt.json); }
  if (opt.form) o.body = opt.form;
  const r = await fetch(pfad, o);
  if (!r.ok) {
    let t = r.statusText;
    try { const j = await r.json(); t = j.detail || JSON.stringify(j); } catch (e) { /* no JSON */ }
    throw new Error(t);
  }
  return r.json();
}

let meldungTimer = null;
function melden(text, art = '') {
  const m = $('#meldung');
  m.textContent = text; m.className = 'meldung ' + art;
  clearTimeout(meldungTimer);
  meldungTimer = setTimeout(() => m.classList.add('hidden'), art === 'fehler' ? 9000 : 4000);
}
async function versuchen(fn) { try { await fn(); } catch (e) { melden(e.message || String(e), 'fehler'); } }

// ------------------------------------------------------------------ Navigation
$$('#tabs button').forEach(b => b.addEventListener('click', () => zeigeView(b.dataset.view)));
function zeigeView(name) {
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === name));
  $$('.view').forEach(v => v.classList.toggle('on', v.id === 'view-' + name));
  speicher('view', name);
  if (name === 'blick') ladeBlick();
  if (name === 'fahrplan') ladeFahrplan();
  if (name === 'genau' && S.sid && !S.genau) ladeGenau();
}
$$('.untertabs').forEach(gruppe => {
  const g = gruppe.dataset.gruppe;
  gruppe.querySelectorAll('button').forEach(b => b.addEventListener('click', () => zeigeUntertab(g, b.dataset.tab)));
  const gemerkt = lesen('tab.' + g);
  if (gemerkt && gruppe.querySelector(`[data-tab="${gemerkt}"]`)) zeigeUntertab(g, gemerkt);
});
function zeigeUntertab(gruppe, tab) {
  const box = $(`.untertabs[data-gruppe="${gruppe}"]`);
  box.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  box.parentElement.querySelectorAll('.untertab').forEach(u => u.classList.toggle('on', u.id === tab));
  speicher('tab.' + gruppe, tab);
}

// -------------------------------------------------------------------- Sites
async function ladeStandorte(wahl) {
  S.standorte = await api('/api/standorte');
  const sel = $('#standort-wahl');
  sel.innerHTML = S.standorte.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('') || '<option value="">no site</option>';
  const gewuenscht = wahl ?? S.sid ?? lesen('sid');
  const vorhanden = S.standorte.find(s => s.id === Number(gewuenscht)) || S.standorte[0];
  S.sid = vorhanden ? vorhanden.id : null;
  sel.value = S.sid ?? '';
  speicher('sid', S.sid);
  await ladeStandort();
}
$('#standort-wahl').addEventListener('change', e => versuchen(async () => { S.sid = Number(e.target.value) || null; speicher('sid', S.sid); S.genau = null; await ladeStandort(); }));

async function ladeStandort() {
  S.fp = null; S.genau = null; S.abrufe = null; S.blick = null; S.blickDatum = null;
  if (!S.sid) { S.standort = null; zeichneAnlagenView(); zeichneFahrplan(); ladeBlick(); return; }
  S.standort = await api(`/api/standorte/${S.sid}`);
  zeichneAnlagenView();
  const view = $$('#tabs button').find(b => b.classList.contains('on')).dataset.view;
  if (view === 'blick') await ladeBlick();
  if (view === 'fahrplan') await ladeFahrplan();
  if (view === 'genau') await ladeGenau();
}

$('#beispiel-neu').addEventListener('click', () => versuchen(async () => {
  melden('Creating the example cold store with 12 months of load data, one moment please.');
  const st = await api('/api/standorte/beispiel', { method: 'POST' });
  await ladeStandorte(st.id);
  melden(`Site "${st.name}" created.`, 'ok');
}));
$('#standort-neu').addEventListener('click', () => $('#standort-dlg').showModal());
$('#standort-abbruch').addEventListener('click', () => $('#standort-dlg').close());
$('#standort-neu-form').addEventListener('submit', e => { e.preventDefault(); versuchen(async () => {
  const f = new FormData(e.target);
  const st = await api('/api/standorte', { method: 'POST', json: { name: f.get('name'), ort: f.get('ort'), spitzenlast_mw: Number(f.get('spitzenlast_mw') || 0) } });
  $('#standort-dlg').close(); e.target.reset();
  await ladeStandorte(st.id); zeigeView('anlagen');
  melden('Site created. Now upload load data, add assets and release windows.', 'ok');
}); });

// ------------------------------------------------------------- Assets screen
function zeichneAnlagenView() {
  const st = S.standort;
  const form = $('#standort-form');
  for (const el of form.elements) { if (el.name) el.value = st ? (st[el.name] ?? '') : ''; }
  $('#lastgang-stand').textContent = st && st.lastgang_werte
    ? `Load data from ${zeitText(st.lastgang_von)} to ${zeitText(st.lastgang_bis)}, ${fmt(st.lastgang_werte, 0)} quarter hours.` + (st.plan_bis ? ` Production plan until ${zeitText(st.plan_bis)}.` : ' No production plan.')
    : 'No load data available.';
  const tb = $('#anlagen-tabelle tbody');
  tb.innerHTML = '';
  for (const a of (st ? st.anlagen : [])) {
    const tr = document.createElement('tr'); tr.className = 'klick';
    tr.innerHTML = `<td>${esc(a.name)}</td><td>${TYP[a.typ] || esc(a.typ)}</td><td class="zahl">${fmt(a.p_nenn_mw)}</td><td class="zahl">${fmt(a.p_min_mw)}</td><td class="zahl">${fmt(a.rampe_mw_min)}</td><td class="zahl">${fmt(a.max_dauer_min, 0)}</td><td class="zahl">${fmt(a.erholzeit_min, 0)}</td><td class="zahl">${fmt(a.puffer_mwh, 1)}</td><td class="zahl">${fmt(a.anteil_prozent, 0)}</td><td class="zahl">${a.plan_grenze_t_h == null ? '<span class="aus">none</span>' : fmt(a.plan_grenze_t_h, 0)}</td><td class="umbruch">${(a.laufzeiten || []).join(', ') || '<span class="aus">none</span>'}</td><td class="zahl">${a.prioritaet}</td><td>${a.aktiv ? 'yes' : 'no'}</td>`;
    tr.addEventListener('click', () => anlageDialog(a));
    tb.appendChild(tr);
  }
  if (st && !st.anlagen.length) tb.innerHTML = '<tr><td colspan="13" class="aus">No asset yet.</td></tr>';
  zeichneFenster(st ? st.fenster : []);
}
$('#standort-form').addEventListener('submit', e => { e.preventDefault(); versuchen(async () => {
  if (!S.sid) throw new Error('No site selected');
  const d = {};
  for (const el of e.target.elements) { if (!el.name) continue; d[el.name] = el.type === 'number' ? Number(el.value || 0) : el.value; }
  await api(`/api/standorte/${S.sid}`, { method: 'PUT', json: d });
  await ladeStandorte(S.sid);
  melden('Site saved.', 'ok');
}); });
$('#standort-loeschen').addEventListener('click', () => versuchen(async () => {
  if (!S.sid || !confirm(`Delete site "${S.standort.name}" with all its data?`)) return;
  await api(`/api/standorte/${S.sid}`, { method: 'DELETE' });
  S.sid = null; await ladeStandorte(); melden('Site deleted.', 'ok');
}));
$('#lastgang-form').addEventListener('submit', e => { e.preventDefault(); versuchen(async () => {
  if (!S.sid) throw new Error('No site selected');
  const r = await api(`/api/standorte/${S.sid}/lastgang`, { method: 'POST', form: new FormData(e.target) });
  melden(`${fmt(r.zeilen, 0)} quarter hours imported, from ${zeitText(r.von)} to ${zeitText(r.bis)}${r.temperatur ? ', with temperature' : ', without temperature'}.`, 'ok');
  e.target.reset(); await ladeStandorte(S.sid);
}); });

// Asset dialog
let anlageAktuell = null;
$('#anlage-neu').addEventListener('click', () => { if (!S.sid) return melden('Create a site first.', 'fehler'); anlageDialog(null); });
function anlageDialog(a) {
  anlageAktuell = a;
  const f = $('#anlage-form');
  $('#anlage-dlg-titel').textContent = a ? `Asset: ${a.name}` : 'New asset';
  $('#anlage-loeschen').classList.toggle('hidden', !a);
  const werte = a || { name: '', typ: 'kaelte', p_nenn_mw: '', p_min_mw: 0, rampe_mw_min: 0.1, max_dauer_min: 60, erholzeit_min: 60, puffer_mwh: 0, anteil_prozent: 0, plan_grenze_t_h: null, laufzeiten: [], prioritaet: (S.standort?.anlagen?.length || 0) + 1, aktiv: 1, notiz: '' };
  for (const el of f.elements) {
    if (!el.name) continue;
    if (el.name === 'aktiv') el.checked = !!werte.aktiv;
    else if (el.name === 'laufzeiten') el.value = (werte.laufzeiten || []).join(', ');
    else el.value = werte[el.name] ?? '';
  }
  $('#anlage-dlg').showModal();
}
$('#anlage-abbruch').addEventListener('click', () => $('#anlage-dlg').close());
$('#anlage-loeschen').addEventListener('click', () => versuchen(async () => {
  if (!anlageAktuell || !confirm(`Delete asset "${anlageAktuell.name}"?`)) return;
  await api(`/api/anlagen/${anlageAktuell.id}`, { method: 'DELETE' });
  $('#anlage-dlg').close(); await ladeStandorte(S.sid); melden('Asset deleted.', 'ok');
}));
$('#anlage-form').addEventListener('submit', e => { e.preventDefault(); versuchen(async () => {
  const f = e.target; const d = {};
  for (const el of f.elements) {
    if (!el.name) continue;
    if (el.name === 'aktiv') d.aktiv = el.checked;
    else if (el.name === 'laufzeiten') d.laufzeiten = el.value.split(',').map(s => s.trim()).filter(Boolean);
    else if (el.name === 'plan_grenze_t_h') d.plan_grenze_t_h = el.value === '' ? null : Number(el.value);
    else if (el.type === 'number') d[el.name] = Number(el.value || 0);
    else d[el.name] = el.value;
  }
  if (anlageAktuell) await api(`/api/anlagen/${anlageAktuell.id}`, { method: 'PUT', json: d });
  else await api(`/api/standorte/${S.sid}/anlagen`, { method: 'POST', json: d });
  $('#anlage-dlg').close(); await ladeStandorte(S.sid); melden('Asset saved.', 'ok');
}); });

// Release windows
function zeichneFenster(liste) {
  const tb = $('#fenster-tabelle tbody'); tb.innerHTML = '';
  for (const f of liste) fensterZeile(f);
  if (!liste.length) tb.innerHTML = '<tr class="leer"><td colspan="6" class="aus">No release window, so no flexibility. Please add windows.</td></tr>';
}
function fensterZeile(f) {
  const tb = $('#fenster-tabelle tbody');
  tb.querySelector('tr.leer')?.remove();
  const tr = document.createElement('tr');
  tr.innerHTML = `<td><select name="wochentag">${WOCHENTAGE.map((w, i) => `<option value="${i}" ${i === Number(f.wochentag) ? 'selected' : ''}>${w}</option>`).join('')}</select></td>
    <td><input type="time" name="von" value="${esc(f.von)}" step="900"></td><td><input type="time" name="bis" value="${esc(f.bis === '24:00' ? '23:59' : f.bis)}" step="900"></td>
    <td><input type="number" name="p_pos_max_mw" step="0.1" min="0" value="${f.p_pos_max_mw ?? ''}"></td><td><input type="number" name="p_neg_max_mw" step="0.1" min="0" value="${f.p_neg_max_mw ?? ''}"></td>
    <td><button type="button" class="btn btn-sm">Remove</button></td>`;
  tr.querySelector('button').addEventListener('click', () => tr.remove());
  tb.appendChild(tr);
}
$('#fenster-zeile').addEventListener('click', () => fensterZeile({ wochentag: 0, von: '00:00', bis: '23:59', p_pos_max_mw: '', p_neg_max_mw: '' }));
$('#fenster-speichern').addEventListener('click', () => versuchen(async () => {
  if (!S.sid) throw new Error('No site selected');
  const liste = $$('#fenster-tabelle tbody tr').filter(tr => tr.querySelector('select')).map(tr => {
    const g = n => tr.querySelector(`[name=${n}]`).value;
    let bis = g('bis'); if (bis === '23:59') bis = '24:00';
    return { wochentag: Number(g('wochentag')), von: g('von'), bis, p_pos_max_mw: g('p_pos_max_mw') === '' ? null : Number(g('p_pos_max_mw')), p_neg_max_mw: g('p_neg_max_mw') === '' ? null : Number(g('p_neg_max_mw')) };
  });
  await api(`/api/standorte/${S.sid}/fenster`, { method: 'PUT', json: liste });
  await ladeStandorte(S.sid); melden('Release windows saved.', 'ok');
}));

// ------------------------------------------------------------ Day-ahead schedule
$('#datum').addEventListener('change', e => { S.datum = e.target.value; speicher('datum', S.datum); S.fp = null; ladeFahrplan(); });
$('#neu-rechnen').addEventListener('click', () => ladeFahrplan(true));

async function ladeFahrplan(neu = false) {
  if (!S.sid) { zeichneFahrplan(); return; }
  await versuchen(async () => {
    if (S.fp && !neu && S.fp.datum === S.datum) { zeichneFahrplan(); return; }
    S.fp = await api(`/api/standorte/${S.sid}/fahrplan?datum=${S.datum}&neu=${neu ? 1 : 0}`);
    S.plan = await api(`/api/standorte/${S.sid}/plan?datum=${S.datum}`);
    S.qh = null;
    zeichneFahrplan();
    if (neu) melden('Schedule recomputed. It is a draft again.', 'ok');
  });
}

function zeichneFahrplan() {
  const fp = S.fp;
  $('#fahrplan-leer').classList.toggle('hidden', !!fp);
  $('#fahrplan-body').classList.toggle('hidden', !fp);
  if (!fp) { $('#status-pille').textContent = 'no schedule'; $('#freigabe-aktionen').innerHTML = ''; return; }
  const z = fp.zusammenfassung;
  $('#kacheln').innerHTML = [
    kachel('Load reduction, marketable (P10)', `${fmt(z.pos_max_p10)} <small>MW</small>`, `highest value at ${z.pos_max_p10_um}, ${fmt(z.pos_stunden_p10, 2)} hours with at least 0.5 MW`),
    kachel('Load increase, marketable (P10)', `${fmt(z.neg_max_p10)} <small>MW</small>`, `highest value at ${z.neg_max_p10_um}, ${fmt(z.neg_stunden_p10, 2)} hours with at least 0.5 MW`),
    kachel('Expected peak load', `${fmt(z.last_max_p50)} <small>MW</small>`, `daily energy ${fmt(z.last_energie_p50_mwh, 1)} MWh`),
    kachel('Value hint', z.werthinweis_eur == null ? 'no price' : `${fmt(z.werthinweis_eur, 0)} <small>EUR</small>`, z.werthinweis_text),
  ].join('');
  $('#hinweise').innerHTML = (z.hinweise || []).map(h => `<li>${esc(h)}</li>`).join('');
  zeichnePlanTabelle();
  zeichneHeatmap();
  zeichneFlexChart();
  zeichneLastChart();
  zeichneBloecke();
  zeichneErklaerung();
  zeichneTabelle96();
  const posArr = fp.zeilen.map(r => r.pos.p10);
  waehleQh(S.qh ?? posArr.indexOf(Math.max(...posArr)));
  zeichneFreigabe();
  $('#export-csv').href = `/api/standorte/${S.sid}/fahrplan/${fp.datum}/export.csv`;
  $('#export-json').href = `/api/standorte/${S.sid}/fahrplan/${fp.datum}/export.json`;
  const frei = fp.freigabe.status === 'freigegeben';
  $('#export-verf').href = `/api/standorte/${S.sid}/fahrplan/${fp.datum}/verfuegbarkeit.csv`;
  $('#export-verf').setAttribute('aria-disabled', frei ? 'false' : 'true');
  $('#export-verf').title = frei ? 'Availability report for the pool operator' : 'Only after approval by production management';
}
function kachel(titel, wert, ziel, klasse = '') {
  return `<div class="kachel ${klasse}"><div>${esc(titel)}</div><div class="wert">${wert}</div><div class="ziel">${esc(ziel)}</div></div>`;
}

// Approval workflow
function zeichneFreigabe() {
  const f = S.fp.freigabe; const st = f.status;
  const p = $('#status-pille'); p.textContent = STATUS[st] || st; p.className = 'pille ' + st;
  const stand = [['Status', STATUS[st] || st], ['Computed', zeitText(f.erstellt)]];
  if (f.angefordert_von) stand.push(['Requested', `by ${f.angefordert_von} on ${zeitText(f.angefordert_am)}`]);
  if (f.entschieden_von) stand.push([st === 'freigegeben' ? 'Approved' : 'Rejected', `by ${f.entschieden_von} on ${zeitText(f.entschieden_am)}`]);
  if (f.kommentar) stand.push(['Comment', f.kommentar]);
  $('#freigabe-stand').innerHTML = stand.map(([k, v]) => `<span>${esc(k)}</span><span>${esc(v)}</span>`).join('');
  p.title = stand.map(([k, v]) => `${k}: ${v}`).join('\n');
  const box = $('#freigabe-aktionen'); box.innerHTML = '';
  const knopf = (text, aktion, klasse = 'btn') => { const b = document.createElement('button'); b.className = klasse; b.textContent = text; b.addEventListener('click', () => freigabeDialog(aktion)); box.appendChild(b); };
  if (st === 'entwurf') knopf('Request approval', 'anfordern', 'btn btn-primary');
  if (st === 'angefordert') { knopf('Approve', 'freigeben', 'btn btn-primary'); knopf('Reject', 'ablehnen'); }
  if (st !== 'entwurf') knopf('Back to draft', 'zuruecksetzen');
}
const FREIGABE_TEXT = {
  anfordern: ['Request approval', 'The schedule goes to production management. Who is requesting?'],
  freigeben: ['Approve schedule', 'With the approval, production management confirms that the power may be called on this day in the stated times. After that the availability report can go to the pool operator.'],
  ablehnen: ['Reject schedule', 'Please say in the comment what needs to change.'],
};
function freigabeDialog(aktion) {
  if (aktion === 'zuruecksetzen') return versuchen(async () => { S.fp = await api(`/api/standorte/${S.sid}/fahrplan/${S.fp.datum}/freigabe`, { method: 'POST', json: { aktion, name: '', kommentar: '' } }); zeichneFahrplan(); });
  const [titel, text] = FREIGABE_TEXT[aktion];
  $('#freigabe-titel').textContent = titel; $('#freigabe-text').textContent = text;
  const f = $('#freigabe-form'); f.dataset.aktion = aktion; f.elements.name.value = lesen('name') || ''; f.elements.kommentar.value = '';
  $('#freigabe-dlg').showModal();
}
$('#freigabe-abbruch').addEventListener('click', () => $('#freigabe-dlg').close());
$('#freigabe-form').addEventListener('submit', e => { e.preventDefault(); versuchen(async () => {
  const f = e.target; speicher('name', f.elements.name.value);
  S.fp = await api(`/api/standorte/${S.sid}/fahrplan/${S.fp.datum}/freigabe`, { method: 'POST', json: { aktion: f.dataset.aktion, name: f.elements.name.value, kommentar: f.elements.kommentar.value } });
  $('#freigabe-dlg').close(); zeichneFahrplan();
  melden(`Status now: ${STATUS[S.fp.freigabe.status]}.`, 'ok');
}); });

// Production plan
function zeichnePlanTabelle() {
  const tb = $('#plan-tabelle tbody'); tb.innerHTML = '';
  const stunden = S.plan?.stunden || Array.from({ length: 24 }, (_, h) => ({ von: `${String(h).padStart(2, '0')}:00`, schicht: '', wareneingang_t: 0, sperre: '' }));
  for (const s of stunden) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${s.von}</td><td><select name="schicht">${SCHICHTEN.map(o => `<option value="${o}" ${o === s.schicht ? 'selected' : ''}>${o || 'not specified'}</option>`).join('')}</select></td><td><input type="number" name="wareneingang_t" min="0" step="1" value="${s.wareneingang_t}"></td><td><input type="text" name="sperre" value="${esc(s.sperre)}" placeholder="asset or all"></td>`;
    tb.appendChild(tr);
  }
}
function planZeilen() {
  return $$('#plan-tabelle tbody tr').map(tr => ({ von: tr.firstChild.textContent, schicht: tr.querySelector('[name=schicht]').value, wareneingang_t: Number(tr.querySelector('[name=wareneingang_t]').value || 0), sperre: tr.querySelector('[name=sperre]').value }));
}
$('#plan-speichern').addEventListener('click', () => versuchen(async () => {
  await api(`/api/standorte/${S.sid}/plan?datum=${S.datum}`, { method: 'PUT', json: planZeilen() });
  await ladeFahrplan(true);
}));
$('#plan-werktag').addEventListener('click', () => {
  $$('#plan-tabelle tbody tr').forEach((tr, h) => {
    tr.querySelector('[name=schicht]').value = h >= 5 && h < 13 ? 'Early' : h >= 13 && h < 21 ? 'Late' : 'Night';
    tr.querySelector('[name=wareneingang_t]').value = h >= 5 && h < 9 ? 55 : h >= 13 && h < 17 ? 40 : 0;
  });
});
$('#plan-leer').addEventListener('click', () => { $$('#plan-tabelle tbody tr').forEach(tr => { tr.querySelector('[name=schicht]').value = ''; tr.querySelector('[name=wareneingang_t]').value = 0; tr.querySelector('[name=sperre]').value = ''; }); });
$('#plan-upload').addEventListener('submit', e => { e.preventDefault(); versuchen(async () => {
  const r = await api(`/api/standorte/${S.sid}/plan/upload`, { method: 'POST', form: new FormData(e.target) });
  melden(`Plan imported: ${fmt(r.zeilen, 0)} quarter hours from ${zeitText(r.von)} to ${zeitText(r.bis)}.`, 'ok');
  e.target.reset(); await ladeFahrplan(true);
}); });

// Heatmap
function rampenFarbe(v, max, rampe) {
  if (!v || v <= 0 || !max) return 'var(--panel2)';
  const k = Math.min(rampe.length - 1, Math.floor((v / max) * rampe.length));
  return rampe[k];
}
function zeichneHeatmap() {
  const fp = S.fp; const box = $('#heatmap'); box.innerHTML = '';
  const maxPos = Math.max(0.01, ...fp.zeilen.map(r => r.pos.p10));
  const maxNeg = Math.max(0.01, ...fp.zeilen.map(r => r.neg.p10));
  const kopf = document.createElement('div'); kopf.className = 'zeilenname'; box.appendChild(kopf);
  const st = document.createElement('div'); st.className = 'stunden'; st.innerHTML = Array.from({ length: 24 }, (_, h) => `<span>${h}</span>`).join(''); box.appendChild(st);
  for (const [name, richtung, max, rampe] of [['Load reduction P10', 'pos', maxPos, RAMPE_BLAU], ['Load increase P10', 'neg', maxNeg, RAMPE_ORANGE]]) {
    const n = document.createElement('div'); n.className = 'zeilenname'; n.textContent = name; box.appendChild(n);
    const z = document.createElement('div'); z.className = 'zellen';
    fp.zeilen.forEach((r, i) => {
      const b = document.createElement('button'); b.className = 'zelle'; b.dataset.i = i;
      b.style.background = rampenFarbe(r[richtung].p10, max, rampe);
      b.title = `${r.von} to ${r.bis}: ${fmt(r[richtung].p10)} MW marketable, expected ${fmt(r[richtung].p50)} MW, product ${r[richtung].produkt}, limit: ${GRUND[r[richtung].begrenzung]}`;
      b.addEventListener('click', () => waehleQh(i));
      z.appendChild(b);
    });
    box.appendChild(z);
  }
  const leg = document.createElement('div'); leg.className = 'legende';
  leg.innerHTML = `<span>Load reduction 0 to ${fmt(maxPos)} MW</span><span class="rampe">${RAMPE_BLAU.map(c => `<i style="background:${c}"></i>`).join('')}</span><span>Load increase 0 to ${fmt(maxNeg)} MW</span><span class="rampe">${RAMPE_ORANGE.map(c => `<i style="background:${c}"></i>`).join('')}</span><span>No colour: 0 MW</span>`;
  box.appendChild(leg);
}
function waehleQh(i, springen = false) {
  S.qh = i;
  if (springen) zeigeUntertab('fp', 'fp-plan');
  $$('#heatmap .zelle').forEach(b => b.classList.toggle('gewaehlt', Number(b.dataset.i) === i));
  $$('#tabelle96 tbody tr').forEach((tr, k) => tr.classList.toggle('gewaehlt', k === i));
  zeichneDetail(i);
}

// Detail of one quarter hour
function zeichneDetail(i) {
  const r = S.fp.zeilen[i];
  $('#detail-titel').textContent = `Quarter hour ${r.von} to ${r.bis}`;
  const richtung = (name, d, feld) => {
    const prod = d.produkte;
    return `<h3>${name}</h3>
      <div class="kv">
        <span>Expected (P50)</span><span>${fmt(d.p50)} MW</span>
        <span>Marketable (P10)</span><span><b>${fmt(d.p10)} MW</b>, confidence ${d.konfidenz}</span>
        <span>Sustainable</span><span>15 min: ${fmt(d.haltbar['15'])} MW, 1 hour: ${fmt(d.haltbar['60'])} MW, 4 hours: ${fmt(d.haltbar['240'])} MW</span>
        <span>Full power sustainable</span><span>${d.dauer_min == null ? '<span class="aus">no power</span>' : fmt(d.dauer_min, 0) + ' min'}</span>
        <span>Products (P10)</span><span>aFRR ${fmt(prod.aFRR.p10)} MW, mFRR ${fmt(prod.mFRR.p10)} MW, intraday 15 min ${fmt(prod['Intraday 15 min'].p10)} MW</span>
        <span>Largest limit</span><span>${GRUND[d.begrenzung]}${d.begrenzt_durch.length ? ' at ' + d.begrenzt_durch.map(esc).join(', ') : ''}</span>
      </div>
      <div class="tablewrap"><table class="tabelle"><thead><tr><th>Asset</th><th class="zahl">Expected load</th><th class="zahl">Technical</th><th class="zahl">Plan</th><th class="zahl">Buffer</th><th class="zahl">Release</th><th class="zahl">Result</th><th class="zahl">Duration min</th><th class="zahl">Full after min</th><th>Products</th><th>Reason</th></tr></thead><tbody>
      ${r.anlagen.map(a => { const x = a[feld]; return `<tr><td>${esc(a.name)}</td><td class="zahl">${fmt(a.p_ist)}</td><td class="zahl">${fmt(x.technisch)}</td><td class="zahl">${fmt(x.prozessual)}</td><td class="zahl">${fmt(x.energetisch)}</td><td class="zahl">${fmt(x.vertraglich)}</td><td class="zahl"><b>${fmt(x.wert)}</b></td><td class="zahl">${x.dauer_min == null ? '' : fmt(x.dauer_min, 0)}</td><td class="zahl">${x.t_voll_min == null ? '' : fmt(x.t_voll_min, 1)}</td><td>${x.produkte.join(', ') || '<span class="aus">none</span>'}</td><td class="grund" title="${esc(x.gruende.join('\n'))}">${esc(x.gruende[0] || GRUND[x.grund])}</td></tr>`; }).join('')}
      </tbody></table></div>`;
  };
  $('#detail').innerHTML = `<div class="kv">
      <span>Expected load</span><span>${fmt(r.last_p50)} MW, band ${fmt(r.last_p10)} to ${fmt(r.last_p90)} MW</span>
      <span>Temperature</span><span>${fmt(r.temp_c, 1)} degrees</span>
      <span>Production plan</span><span>${r.schicht ? 'shift ' + esc(r.schicht) + ', ' : ''}goods intake ${fmt(r.wareneingang_t, 0)} t/h${r.sperre ? ', block: ' + esc(r.sperre) : ''}</span>
      <span>Day-ahead price</span><span>${r.preis_eur_mwh == null ? '<span class="aus">no price available</span>' : fmt(r.preis_eur_mwh) + ' EUR/MWh'}</span>
    </div>` + richtung('Load reduction', r.pos, 'pos') + richtung('Load increase', r.neg, 'neg');
}

function zeichneBloecke() {
  $('#bloecke tbody').innerHTML = S.fp.bloecke.map(b => `<tr><td>${b.von} to ${b.bis}</td><td class="zahl">${fmt(b.pos.p10_min)}</td><td class="zahl">${fmt(b.pos.aFRR)}</td><td class="zahl">${fmt(b.pos.mFRR)}</td><td class="zahl">${fmt(b.neg.p10_min)}</td><td class="zahl">${fmt(b.neg.aFRR)}</td><td class="zahl">${fmt(b.neg.mFRR)}</td></tr>`).join('');
}
function zeichneErklaerung() {
  const b = S.fp.baseline; const regeln = S.fp.produkte_regeln;
  $('#prognose-erklaerung').innerHTML = `<div class="kv">
    <span>Method</span><span>${b.methode === 'lightgbm' ? 'LightGBM quantile regression' : 'Day-type profile with correction'}</span>
    <span>Day type</span><span>${TYPTAG[b.typtag] || esc(b.typtag)}, ${b.tage_im_profil} days in the profile${b.wochen ? ' of the last ' + b.wochen + ' weeks' : ''}</span>
    ${b.mw_je_grad != null ? `<span>Temperature</span><span>${fmt(b.mw_je_grad, 3)} MW per degree warmer</span><span>Goods intake</span><span>${fmt(b.mw_je_t_h, 4)} MW per ton per hour</span>` : ''}
    <span>Band P10 to P90</span><span>from ${esc(b.band_quelle)}</span>
    <span>Product rules</span><span>${regeln.map(r => `${r.name}: full power after ${fmt(r.t_voll_min, 1)} min, sustainable at least ${fmt(r.dauer_min, 0)} min`).join('<br>')}</span>
    <span>Buffer state</span><span>${fmt(S.fp.standort.puffer_start_prozent, 0)} percent of the buffer for load reduction, the rest for load increase</span>
  </div>`;
}
function zeichneTabelle96() {
  const tb = $('#tabelle96 tbody');
  tb.innerHTML = S.fp.zeilen.map((r, i) => `<tr class="klick" data-i="${i}"><td>${r.von}</td><td class="zahl">${fmt(r.last_p50)}</td><td class="zahl">${fmt(r.pos.p50)}</td><td class="zahl">${fmt(r.pos.p10)}</td><td class="zahl">${fmt(r.pos.haltbar['15'])}</td><td class="zahl">${fmt(r.pos.haltbar['60'])}</td><td class="zahl">${fmt(r.pos.haltbar['240'])}</td><td>${r.pos.produkt}</td><td>${r.pos.konfidenz}</td><td>${GRUND[r.pos.begrenzung]}</td><td class="zahl">${fmt(r.neg.p50)}</td><td class="zahl">${fmt(r.neg.p10)}</td><td>${r.neg.produkt}</td><td class="zahl">${fmt(r.preis_eur_mwh)}</td></tr>`).join('');
  tb.querySelectorAll('tr').forEach(tr => tr.addEventListener('click', () => waehleQh(Number(tr.dataset.i), true)));
}

// ------------------------------------------------------------------- Charts
const tooltip = $('#tooltip');
function tipZeigen(html, ev) { tooltip.innerHTML = html; tooltip.classList.remove('hidden'); const x = Math.min(ev.clientX + 14, window.innerWidth - tooltip.offsetWidth - 8); tooltip.style.left = x + 'px'; tooltip.style.top = (ev.clientY + 14) + 'px'; }
function tipWeg() { tooltip.classList.add('hidden'); }
function schoenMax(m) { if (m <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(m))); const f = m / p; const s = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10; return s * p; }
function svgEl(tag, attrs = {}) { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }

/* Line chart: serien [{name, werte, farbe, gestrichelt}], baender [{name, oben, unten, farbe}], x labels per point, bereiche [{von, bis, farbe, name}], hlinien [{wert, text}] */
function linienChart(el, cfg) {
  el.innerHTML = '';
  const W = cfg.W || 640, H = cfg.H || 250, L = 46, R = 12, T = 12, B = 28;
  const n = cfg.x.length;
  let max = 0, min = 0;
  for (const s of cfg.serien) for (const v of s.werte) if (v != null) { max = Math.max(max, v); min = Math.min(min, v); }
  for (const b of cfg.baender || []) for (const v of b.oben) if (v != null) max = Math.max(max, v);
  max = schoenMax(max * 1.05);
  const X = i => L + (i / (n - 1)) * (W - L - R);
  const Y = v => T + (1 - (v - min) / (max - min)) * (H - T - B);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const ticks = 5;
  for (let k = 0; k <= ticks; k++) {
    const v = min + (max - min) * k / ticks; const y = Y(v);
    svg.appendChild(svgEl('line', { x1: L, x2: W - R, y1: y, y2: y, stroke: k === 0 ? '#c3c2b7' : '#e1e0d9', 'stroke-width': 1 }));
    const t = svgEl('text', { x: L - 6, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#1d1f20' }); t.textContent = fmt(v, max - min >= 5 ? 0 : 1); svg.appendChild(t);
  }
  for (const b of cfg.bereiche || []) {
    svg.appendChild(svgEl('rect', { x: X(b.von), y: T, width: X(Math.min(b.bis, n - 1)) - X(b.von), height: H - T - B, fill: b.farbe || '#f0efec', opacity: b.farbe ? 0.14 : 1 }));
  }
  for (const h of cfg.hlinien || []) {
    if (h.wert < min || h.wert > max) continue;
    const y = Y(h.wert);
    svg.appendChild(svgEl('line', { x1: L, x2: W - R, y1: y, y2: y, stroke: '#1d1f20', 'stroke-width': 1, 'stroke-dasharray': '5 4' }));
    if (h.text) { const t = svgEl('text', { x: W - R - 4, y: y - 5, 'text-anchor': 'end', 'font-size': 11, fill: '#1d1f20' }); t.textContent = h.text; svg.appendChild(t); }
  }
  const schritt = cfg.xSchritt || Math.max(1, Math.round(n / 8));
  for (let i = 0; i < n; i += schritt) { const t = svgEl('text', { x: X(i), y: H - 8, 'text-anchor': 'middle', 'font-size': 11, fill: '#1d1f20' }); t.textContent = cfg.x[i]; svg.appendChild(t); }
  for (const b of cfg.baender || []) {
    let d = ''; b.oben.forEach((v, i) => { d += (i ? 'L' : 'M') + X(i) + ' ' + Y(v ?? 0); });
    for (let i = n - 1; i >= 0; i--) d += 'L' + X(i) + ' ' + Y(b.unten[i] ?? 0);
    svg.appendChild(svgEl('path', { d: d + 'Z', fill: b.farbe, opacity: 0.12 }));
  }
  for (const s of cfg.serien) {
    let d = '', offen = false;
    s.werte.forEach((v, i) => { if (v == null) { offen = false; return; } d += (offen ? 'L' : 'M') + X(i) + ' ' + Y(v); offen = true; });
    svg.appendChild(svgEl('path', { d, fill: 'none', stroke: s.farbe, 'stroke-width': s.breite || 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': s.gestrichelt ? '4 4' : '' }));
  }
  const kreuz = svgEl('line', { x1: 0, x2: 0, y1: T, y2: H - B, stroke: '#1d1f20', 'stroke-width': 1, opacity: 0 });
  svg.appendChild(kreuz);
  const punkte = cfg.serien.map(s => { const c = svgEl('circle', { r: 4, fill: s.farbe, stroke: '#fcfcfb', 'stroke-width': 2, opacity: 0 }); svg.appendChild(c); return c; });
  const fang = svgEl('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' });
  fang.addEventListener('mousemove', ev => {
    const r = svg.getBoundingClientRect(); const px = (ev.clientX - r.left) / r.width * W;
    const i = Math.max(0, Math.min(n - 1, Math.round((px - L) / (W - L - R) * (n - 1))));
    kreuz.setAttribute('x1', X(i)); kreuz.setAttribute('x2', X(i)); kreuz.setAttribute('opacity', 1);
    cfg.serien.forEach((s, k) => { const v = s.werte[i]; punkte[k].setAttribute('opacity', v == null ? 0 : 1); if (v != null) { punkte[k].setAttribute('cx', X(i)); punkte[k].setAttribute('cy', Y(v)); } });
    let html = `<b>${cfg.x[i]}${cfg.xVoll ? ' ' + cfg.xVoll(i) : ''}</b>`;
    for (const s of cfg.serien) html += `<br>${esc(s.name)}: ${s.werte[i] == null ? 'no value' : fmt(s.werte[i]) + ' ' + (cfg.einheit || '')}`;
    for (const b of cfg.baender || []) html += `<br>${esc(b.name)}: ${fmt(b.unten[i])} to ${fmt(b.oben[i])} ${cfg.einheit || ''}`;
    if (cfg.extra) html += cfg.extra(i);
    tipZeigen(html, ev);
  });
  fang.addEventListener('mouseleave', () => { kreuz.setAttribute('opacity', 0); punkte.forEach(p => p.setAttribute('opacity', 0)); tipWeg(); });
  if (cfg.klick) fang.addEventListener('click', ev => { const r = svg.getBoundingClientRect(); const px = (ev.clientX - r.left) / r.width * W; cfg.klick(Math.max(0, Math.min(n - 1, Math.round((px - L) / (W - L - R) * (n - 1))))); });
  svg.appendChild(fang);
  el.appendChild(svg);
  const leg = document.createElement('div'); leg.className = 'legende';
  const bereichNamen = [];
  for (const b of cfg.bereiche || []) if (b.name && !bereichNamen.some(x => x.name === b.name)) bereichNamen.push(b);
  leg.innerHTML = cfg.serien.map(s => `<span><i style="${s.gestrichelt ? `background:repeating-linear-gradient(90deg,${s.farbe} 0 4px,transparent 4px 7px)` : `background:${s.farbe}`}"></i>${esc(s.name)}</span>`).join('') + (cfg.baender || []).map(b => `<span><i class="flaeche" style="background:${b.farbe}"></i>${esc(b.name)}</span>`).join('') + bereichNamen.map(b => `<span><i class="flaeche" style="background:${b.farbe || '#c3c2b7'}"></i>${esc(b.name)}</span>`).join('') + (cfg.hlinien || []).filter(h => h.text).map(h => `<span><i style="background:repeating-linear-gradient(90deg,#1d1f20 0 5px,transparent 5px 9px)"></i>${esc(h.text)}</span>`).join('');
  el.appendChild(leg);
}

/* Column chart: werte, labels, farbe, tooltip(i), klick(i), markiert (index), linie (reference value) */
function saeulenChart(el, cfg) {
  el.innerHTML = '';
  const W = 640, H = 220, L = 46, R = 12, T = 12, B = 28;
  const n = cfg.werte.length;
  const max = schoenMax(Math.max(0.0001, ...cfg.werte) * 1.05);
  const band = (W - L - R) / n; const breite = Math.min(24, Math.max(2, band - 2));
  const Y = v => T + (1 - v / max) * (H - T - B);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  for (let k = 0; k <= 4; k++) {
    const v = max * k / 4; const y = Y(v);
    svg.appendChild(svgEl('line', { x1: L, x2: W - R, y1: y, y2: y, stroke: k === 0 ? '#c3c2b7' : '#e1e0d9', 'stroke-width': 1 }));
    const t = svgEl('text', { x: L - 6, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#1d1f20' }); t.textContent = fmt(v, max >= 20 ? 0 : max >= 2 ? 1 : 2); svg.appendChild(t);
  }
  if (cfg.linie != null && cfg.linie <= max) { const y = Y(cfg.linie); svg.appendChild(svgEl('line', { x1: L, x2: W - R, y1: y, y2: y, stroke: '#1d1f20', 'stroke-width': 1, 'stroke-dasharray': '4 3' })); const t = svgEl('text', { x: W - R, y: y - 4, 'text-anchor': 'end', 'font-size': 11, fill: '#1d1f20' }); t.textContent = cfg.linieText || ''; svg.appendChild(t); }
  const schritt = cfg.xSchritt || Math.max(1, Math.round(n / 8));
  cfg.werte.forEach((v, i) => {
    const x = L + band * i + (band - breite) / 2; const y = Y(v); const h = H - B - y;
    const r = Math.min(4, breite / 2, h);
    const d = `M${x} ${H - B} V${y + r} a${r} ${r} 0 0 1 ${r} -${r} H${x + breite - r} a${r} ${r} 0 0 1 ${r} ${r} V${H - B} Z`;
    const p = svgEl('path', { d, fill: cfg.farbe, opacity: cfg.markiert === i ? 1 : 0.85 });
    if (cfg.markiert === i) p.setAttribute('stroke', '#1d1f20');
    const fang = svgEl('rect', { x: L + band * i, y: T, width: band, height: H - T - B, fill: 'transparent', cursor: cfg.klick ? 'pointer' : 'default' });
    fang.addEventListener('mousemove', ev => { p.setAttribute('opacity', 1); tipZeigen(cfg.tooltip(i), ev); });
    fang.addEventListener('mouseleave', () => { p.setAttribute('opacity', cfg.markiert === i ? 1 : 0.85); tipWeg(); });
    if (cfg.klick) fang.addEventListener('click', () => cfg.klick(i));
    svg.appendChild(p); svg.appendChild(fang);
    if (i % schritt === 0) { const t = svgEl('text', { x: L + band * i + band / 2, y: H - 8, 'text-anchor': 'middle', 'font-size': 11, fill: '#1d1f20' }); t.textContent = cfg.labels[i]; svg.appendChild(t); }
  });
  el.appendChild(svg);
}

function zeichneFlexChart() {
  const z = S.fp.zeilen;
  linienChart($('#chart-flex'), {
    x: z.map(r => r.von), xSchritt: 16, einheit: 'MW',
    serien: [
      { name: 'Load reduction marketable (P10)', werte: z.map(r => r.pos.p10), farbe: BLAU },
      { name: 'Load reduction expected (P50)', werte: z.map(r => r.pos.p50), farbe: BLAU, gestrichelt: true },
      { name: 'Load increase marketable (P10)', werte: z.map(r => r.neg.p10), farbe: ORANGE },
      { name: 'Load increase expected (P50)', werte: z.map(r => r.neg.p50), farbe: ORANGE, gestrichelt: true },
    ],
    extra: i => `<br>Product: ${z[i].pos.produkt}, limit: ${GRUND[z[i].pos.begrenzung]}`,
    klick: i => waehleQh(i, true),
  });
}
function zeichneLastChart() {
  const z = S.fp.zeilen;
  linienChart($('#chart-last'), {
    x: z.map(r => r.von), xSchritt: 16, einheit: 'MW',
    serien: [{ name: 'Expected load (P50)', werte: z.map(r => r.last_p50), farbe: BLAU }],
    baender: [{ name: 'Band P10 to P90', oben: z.map(r => r.last_p90), unten: z.map(r => r.last_p10), farbe: BLAU }],
    extra: i => `<br>Temperature ${fmt(z[i].temp_c, 1)} degrees, goods intake ${fmt(z[i].wareneingang_t, 0)} t/h`,
    klick: i => waehleQh(i, true),
  });
}

// ---------------------------------------------------------------- Accuracy
$('#genau-laden').addEventListener('click', () => ladeGenau());
$('#tag-datum').addEventListener('change', e => ladeTag(e.target.value));
async function ladeGenau() {
  if (!S.sid) { $('#genau-leer').classList.remove('hidden'); $('#genau-body').classList.add('hidden'); return; }
  await versuchen(async () => {
    melden('Running the backtest.');
    const tage = Number($('#genau-tage').value || 90);
    S.genau = await api(`/api/standorte/${S.sid}/genauigkeit?tage=${tage}`);
    S.abrufe = await api(`/api/standorte/${S.sid}/abrufe`);
    $('#meldung').classList.add('hidden');
    zeichneGenau();
  });
}
function zeichneGenau() {
  const g = S.genau, ab = S.abrufe;
  $('#genau-leer').classList.toggle('hidden', !!g);
  $('#genau-body').classList.toggle('hidden', !g);
  if (!g) return;
  if (!g.tage) { $('#genau-kacheln').innerHTML = ''; $('#genau-hinweis').textContent = g.hinweis; return; }
  const maeOk = g.mae_prozent_spitze != null && g.mae_prozent_spitze <= g.ziel_mae_prozent;
  const quoteOk = ab.quote_prozent != null && ab.quote_prozent >= ab.ziel_prozent;
  const bandOk = g.band_abdeckung_prozent != null && g.band_abdeckung_prozent >= 75;
  $('#genau-kacheln').innerHTML = [
    kachel('Baseline error (MAE)', `${fmt(g.mae_mw, 3)} <small>MW</small>`, `backtest ${g.tage} days from ${g.von} to ${g.bis}`),
    kachel('Error in percent of peak load', `${fmt(g.mae_prozent_spitze, 2)} <small>%</small>`, `target below ${fmt(g.ziel_mae_prozent, 0)} percent of ${fmt(g.spitzenlast_mw, 1)} MW`, maeOk ? 'gut' : 'schlecht'),
    kachel('Band P10 to P90 hits', g.band_abdeckung_prozent == null ? 'not testable' : `${fmt(g.band_abdeckung_prozent, 1)} <small>%</small>`, `target about ${fmt(g.band_soll_prozent, 0)} percent, undercut in ${fmt(g.band_unterschritten_prozent, 1)} percent`, bandOk ? 'gut' : ''),
    kachel('Delivery rate of calls', ab.quote_prozent == null ? 'no calls' : `${fmt(ab.quote_prozent, 1)} <small>%</small>`, `${ab.n} calls, target above ${fmt(ab.ziel_prozent, 0)} percent`, ab.quote_prozent == null ? '' : quoteOk ? 'gut' : 'schlecht'),
    kachel('Systematic deviation', `${fmt(g.bias_mw, 3)} <small>MW</small>`, 'actual minus forecast on average. Close to 0 is good, negative means forecast too high'),
  ].join('');
  $('#genau-hinweis').textContent = g.hinweis_temperatur;
  saeulenChart($('#chart-tage'), {
    werte: g.je_tag.map(t => t.mae_mw), labels: g.je_tag.map(t => t.datum.slice(5)), farbe: BLAU, xSchritt: Math.max(1, Math.round(g.je_tag.length / 9)),
    linie: g.spitzenlast_mw * g.ziel_mae_prozent / 100, linieText: 'target 5 % of peak load',
    tooltip: i => `<b>${g.je_tag[i].datum}</b> (${TYPTAG[g.je_tag[i].typ] || g.je_tag[i].typ})<br>error ${fmt(g.je_tag[i].mae_mw, 3)} MW<br>peak actual ${fmt(g.je_tag[i].ist_max)} MW, forecast ${fmt(g.je_tag[i].p50_max)} MW`,
    klick: i => { $('#tag-datum').value = g.je_tag[i].datum; zeigeUntertab('ge', 'ge-tag'); ladeTag(g.je_tag[i].datum); },
  });
  saeulenChart($('#chart-hist'), {
    werte: g.histogramm.map(h => h.n), labels: g.histogramm.map(h => fmt(h.von, 1)), farbe: BLAU, xSchritt: 4,
    tooltip: i => `<b>${fmt(g.histogramm[i].von, 2)} to ${fmt(g.histogramm[i].bis, 2)} MW</b><br>${g.histogramm[i].n} quarter hours`,
  });
  saeulenChart($('#chart-stunden'), {
    werte: g.je_stunde.map(h => h.mae_mw), labels: g.je_stunde.map(h => `${h.stunde}`), farbe: BLAU, xSchritt: 2,
    tooltip: i => `<b>${g.je_stunde[i].stunde} to ${g.je_stunde[i].stunde + 1} o'clock</b><br>error ${fmt(g.je_stunde[i].mae_mw, 3)} MW`,
  });
  const tb = $('#abrufe-tabelle tbody');
  tb.innerHTML = ab.abrufe.map(a => `<tr><td>${zeitText(a.start)}</td><td class="zahl">${fmt(a.dauer_min, 0)}</td><td>${a.richtung === 'pos' ? 'Load reduction' : 'Load increase'}</td><td class="zahl">${fmt(a.p_soll_mw)}</td><td class="zahl">${fmt(a.baseline_mw)}</td><td class="zahl">${fmt(a.ist_mw)}</td><td class="zahl">${fmt(a.geliefert_mw)}</td><td class="zahl">${a.erfuellung_prozent == null ? `<span class="aus">${esc(a.hinweis || 'not assessable')}</span>` : fmt(a.erfuellung_prozent, 1) + ' %'}</td></tr>`).join('') || '<tr><td colspan="8" class="aus">No calls recorded yet.</td></tr>';
  const tagFeld = $('#tag-datum');
  if (!tagFeld.value) tagFeld.value = g.je_tag[g.je_tag.length - 1].datum;
  ladeTag(tagFeld.value);
  $('#nachweis-von').value = $('#nachweis-von').value || g.von; $('#nachweis-bis').value = $('#nachweis-bis').value || g.bis;
  nachweisLink();
}
function nachweisLink() { if (S.sid) $('#nachweis-csv').href = `/api/standorte/${S.sid}/nachweis.csv?von=${$('#nachweis-von').value}&bis=${$('#nachweis-bis').value}`; }
$('#nachweis-von').addEventListener('change', nachweisLink); $('#nachweis-bis').addEventListener('change', nachweisLink);
async function ladeTag(datum) {
  await versuchen(async () => {
    const t = await api(`/api/standorte/${S.sid}/genauigkeit/tag?datum=${datum}`);
    $('#tag-titel').textContent = `Baseline against actual on ${datum}`;
    if (!t.zeilen.length) { $('#chart-tag').innerHTML = `<p>${esc(t.hinweis || 'No data.')}</p>`; return; }
    const bereiche = (t.abrufe || []).map(a => { const s = a.start.slice(11); const i = t.zeilen.findIndex(z => z.von === s); return i < 0 ? null : { von: i, bis: Math.min(95, i + Math.max(1, Math.round(a.dauer_min / 15))), text: `call ${fmt(a.p_soll_mw)} MW` }; }).filter(Boolean);
    linienChart($('#chart-tag'), {
      x: t.zeilen.map(z => z.von), xSchritt: 16, einheit: 'MW', bereiche,
      serien: [{ name: 'Actual', werte: t.zeilen.map(z => z.ist), farbe: BLAU }, { name: 'Baseline P50 (day-ahead)', werte: t.zeilen.map(z => z.p50), farbe: ORANGE }],
      baender: [{ name: 'Band P10 to P90', oben: t.zeilen.map(z => z.p90), unten: t.zeilen.map(z => z.p10), farbe: ORANGE }],
      extra: i => { const b = bereiche.find(x => i >= x.von && i < x.bis); return b ? `<br>${b.text}` : ''; },
    });
  });
}
$('#abruf-form').addEventListener('submit', e => { e.preventDefault(); versuchen(async () => {
  const f = new FormData(e.target);
  await api(`/api/standorte/${S.sid}/abrufe`, { method: 'POST', json: { start: String(f.get('start')).slice(0, 16), dauer_min: Number(f.get('dauer_min')), p_soll_mw: Number(f.get('p_soll_mw')), richtung: f.get('richtung'), quelle: 'Entry' } });
  melden('Call saved.', 'ok'); await ladeGenau();
}); });

// ----------------------------------------------------------------- Start
(async function start() {
  await versuchen(async () => {
    S.status = await api('/api/status');
    S.datum = lesen('datum') || S.status.folgetag;
    if (S.datum < S.status.heute) S.datum = S.status.folgetag;
    $('#datum').value = S.datum;
    const opt = $('#standort-form [name=baseline_methode] option[value=lightgbm]');
    if (!S.status.lightgbm) opt.textContent = 'LightGBM (not installed)';
    await ladeStandorte();
    zeigeView(lesen('view') || 'blick');
  });
})();
