'use strict';

// Grenzwert-Datenbank für Single Pair Ethernet.
// Jede Kurve besteht aus Abschnitten: Grenzwert(f) = a + b · log10(f / f0), f in MHz, Ergebnis in dB
// (positiver Wert = geforderte Dämpfung). Die Daten sind reines JSON.
//
// WICHTIG: "status" sagt, wie gut die Kurve belegt ist.
//   bestaetigt  an einem öffentlichen IEEE-Arbeitsdokument abgeglichen (nicht am veröffentlichten Normtext)
//   offen       Wert oder Steigung in der Endfassung der Norm noch zu prüfen
//   ungeprueft  aus einer Folie abgelesen, online nicht bestätigt
// Vor einer Freigabe muss jede Kurve gegen IEEE Std 802.3 und die Amendments geprüft werden.

const SPE = (() => {
  const limits = [
    {
      id: '10BASE-T1L/RL', standard: '10BASE-T1L', powered: false,
      quantity: 'RL', label: 'MDI Return Loss', modes: ['DD'], reflection: true,
      clause: '146.8.3, Gl. 146-17a', refOhm: 100, status: 'bestaetigt',
      note: 'Abgeglichen mit dem 802.3dd-Textvorschlag (Stewart, 09/2021).',
      source: 'https://grouper.ieee.org/groups/802/3/dd/public/stewart_3dd_02_09072021.pdf',
      segments: [
        { from: 0.1, to: 0.2, a: 20, b: 18, f0: 0.2 },
        { from: 0.2, to: 1, a: 20, b: 0, f0: 1 },
        { from: 1, to: 10, a: 20, b: -16.7, f0: 1 },
        { from: 10, to: 20, a: 3.3, b: -7.6, f0: 10 }
      ]
    },
    {
      id: '10BASE-T1L/RL/powered', standard: '10BASE-T1L', powered: true,
      quantity: 'RL', label: 'MDI Return Loss mit Speisung', modes: ['DD'], reflection: true,
      clause: '146.8.3, Gl. 146-17b (802.3dd)', refOhm: 100, status: 'offen',
      note: 'Steigung 18 dB/Dekade laut Vorschlag 09/2021; ein Vorschlag von 03/2022 nennt 21,5. Endfassung 802.3dd-2022 prüfen.',
      source: 'https://grouper.ieee.org/groups/802/3/dd/public/stewart_3dd_02_09072021.pdf',
      segments: [
        { from: 0.1, to: 0.5, a: 20, b: 18, f0: 0.5 },
        { from: 0.5, to: 1, a: 20, b: 0, f0: 1 },
        { from: 1, to: 10, a: 20, b: -16.7, f0: 1 },
        { from: 10, to: 20, a: 3.3, b: -7.6, f0: 10 }
      ]
    },
    {
      id: '10BASE-T1L/MC', standard: '10BASE-T1L', powered: null,
      quantity: 'MC', label: 'MDI Modenwandlung', modes: ['CD', 'DC'], reflection: true,
      clause: '146.8.4', refOhm: 100, status: 'ungeprueft',
      note: 'Verlauf aus einer Folie abgelesen (50 dB bis 10 MHz). Der Frequenzbereich 0,1–20 MHz ist belegt, der Wert nicht: ' +
        'eine 802.3dg-Präsentation von 01/2026 deutet auf eine deutlich niedrigere MDI-Basis. Möglicherweise ist das der Link-Segment-Wert.',
      source: 'https://www.ieee802.org/3/cg/public/May2019/Comment%20i112%20text.docx',
      segments: [
        { from: 0.1, to: 10, a: 50, b: 0, f0: 10 },
        { from: 10, to: 20, a: 50, b: -20, f0: 10 }
      ]
    }
  ];

  // Grenzwert in dB bei f (MHz); null außerhalb des Geltungsbereichs.
  function value(limit, fMHz) {
    for (const seg of limit.segments) {
      if (fMHz >= seg.from && fMHz <= seg.to) return seg.a + seg.b * Math.log10(fMHz / seg.f0);
    }
    return null;
  }

  const range = limit => [limit.segments[0].from, limit.segments[limit.segments.length - 1].to];

  function forStandard(standard, powered) {
    if (!standard) return [];
    const key = standard.toUpperCase();
    return limits.filter(l => l.standard.toUpperCase() === key && (l.powered === null || l.powered === !!powered));
  }

  // freqHz, db: Kurve |S| in dB (negativ). Die erreichte Dämpfung ist −db.
  // Ergebnis: pass, kleinste Reserve in dB mit Frequenz, und ob der Sweep den Geltungsbereich abdeckt.
  function evaluate(limit, freqHz, db) {
    const [lo, hi] = range(limit);
    let margin = Infinity, at = null, used = 0, gaps = 0, fMin = Infinity, fMax = -Infinity;
    for (let i = 0; i < freqHz.length; i++) {
      const f = freqHz[i] / 1e6;
      const need = value(limit, f);
      if (need === null) continue;
      if (Number.isNaN(db[i])) { gaps++; continue; }
      used++;
      fMin = Math.min(fMin, f); fMax = Math.max(fMax, f);
      const reserve = -db[i] - need;
      if (reserve < margin) { margin = reserve; at = freqHz[i]; }
    }
    const covered = used > 1 && !gaps && fMin <= lo * 1.02 && fMax >= hi / 1.02;
    return { limit, used, covered, pass: used ? margin >= 0 : null, margin: used ? margin : null, at };
  }

  return { limits, value, range, forStandard, evaluate };
})();

if (typeof module === 'object' && module.exports) module.exports = SPE;
