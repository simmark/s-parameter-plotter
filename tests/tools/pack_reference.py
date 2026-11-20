# Independent NumPy reference for the SIMONLATION synthetic Touchstone pack (tests/pack.mjs): full mixed-mode matrix per file,
# built from the sidecar differential_pairs. Usage: python3 -I pack_reference.py <pack dir> <out.json>
import json, re, sys
from pathlib import Path
import numpy as np
ROOT = Path(sys.argv[1]); OUT = Path(sys.argv[2])
def load(path, order):
    n = int(re.search(r'\.s(\d+)p$', path.name, re.I).group(1)); vals = []
    for l in path.open(encoding='ascii'):
        l = l.split('!')[0].strip()
        if not l or l.startswith('#'): continue
        vals.extend(float(t) for t in l.split())
    g = 1 + 2*n*n; f = []; s = []
    for i in range(0, len(vals), g):
        v = vals[i:i+g]; f.append(v[0]); t = np.array(v[1:]).reshape(n*n, 2)
        s.append((t[:, 0] + 1j*t[:, 1]).reshape((n, n), order=order))
    return np.array(f), np.array(s)
res = {}
for m in json.loads((ROOT/'manifest.json').read_text())['models']:
    f, sF = load(ROOT/m['file'], 'F'); _, sC = load(ROOT/m['file'], 'C')
    d = json.loads((ROOT/m['mapping']).read_text()); n = m['ports']
    pairs = [(p['positive_port']-1, p['negative_port']-1) for p in d['differential_pairs']]
    used = {i for p in pairs for i in p}
    rows = []
    for sign in (-1, 1):
        for p, q in pairs:
            r = np.zeros(n); r[p] = 1/np.sqrt(2); r[q] = sign/np.sqrt(2); rows.append(r)
    for i in range(n):
        if i not in used: r = np.zeros(n); r[i] = 1; rows.append(r)
    M = np.array(rows)
    mm = np.einsum('ij,fjk,lk->fil', M, sF, M)
    res[m['model']] = {'file': m['file'], 'n': n, 'pairs': pairs, 'freq': f.tolist(),
        'mm_re': mm.real.tolist(), 'mm_im': mm.imag.tolist(),
        'orderDiff': float(np.max(np.abs(sF - sC))), 'symErr': float(np.max(np.abs(sF - sF.transpose(0, 2, 1))))}
OUT.write_text(json.dumps(res))
for k, v in res.items(): print(f"{k:40s} pairs={len(v['pairs']):2d} F-vs-C={v['orderDiff']:.1e} sym={v['symErr']:.1e}")
