"""Unabhängige Referenzrechnung für den Rechenkern (tests/run-tests.js).

Rechnet dieselben Schaltungen mit einem anderen Verfahren:
  A  RLC-Tiefpass          Kettenmatrizen (ABCD) mit numpy
  B  Übertrager + Koppel-C  Z-Matrix der gekoppelten Spulen -> ABCD
  C  Kaskade zweier .s2p    scikit-rf (Network ** Network), Dateien werden geschrieben
  D  10BASE-T1L MDI         Y-Matrix von Hand, Mixed Mode mit scikit-rf (se2gmm)
  E  Idealer Übertrager     geschlossene Formel

Ausgabe: tests/reference.json und tests/data/*.s2p

    python tests/reference.py
"""
import json
import pathlib

import numpy as np
import skrf

here = pathlib.Path(__file__).resolve().parent
(here / 'data').mkdir(exist_ok=True)
Z0 = 50.0


def series(z):
    return np.array([[np.ones_like(z), z], [np.zeros_like(z), np.ones_like(z)]]).transpose(2, 0, 1)


def shunt(y):
    return np.array([[np.ones_like(y), np.zeros_like(y)], [y, np.ones_like(y)]]).transpose(2, 0, 1)


def chain(*parts):
    out = parts[0]
    for p in parts[1:]:
        out = out @ p
    return out


def abcd_to_s(m, z0=Z0):
    a, b, c, d = m[:, 0, 0], m[:, 0, 1], m[:, 1, 0], m[:, 1, 1]
    den = a + b / z0 + c * z0 + d
    s = np.empty_like(m)
    s[:, 0, 0] = (a + b / z0 - c * z0 - d) / den
    s[:, 0, 1] = 2 * (a * d - b * c) / den
    s[:, 1, 0] = 2 / den
    s[:, 1, 1] = (-a + b / z0 - c * z0 + d) / den
    return s


def pack(f, s):
    return {'freq': f.tolist(), 're': s.real.reshape(len(f), -1).tolist(), 'im': s.imag.reshape(len(f), -1).tolist()}


out = {}

# A: RLC-Tiefpass, wie die Vorlage "rlc"
f = np.logspace(5, 8, 301)
w = 2j * np.pi * f
out['A'] = pack(f, abcd_to_s(chain(series(0.05 + w * 1e-6), shunt(w * 470e-12), series(0.05 + w * 1e-6))))

# B: Übertrager aus zwei gekoppelten Spulen mit Koppelkondensatoren und Wicklungswiderstand
f = np.logspace(4, 8, 201)
w = 2j * np.pi * f
L1, L2, k, r1, r2 = 350e-6, 350e-6, 0.998, 0.4, 0.5
M = k * np.sqrt(L1 * L2)
z11, z22, z12 = r1 + w * L1, r2 + w * L2, w * M
xf = np.array([[z11 / z12, (z11 * z22 - z12 * z12) / z12], [1 / z12, z22 / z12]]).transpose(2, 0, 1)
zc = 0.02 + 1 / (w * 100e-9)
out['B'] = pack(f, abcd_to_s(chain(series(zc), shunt(w * 15e-12), xf, shunt(w * 22e-12 + 1 / 10e3), series(zc))))

# C: zwei Zweitore als Dateien, Kaskade mit scikit-rf
fa = np.linspace(1e5, 2e8, 400)
wa = 2j * np.pi * fa
freq = skrf.Frequency.from_f(fa, unit='hz')
net1 = skrf.Network(frequency=freq, s=abcd_to_s(chain(series(2 + wa * 220e-9), shunt(wa * 33e-12))), z0=50)
net2 = skrf.Network(frequency=freq, s=abcd_to_s(chain(shunt(1 / 600 + wa * 10e-12), series(1 / (wa * 1e-9) + 1), shunt(1 / (wa * 4.7e-6 + 3)))), z0=50)
net1.write_touchstone(str(here / 'data' / 'stufe1.s2p'), form='ri')
net2.write_touchstone(str(here / 'data' / 'stufe2.s2p'), form='ma')
cascade = net1 ** net2
fc = np.logspace(np.log10(2e5), np.log10(1.5e8), 151)
ci = cascade.interpolate(skrf.Frequency.from_f(fc, unit='hz'), kind='linear', coords='cart')
out['C'] = pack(fc, ci.s)
out['C_dense'] = pack(fa[::7], cascade.s[::7])

