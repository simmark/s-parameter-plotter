// Display quantities reuse the analyzer's modal impedances and the model's physical branch values.
import { COLORS } from '../../basis/farben.js';
import { omega } from '../../basis/format.js';

const phase = z => z && RF.abs(z) > 0 ? Math.atan2(z[1], z[0]) / RF.RAD : NaN;
const inverse = y => y && RF.div([1, 0], y);
const windingZ = (cm, dm) => cm && dm && RF.add(cm, RF.scale(dm, 0.25));

function inductanceUnit(value, fallback = 'µH') {
  if (!Number.isFinite(value) || value <= 0) return { unit: fallback, factor: fallback === 'nH' ? 1e-9 : fallback === 'mH' ? 1e-3 : 1e-6 };
  return value >= 1e-3 ? { unit: 'mH', factor: 1e-3 } : value >= 1e-6 ? { unit: 'µH', factor: 1e-6 } : { unit: 'nH', factor: 1e-9 };
}

function cmcQuantities(freq, cm, dm, modelZ, natural, model, format) {
  const zcm = i => cm[i]?.z, zdm = i => dm[i]?.z;
  const l = (z, f) => z && f > 0 ? z[1] / omega(f) : NaN;
  const degree = (fn, color, label) => ({ color, label, values: Float64Array.from(freq, (_, i) => phase(fn(i))) });
  const winding = i => windingZ(zcm(i), zdm(i));
  const modalPlus = i => zcm(i) && RF.scale(zcm(i), 2);
  const modalMinus = i => zdm(i) && RF.scale(zdm(i), 0.5);
  const modelWinding = i => windingZ(modelZ?.[i]?.cm, modelZ?.[i]?.dm);
  const at10k = freq[0] <= 1e4 && freq.at(-1) >= 1e4 ? Plot.nearest(freq, 1e4, true) : -1;
  const windingReference = l(winding(at10k), freq[at10k]);
  const leakReference = l(modalMinus(at10k), freq[at10k]);
  const reference = format === 'leak' ? leakReference : windingReference;
  const inductance = (label, color, pick, factor) => [label, color, (i, f) => l(pick(i), f) / factor];
  if (format === 'cap') {
    // Rearrange the terminals by winding. The common-to-common transfer admittance
    // of that virtual two-port equals Y_mode1 - Y_mode0 in the symmetric projection.
    const couplingZ = i => natural[i] && inverse(RF.sub(natural[i].y[1], natural[i].y[0]));
    const groundZ = i => natural[i] && inverse(natural[i].y[0]);
    const turnZ = i => natural[i] && inverse(natural[i].h);
    const values = Float64Array.from(freq, (_, i) => {
      const p = phase(couplingZ(i));
      return Math.abs(p + 90) <= 15 ? natural[i].cw : NaN;
    });
    const plateau = RF.plateau(freq, values, 0, freq.at(-1), 0.15);
    return {
      unit:'pF', plateau,
      list: [['Cw + Cx · je Seite', COLORS[1], i => natural[i]?.cw * 1e12],
        ['Cg · je Anschluss', COLORS[0], i => natural[i]?.cg * 1e12],
        ['Ct + Cx · aus H', COLORS[2], (i,f) => natural[i] && Math.abs(phase(turnZ(i))+90)<=15 ?
          0.5e12 * (natural[i].h[1]/omega(f)-natural[i].cg) : NaN]],
      extra: model ? [['Modell Cw + Cx', COLORS[1], () => (model.cw+(model.cx||0))*1e12],
        ['Modell Cg', COLORS[0], () => model.cg*1e12],
        ['Modell Ct + Cx', COLORS[2], () => (model.ct+(model.cx||0))*1e12],
        ['Modell Cw · einzeln', COLORS[3], () => model.cw*1e12],
        ['Modell Ct · einzeln', COLORS[4], () => model.ct*1e12]] : [],
      phases:[degree(couplingZ,COLORS[1],'φ Z Kopplung'),degree(groundZ,COLORS[0],'φ Z gegen Masse'),degree(turnZ,COLORS[2],'φ Z H')]
    };
  }
  const {unit,factor}=inductanceUnit(reference > 0 ? reference :
    format==='leak' ? model?.ls : model && model.ls+RF.coreSections(model).reduce((sum,[m])=>sum+m,0));
  const configs = {
    ind: [['L · je Wicklung',COLORS[1],winding,modelWinding]],
    leak: [['Lσ = L−M · je Wicklung',COLORS[0],modalMinus,i=>modelZ?.[i]?.dm && RF.scale(modelZ[i].dm,0.5)]],
    modes: [['L+M',COLORS[1],modalPlus,i=>modelZ?.[i]?.cm && RF.scale(modelZ[i].cm,2)],
      ['L−M',COLORS[0],modalMinus,i=>modelZ?.[i]?.dm && RF.scale(modelZ[i].dm,0.5)]]
  };
  const items=configs[format] || configs.ind;
  return {unit, at10k, windingReference, leakReference,
    list:items.map(([label,color,pick])=>inductance(label,color,pick,factor)),
    extra:modelZ ? items.map(([label,color,,pick])=>inductance('Modell '+label,color,pick,factor)) : [],
    phases:items.map(([label,color,pick])=>degree(pick,color,'φ '+label))};
}

export { cmcQuantities, inductanceUnit, phase };
