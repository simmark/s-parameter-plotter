// analyse/formate – Darstellungsformate und Auswerteverfahren für S, Z und CISPR 17.

const Z_EVALUATIONS = [
  ['z:reflection', 'Eingangsimpedanz · Reflexion Zᵢₙ'], ['z:zmatrix', 'Z-Matrix · Zᵢⱼ'], ['z:ymatrix', 'Y-Matrix · Yᵢⱼ'],
  ['z:txseries', 'Serienimpedanz · Transmission'], ['z:txshunt', 'Shuntimpedanz · Transmission'],
  ['cispr:one', 'CISPR 17 · Eintor · Reflexion'], ['cispr:series', 'CISPR 17 · Zweitor · Serie'], ['cispr:shunt', 'CISPR 17 · Zweitor · Shunt'], ['cispr:four', 'CISPR 17 · Vierport · CM / DM']
];
const S_FORMATS = [
  ['db', 'Betrag · dB'], ['mag', 'Betrag · linear'], ['phase', 'Phase · ±180°'], ['unwrap', 'Phase · entfaltet'],
  ['re', 'Realteil'], ['im', 'Imaginärteil'], ['delay', 'Gruppenlaufzeit']
];
const Z_FORMATS = [
  ['mag', 'Betrag |Z|'], ['re', 'Realteil · R / ESR'], ['im', 'Imaginärteil · X'], ['phase', 'Phase'],
  ['ls', 'L · Serie / ESL'], ['cs', 'C · Serie'], ['lp', 'L · Parallel'], ['cp', 'C · Parallel'], ['q', 'Güte Q = |X|/R']
];
const Z_METHODS = [
  ['reflection', 'Reflexion · Zᵢₙ'], ['zmatrix', 'Z-Matrix · Zᵢⱼ'], ['ymatrix', 'Y-Matrix · Yᵢⱼ'],
  ['txseries', 'Transmission · Serie'], ['txshunt', 'Transmission · Shunt']
];
const CISPR_METHODS = [
  ['four', 'Vierport · CM / DM'], ['series', 'Zweitor · Serie'], ['shunt', 'Zweitor · Shunt'], ['one', 'Eintor · Reflexion']
];

export { Z_EVALUATIONS, S_FORMATS, Z_FORMATS };
