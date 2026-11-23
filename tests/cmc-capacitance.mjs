import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/app/module/esb/cmc-capacitance.js', import.meta.url), 'utf8');
const { estimateCmcCapacitances: estimate } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
// Independent symmetric network: Ct 15 pF, Cw 3.5 pF, Cx 4 pF, Cg 7 pF.
const ct = 15e-12, cw = 3.5e-12, cx = 4e-12, cg = 7e-12, leakage = 30e-6;
const fdm = 1 / (2 * Math.PI * Math.sqrt(leakage * (ct + cw + cg / 2)));
const input = { fdm, leakage, cg, line: cw + cx, across: ct + cx };
const result = estimate(input);
assert.equal(result.available, true);
for (const [key, expected] of Object.entries({ ct, cw, cx })) assert.ok(Math.abs(result[key] - expected) < 1e-22, key);
assert.equal(estimate({ ...input, fdm: NaN }).reason, 'resonance');
assert.equal(estimate({ ...input, line: NaN }).reason, 'modes');
assert.equal(estimate({ ...input, line: 100e-12 }).reason, 'inconsistent');
console.log('PASS · CMC branch capacitances and unavailable estimates');
