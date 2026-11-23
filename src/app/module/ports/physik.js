// module/ports/physik – Karten der Bauteilerkennung im Tab „Ports & Lasten“: Ergebnis, Zuordnungsvorschlag und Profil.
import { level, pairWarning, physicsOf, samePairs, short } from '../../analyse/erkennung.js';
import { refreshNetwork } from '../../analyse/netzwerk.js';
import { actionButton, disabled, esc, icon, iconButton, textField, toast } from '../../basis/dom.js';
import { registerActions } from '../../basis/erweiterung.js';
import { metricText, portName, si } from '../../basis/format.js';
import { EN, lang, tx } from '../../basis/sprache.js';
import { state } from '../../basis/zustand.js';
import { configKey } from '../../dateien/sitzung.js';
import { Templates } from '../../dateien/vorlagen.js';

function applyPhysicsMapping(kind) {
  const physics = physicsOf(state.dataset);
  const mapping = physics?.mappings?.find(m => m.kind === kind);
  if (!mapping) return;
  const config = state.config;
  config.pairs = mapping.pairs.map(([p, q], i) => ({ p, q, id: i + 1 }));
  for (const [p, q] of mapping.pairs) { config.loads[p] = { type: 'active' }; config.loads[q] = { type: 'active' }; }
  state.pairIn = 1; state.pairOut = 2; state.pairDraft = null;
  state.sKeys.mm = null; state.basis = 'mm'; state.curveApply = true;
  const category = physics.verdict?.category;
  state.profile = { ...state.profile, source: 'physics', name: state.profile.name || (category && Magnetic.MAGNETIC.includes(category) ? Magnetic.SHORT[category] : ''), key: '' };
  refreshNetwork();
  toast(tx('Portzuordnung übernommen: ' + mapping.text, 'Port assignment applied: ' + mapping.en));
}