# D: 10BASE-T1L MDI wie die Vorlagen, Zweitor an mdi_p / mdi_n, Mixed Mode
f = np.logspace(5, np.log10(20e6), 401)
w = 2j * np.pi * f


def t1l(c_p, c_n, powered):
    L, kk = 470e-6, 0.999681
    Mc = kk * L
    det = (w * L) ** 2 - (w * Mc) ** 2
    ya, yb = w * L / det, -w * Mc / det           # Y-Matrix der gekoppelten Spulen (Zweigströme)
    zs = 50 + 1 / (w * 235e-9)                    # PHY-Abschluss in Reihe mit Koppel-C, je Leiter
    # Knoten: a_p, a_n, mdi_p, mdi_n ; Spulenzweige a_p->mdi_p und a_n->mdi_n
    y = np.zeros((len(f), 4, 4), complex)
    br = [(0, 2), (1, 3)]
    yl = [[ya, yb], [yb, ya]]
    for m in range(2):
        for n in range(2):
            a1, b1 = br[m]
            a2, b2 = br[n]
            y[:, a1, a2] += yl[m][n]
            y[:, b1, b2] += yl[m][n]
            y[:, a1, b2] -= yl[m][n]
            y[:, b1, a2] -= yl[m][n]
    y[:, 0, 0] += 1 / zs
    y[:, 1, 1] += 1 / zs
    y[:, 2, 2] += w * c_p
    y[:, 3, 3] += w * c_n
    if powered:
        Lp, kp = 39e-6, 0.99
        Mp = kp * Lp
        dp = (w * Lp) ** 2 - (w * Mp) ** 2
        # L2a: mdi_p -> 0, L2b: 0 -> mdi_n ; Spannungen U_a = U(mdi_p), U_b = -U(mdi_n)
        yaa, yab = w * Lp / dp, -w * Mp / dp
        y[:, 2, 2] += yaa
        y[:, 3, 3] += yaa
        y[:, 2, 3] -= yab
        y[:, 3, 2] -= yab
    # innere Knoten a_p, a_n eliminieren
    yii, yie, yei, yee = y[:, :2, :2], y[:, :2, 2:], y[:, 2:, :2], y[:, 2:, 2:]
    y2 = yee - yei @ np.linalg.solve(yii, yie)
    eye = np.eye(2)
    s = np.linalg.solve((eye + Z0 * y2).transpose(0, 2, 1), (eye - Z0 * y2).transpose(0, 2, 1)).transpose(0, 2, 1)
    net = skrf.Network(frequency=skrf.Frequency.from_f(f, unit='hz'), s=s, z0=50)
    net.se2gmm(p=1)
    return pack(f, net.s)   # Reihenfolge: D, C


out['D_sym'] = t1l(100e-12, 100e-12, False)
out['D_unsym'] = t1l(100e-12, 110e-12, False)
out['D_powered'] = t1l(100e-12, 100e-12, True)

# E: idealer Übertrager ü = 2 (Up = 2·Us) zwischen 50-Ohm-Ports, dazu 10 Ohm in Reihe
n = 2.0
m = chain(series(np.full(3, 10 + 0j)), np.array([[n, 0], [0, 1 / n]], complex)[None].repeat(3, 0))
out['E'] = pack(np.array([1e5, 1e6, 1e7]), abcd_to_s(m))

(here / 'reference.json').write_text(json.dumps(out))
print('geschrieben:', ', '.join(out))
