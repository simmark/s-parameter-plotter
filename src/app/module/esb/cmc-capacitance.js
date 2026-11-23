// Symmetric four-terminal CMC topology: each Cw and Cx is one branch, Ct is per winding.
// Resonance gives the *modal* capacitance; the other modes are needed to separate branches.
function estimateCmcCapacitances({ fdm, leakage, cg, line, across }) {
  if (![fdm, leakage].every(x => Number.isFinite(x) && x > 0)) return { available: false, reason: 'resonance' };
  const modal = 1 / ((2 * Math.PI * fdm) ** 2 * leakage);
  if (![cg, line, across].every(Number.isFinite)) return { available: false, reason: 'modes', fdm, leakage, modal };
  const turn = modal - cg / 2; // Ct + Cw for the per-winding leakage convention
  const cw = (line + turn - across) / 2;
  const cx = (line + across - turn) / 2;
  const ct = (across + turn - line) / 2;
  if (![cw, cx, ct].every(x => Number.isFinite(x) && x >= 0)) return { available: false, reason: 'inconsistent', fdm, leakage, modal };
  return { available: true, fdm, leakage, modal, cw, cx, ct, cg };
}
export { estimateCmcCapacitances };