function physicsCard() {
  const ph = physicsOf(state.dataset);
  if (!ph || ph.status === 'not-applicable') return '';
  const hz = f => Magnetic.fmtHz(f, lang());
  const dec = (v, d) => EN() ? v.toFixed(d) : v.toFixed(d).replace('.', ',');
  let headline, tone = 'neutral';
  if (ph.status === 'insufficient-data' || ph.status === 'error') { headline = tx('Datenlage unzureichend', 'Insufficient data'); tone = 'warn'; }
  else if (ph.verdict.category && ph.verdict.level !== 'unklar') { headline = Magnetic.label(ph.verdict.category, lang()) + ' ' + level(ph.verdict.level); tone = ph.verdict.level === 'wahrscheinlich' ? 'good' : 'neutral'; }
  else if (ph.verdict.ranked?.length >= 2) headline = tx('Nicht eindeutig: ', 'Ambiguous: ') + short(ph.verdict.ranked[0].category) + tx(' oder ', ' or ') + short(ph.verdict.ranked[1].category);
  else headline = tx('Nicht eindeutig', 'Ambiguous');
  const f = ph.features || {};
  let metrics = '';
  if (ph.kind === 'four-port' && ph.windings) {
    metrics += metricText(tx('Wicklungspfade · ', 'Winding paths · ') + level(ph.windings.confidence), ph.windings.pairs.map(([a, b]) => portName(a) + '–' + portName(b)).join(' · '));
    if (Number.isFinite(f.L1)) {
      metrics += metricText(tx('L₁ · Wicklung 1', 'L₁ · winding 1'), si(f.L1, 'H')) + metricText(tx('L₂ · Wicklung 2', 'L₂ · winding 2'), si(f.L2, 'H')) +
        metricText(tx('k · Kopplung (', 'k · coupling (') + ({ gut: tx('gut', 'good'), 'eingeschränkt': tx('eingeschränkt', 'limited'), unsicher: tx('unsicher', 'uncertain') }[f.kQuality] || f.kQuality) + ')',
          dec(Math.abs(f.k), Math.abs(f.k) >= 0.999 ? 4 : 3) + (f.k < 0 ? tx(' (gegensinnig)', ' (opposite)') : '')) +
        metricText(tx('n · Windungsverhältnis', 'n · turns ratio'), '1 : ' + dec(f.n, 3)) +
        metricText(tx('tan δ · Kernverlust max.', 'tan δ · core loss max.'), Number.isFinite(f.tanMax) ? dec(f.tanMax, 2) : '–') +
        metricText(tx('f_res · Eigenresonanz', 'f_res · self-resonance'), Number.isFinite(f.srf) ? hz(f.srf) : '> ' + hz(ph.quality.fMax)) +
        metricText(tx('Sdc21 · Modenkonversion max.', 'Sdc21 · mode conversion max.'), Number.isFinite(f.sdcMax) ? dec(f.sdcMax, 1) + ' dB' : '–');
    }
  } else if (ph.kind === 'two-pole' && ph.status === 'candidate') {
    metrics += metricText(tx('Topologie', 'Topology'), ({ series: [tx('Serienelement', 'Series element')], shunt: [tx('Querelement', 'Shunt element')], 'one-port': [tx('Eintor', 'One-port')] }[ph.topology] || [tx('kein Zweipol', 'no two-pole')])[0]);
    if (Number.isFinite(f.L)) metrics += metricText(tx('L · Induktivität', 'L · inductance'), si(f.L, 'H'));
    if (Number.isFinite(f.C)) metrics += metricText(tx('C · Kapazität', 'C · capacitance'), si(f.C, 'F'));
    if (Number.isFinite(f.R)) metrics += metricText(tx('R · Widerstand', 'R · resistance'), si(f.R, 'Ω'));
    if (Number.isFinite(f.rDc)) metrics += metricText(tx('R · bei tiefer Frequenz', 'R · at low frequency'), si(f.rDc, 'Ω'));
    if (Number.isFinite(f.esr)) metrics += metricText('ESR', si(f.esr, 'Ω'));
    if ('srf' in f) metrics += metricText(tx('f_res · Eigenresonanz', 'f_res · self-resonance'), Number.isFinite(f.srf) ? hz(f.srf) : tx('nicht im Band', 'not in band'));
    if (Number.isFinite(f.qMax)) metrics += metricText(tx('Q · Güte max.', 'Q · quality factor max.'), f.qMax.toFixed(0));
  }
  const agree = { 'bestätigt': tx('passt zur Messung', 'matches the measurement'), widerspricht: tx('widerspricht der Messung', 'contradicts the measurement'), offen: tx('Messung nicht eindeutig', 'measurement ambiguous') };
  const maker = ph.manufacturer?.family ? '<p class="note physics-maker">' + tx('Herstellerangabe im Dateikopf: ', 'Manufacturer data in the file header: ') + '<strong>' + esc(ph.manufacturer.family + (ph.manufacturer.part ? ' ' + ph.manufacturer.part : '')) + '</strong>' +
    (ph.manufacturer.category ? ' → ' + esc(short(ph.manufacturer.category)) + (ph.agreement ? ' · ' + esc(agree[ph.agreement]) : '') : '') + '</p>' : '';
  const current = state.config.pairs.map(pair => [pair.p, pair.q]);
  const buttons = (ph.mappings || []).map(m => actionButton((m.kind === 'line' ? tx('Als Leitungen übernehmen', 'Apply as lines') : tx('Als Wicklungen übernehmen', 'Apply as windings')) + ' (' + m.pairs.map(([a, b]) => portName(a) + '/' + portName(b)).join(' · ') + ')',
    'physics-apply', m.kind, m.kind === ph.recommended ? 'button primary' : 'button', 'network', disabled(samePairs(m.pairs, current) && state.config.pairs.length === 2))).join('');
  const b = state.profile.blocked;
  const blocked = b ? '<p class="inline-notice">' + esc(tx('Vorlage „' + b.name + '“ (' + Templates.similarity(b.score) + ' %) wurde nicht automatisch angewendet. ', 'Template "' + b.name + '" (' + Templates.similarity(b.score) + ' %) was not applied automatically. ') + b.reason) + '</p>' : '';
  const warn = pairWarning();
  const mine = Magnetic.fingerprint(ph);
  const similar = mine ? Templates.all().filter(t => t.phys).map(t => ({ t, d: Magnetic.distance(mine, t.phys) })).filter(x => x.d !== null && x.d <= 0.6)
    .sort((x, y) => x.d - y.d).filter((x, i, all) => all.findIndex(y => y.t.name === x.t.name) === i).slice(0, 3) : [];
  const similarHtml = similar.length ? '<p class="note">' + tx('Physikalisch ähnlich gelernt: ', 'Physically similar learned parts: ') + similar.map(x => '<strong>' + esc(x.t.name) + '</strong> (' + tx('Abstand ', 'distance ') + dec(x.d, 2) + ')').join(' · ') + '</p>' : '';
  const sign = v => v > 0 ? '+' : '−';
  const evidence = (ph.evidence || []).map(e => {
    const scores = Object.entries(e.scores || {}).filter(([, v]) => v).map(([c, v]) => '<span class="ev-score ' + (v > 0 ? 'pro' : 'con') + '">' + sign(v) + ' ' + esc(short(c)) + '</span>').join('');
    return '<li><span>' + esc(EN() ? e.en || e.text : e.text) + '</span>' + (scores ? '<span class="ev-scores">' + scores + '</span>' : '') + '</li>';
  }).join('');
  const ranked = (ph.verdict?.ranked || []).map(r => esc(short(r.category)) + ' ' + dec(r.score, 1)).join(' · ');
  const modes = (f.modes || []).length ? '<div class="table-scroll"><table class="ports-table physics-modes"><thead><tr><th scope="col">f</th><th scope="col">Sdd21</th><th scope="col">Scc21</th><th scope="col">Sdc21</th><th scope="col">Sdd11</th></tr></thead><tbody>' +
    f.modes.map(m => '<tr><td>' + esc(hz(m.f)) + '</td>' + ['sdd21', 'scc21', 'sdc21', 'sdd11'].map(k => '<td class="mono">' + (Number.isFinite(m[k]) ? dec(m[k], 1) : '–') + '</td>').join('') + '</tr>').join('') +
    '</tbody></table></div><p class="note">' + tx('dB, Leitungs-Lesart mit den gepunkteten Enden als Plus, Bezug wie in der App (Z_D = 2·Z₀, Z_C = Z₀/2).', 'dB, line reading with the dotted ends as plus, reference as in the app (Z_D = 2·Z₀, Z_C = Z₀/2).') + '</p>' : '';
  const reason = ph.reason ? (EN() ? ph.reasonEn || ph.reason : ph.reason) : '';
  const why = '<details class="physics-why"><summary>' + tx('Warum?', 'Why?') + '</summary>' +
    (reason ? '<p class="note">' + esc(reason) + '</p>' : '') +
    (evidence ? '<ul class="evidence-list">' + evidence + '</ul>' : '') +
    (ranked ? '<p class="note">' + tx('Merkmalspunkte: ', 'Feature points: ') + ranked + tx('. Eine Summe aus Merkmalspunkten, keine kalibrierte Wahrscheinlichkeit.', '. A sum of feature points, not a calibrated probability.') + '</p>' : '') +
    (f.kBand ? '<p class="note">' + esc(tx('k aus der komplexen Y-Matrix der beiden Wicklungen, ' + f.kPoints + ' Punkte zwischen ' + hz(f.kBand[0]) + ' und ' + hz(f.kBand.at(-1)) + ' (unter 0,2·f_res, Streureaktanz ≥ 1 Ω); Streuung ±' + dec(f.kSpread, 4) + '.',
      'k from the complex Y-matrix of both windings, ' + f.kPoints + ' points between ' + hz(f.kBand[0]) + ' and ' + hz(f.kBand.at(-1)) + ' (below 0.2·f_res, leakage reactance ≥ 1 Ω); spread ±' + dec(f.kSpread, 4) + '.')) + '</p>' : '') +
    modes + ((ph.warnings || []).length ? '<ul class="evidence-list warn">' + ph.warnings.map(w => '<li>' + esc(typeof w === 'string' ? w : EN() ? w.en : w.de) + '</li>').join('') + '</ul>' : '') +
    '<p class="note">' + esc(tx('Quelle: ', 'Source: ') + (ph.provenance === 'simulation' ? tx('Simulation eines SPICE-Modells', 'simulation of a SPICE model') : tx('Messdatei', 'measurement file')) + tx(' · Methode: komplexer Y-Matrix-Zweigfit und Topologieprüfung · Modul ', ' · method: complex Y-matrix branch fit and topology check · module ') + ph.version +
    (ph.quality ? ' · ' + ph.quality.points + tx(' Punkte, ', ' points, ') + hz(ph.quality.fMin) + ' – ' + hz(ph.quality.fMax) : '') +
    tx('. Herstellerangaben und Messphysik werden getrennt bewertet; nichts wird ohne deinen Klick übernommen.', '. Manufacturer data and measured physics are assessed separately; nothing is applied without your click.')) + '</p></details>';
  return '<section class="config-card physics-card"><div class="config-head"><h2>' + tx('Bauteil-Erkennung', 'Component recognition') + '</h2><p class="physics-verdict is-' + tone + '" id="physics-verdict">' + esc(headline) + '</p></div>' +
    '<div class="config-content">' + blocked + (warn ? '<p class="inline-notice">' + esc(warn) + '</p>' : '') + maker +
    (metrics ? '<div class="metric-grid">' + metrics + '</div>' : '') + (buttons ? '<div class="preset-row physics-actions">' + buttons + '</div>' : '') + similarHtml + why + '</div></section>';
}

