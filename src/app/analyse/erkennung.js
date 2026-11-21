// analyse/erkennung – Bauteilerkennung aus der Physik der Messung: Klasse, Zuordnung, Wicklungen und ESB-Modell.
import { cache, selectedPairs } from './daten.js';
import { currentModes, getView } from './kurven.js';
import { portName } from '../basis/format.js';
import { EN, lang, tx } from '../basis/sprache.js';
import { state } from '../basis/zustand.js';

// Warning when the active pairs do not fit the measured winding paths (four-port, paths certain).
function pairWarning() {
  const physics = physicsOf(state.dataset);
  if (!physics || physics.kind !== 'four-port' || physics.windings?.confidence !== 'sicher' || !physics.mappings) return '';
  if (state.basis !== 'mm' || state.config.pairs.length !== 2) return '';
  const current = state.config.pairs.map(pair => [pair.p, pair.q]);
  if (physics.mappings.some(m => samePairs(m.pairs, current))) return '';
  const paths = physics.windings.pairs.map(([a, b]) => portName(a) + '–' + portName(b)).join(tx(' und ', ' and '));
  const line = physics.mappings[0].pairs, crossed = [[line[0][0], line[1][1]], [line[1][0], line[0][1]]];
  return samePairs(crossed, current)
    ? tx('Die Paare verbinden die Wicklungen gegensinnig (Wicklungen ' + paths + '): Gleich- und Gegentakt sind vertauscht.', 'The pairs join the windings in opposite sense (windings ' + paths + '): common and differential mode are swapped.')
    : tx('Die Paare passen nicht zu den gemessenen Wicklungen ' + paths + ': Sdd und Scc sind so physikalisch nicht aussagekräftig.', 'The pairs do not match the measured windings ' + paths + ': Sdd and Scc are not physically meaningful this way.');
}

const samePairs = (a, b) => {
  const norm = list => JSON.stringify(list.map(pair => [...pair].sort((x, y) => x - y)).sort());
  return a.length === b.length && norm(a) === norm(b);
};

// Class and physics fingerprint stored with a learned template (spa-pack v1, optional fields).
function physicsLabel(name, dataset) {
  const physics = physicsOf(dataset);
  const byName = Magnetic.categoryFromName(name);
  const byPhysics = physics?.status === 'candidate' && physics.verdict.level !== 'unklar' ? physics.verdict.category : null;
  const category = byName || byPhysics || null;
  const phys = Magnetic.fingerprint(physics);
  return { ...(category ? { category, categorySource: byName ? 'name' : 'physik' } : {}), ...(phys ? { phys } : {}), source: 'user_labeled' };
}

// Reason why a learned template must not be applied automatically to this file; null = no objection.
function templateConflict(tpl, physics) {
  const label = templateClass(tpl);
  if (!label || !physics || physics.status !== 'candidate') return null;
  const v = physics.verdict;
  if (v.category && v.category !== 'other' && !fitsClass(label, v.category) && !fitsClass(v.category, label)) {
    return tx('Die Messung spricht für ' + short(v.category) + ' (' + level(v.level) + '), die Vorlage ist als ' + short(label) + ' gelernt.',
      'The measurement indicates ' + short(v.category) + ' (' + level(v.level) + '); the template was learned as ' + short(label) + '.');
  }
  if (!v.category && label === 'cmc' && v.ranked.slice(0, 2).some(r => r.category === 'coupled')) return tx('Die Messung ist nicht eindeutig: CMC oder Doppeldrossel.', 'The measurement is ambiguous: CMC or coupled inductor.');
  const maker = physics.manufacturer?.category;
  if (maker && !fitsClass(label, maker) && !fitsClass(maker, label)) return tx('Laut Dateikopf ist das Bauteil ' + short(maker) + ' (' + physics.manufacturer.family + ').', 'According to the file header the part is a ' + short(maker) + ' (' + physics.manufacturer.family + ').');
  return null;
}

const templateClass = tpl => tpl.category || Magnetic.categoryFromName(tpl.name);

const fitsClass = (label, physical) => label === physical || (label === 'inductor' && ['ferrite-inductor', 'coreless', 'bead'].includes(physical));

function physicsOf(dataset) {
  if (!dataset || dataset.demo || typeof Magnetic === 'undefined') return null;
  if (!physicsCache.has(dataset)) {
    let result;
    try { result = Magnetic.analyze(dataset); } catch (error) { result = { status: 'error', reason: error.message, reasonEn: error.message }; }
    physicsCache.set(dataset, result);
  }
  return physicsCache.get(dataset);
}

const level = value => (LEVEL[value] || [value, value])[EN() ? 1 : 0];

const LEVEL = { wahrscheinlich: ['wahrscheinlich', 'likely'], 'möglich': ['möglich', 'possible'], unklar: ['unklar', 'unclear'], sicher: ['sicher', 'certain'] };

const short = cat => Magnetic.label(cat, lang(), true);

// ---- Physics-based recognition (Magnetic module): cached per dataset; suggestions are applied only on request. ----
const physicsCache = new WeakMap();

function elementPhysics() {
  const physics = physicsOf(state.dataset);
  return physics?.kind === 'two-pole' && physics.status === 'candidate' ? physics : null;
}

function windingPhysics() {
  const physics = physicsOf(state.dataset);
  return physics?.kind === 'four-port' && physics.status === 'candidate' && physics.windings?.confidence === 'sicher' && physics.mappings?.length &&
    Magnetic.MAGNETIC.includes(physics.verdict?.category) ? physics : null;
}

function detectModel() {
  if (!state.network) return { type: 'cmc', confidence: 0 };
  const pairs = selectedPairs();
  if (pairs) {
    return cache('classify:' + pairs.map(p => p.id).join(':'), () => {
      const view = getView('mm');
      const at = key => view.modes.findIndex(m => m.key === key);
      const [a, b] = pairs;
      const i = view.samples.findIndex(Boolean);
      if (i < 0) return { type: 'cmc', confidence: 0 };
      const s = view.samples[i], n = view.modes.length;
      const scc = RF.abs(RF.get(s, n, at('C' + b.id), at('C' + a.id)));
      const sdd = RF.abs(RF.get(s, n, at('D' + b.id), at('D' + a.id)));
      const result = RF.classify4(state.dataset.freq, scc, sdd);
      return { ...result, scc, sdd, f: state.dataset.freq[i] };
    });
  }
  // Four-port file without port pairs: the measured winding paths already say that this is a two-winding part.
  // The equivalent circuit needs the pairs, so the view offers to apply them instead of fitting a single inductor between P1 and P2.
  const four = windingPhysics();
  if (four) return { type: four.verdict.category === 'transformer' ? 'transformer' : 'cmc', confidence: 0, category: four.verdict.category, level: four.verdict.level || 'unklar', needsMapping: four };
  // One- and two-port files: the physics detection that already labels the part also picks the model,
  // so a capacitor is no longer treated as a series inductance just because that was the default.
  const physics = elementPhysics();
  if (physics) {
    const category = physics.verdict?.category, reactive = ['capacitor', 'inductor', 'coreless', 'ferrite-inductor', 'bead'].includes(category);
    return { type: category === 'capacitor' ? 'shunt' : 'series', confidence: 0, category, topology: physics.topology, level: reactive ? physics.verdict.level || 'unklar' : 'unklar' };
  }
  return { type: currentModes().length >= 1 ? 'series' : 'none', confidence: 0, level: 'unklar' };
}

export { pairWarning, samePairs, physicsLabel, templateConflict, physicsOf, level, short, elementPhysics,
  windingPhysics, detectModel };