function profileCard() {
  const p = state.profile;
  const label = {
    file: 'In der Datei gespeichert', template: 'Vorlage erkannt', local: 'Auf diesem Gerät gemerkt', carry: 'Von der vorherigen Datei übernommen', physics: 'Aus der Messung vorgeschlagen',
    builtin: 'Bekanntes Bauteil', default: 'Noch kein Profil'
  }[p.source];
  const status = label + (p.source === 'template' && p.score !== null ? ' · ' + Templates.similarity(p.score) + ' % Übereinstimmung' : '') +
    (p.source !== 'default' && p.key && p.key !== configKey() ? ' · geändert' : '');
  const chips = p.matches.map((match, i) => actionButton(match.tpl.name + ' · ' + Templates.similarity(match.score) + ' %', 'apply-template', i, 'button template-chip', '',
    ' title="' + esc(match.a.pairs.map(([a, b], k) => 'D' + (k + 1) + ' = ' + portName(a) + '/' + portName(b)).join(' · ')) + '"')).join('');
  const stored = Templates.groups().map(group => '<li><span><strong>' + esc(group.name) + '</strong> · ' + group.n + ' Ports · ' + group.pairs + ' Paare · ' +
    group.count + (group.count === 1 ? ' Beispiel' : ' Beispiele') + '</span>' + iconButton('Vorlage ' + group.name + ' löschen', 'delete-template', group.key, 'close') + '</li>').join('');
  return '<section class="config-card profile-card"><div class="config-head"><h2>Port-Profil</h2><p class="profile-status" id="profile-status">' + esc(status) + '</p></div>' +
    '<div class="config-content"><form id="profile-form" class="profile-form">' +
    textField('Bauteiltyp', 'name', p.name, 'z. B. CMC, LAN-Übertrager', 'profile-name') +
    '<button class="button primary" type="submit"' + disabled(state.dataset.demo) + '>' + icon('file') + (state.dataset.spice ? 'Für Modell speichern' : 'In Datei speichern') + '</button>' +
    actionButton('Als Vorlage lernen', 'learn-template', '', 'button', 'plus') +
    actionButton('Vorlagen prüfen', 'match-templates', '', 'button', 'reset', disabled(!Templates.size)) + actionButton('Pakete …', 'packs', '', 'button', 'grid', ' title="Fingerabdrücke und Kurvenwahl sichern, laden, teilen"') + '</form>' +
    (chips ? '<div class="preset-row"><span>Passende Vorlagen</span>' + chips + '</div>' : '') +
    '<p class="note">Paare, Abschlüsse, Bezugsimpedanzen und Kurvenauswahl stehen als lesbarer Kommentarblock in der Touchstone-Datei (TS 2.x: im Block [Begin Information]) und werden beim nächsten Öffnen übernommen. Eine gelernte Vorlage erkennt ähnliche Bauteile am Verhalten, auch bei anderer Portreihenfolge.</p>' +
    (stored ? '<details class="template-list"><summary>Gelernte Vorlagen</summary><ul>' + stored + '</ul></details>' : '') +
    '</div></section>';
}

registerActions({
  'physics-apply': applyPhysicsMapping,
});

export { physicsCard, profileCard };
