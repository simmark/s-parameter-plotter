'use strict';
// Connector intelligence: versioned connector profiles, port mappings and their automatic estimation from the S-matrix.
// Pure functions, no DOM. The data model keeps five things apart:
//   contact  – a physical pin of the connector or part (e.g. USB-C A2, RJ45 contact 3, transformer pin TD+),
//   node     – one electrical end of a contact in the measurement (contact on side 1 or side 2 for a thru measurement),
//   port     – a column of the S-matrix in the file,
//   channel  – a logical signal path made of contacts (a differential pair through the connector, a transformer channel),
//   mode     – a modal port (D or C of one pair at one side), created by the analyzer from the pairs of the mapping.
// A mapping assigns each measurement port to at most one node. Applying it produces the analyzer's port configuration
// (pairs and terminations); the RF core is unchanged and the measured data are never modified.
const Connector = (() => {
  const SCHEMA = 'simonlation.connector-profile', MAP_SCHEMA = 'simonlation.port-map', VERSION = 1;

  // ---------- Profiles ----------
  // Texts carry an optional English variant (field `en`); `text(obj, key, lang)` picks it. German is the source language.
  const USB_SOURCE = { title: 'USB Type-C Cable and Connector Specification, Release 2.4 (USB-IF, Oktober 2024)', ref: '3.2.3 Pin Assignments and Descriptions',
    note: 'Identisch übernommen als IEC 62680-1-3:2026. Normative Signalnamen SSTXp1 … SSRXn2, Dp1/Dn1, Dp2/Dn2; gebräuchliche Kurznamen TX1+ … RX2− sind informell.',
    en: { title: 'USB Type-C Cable and Connector Specification, Release 2.4 (USB-IF, October 2024)', note: 'Adopted unchanged as IEC 62680-1-3:2026. Normative signal names SSTXp1 … SSRXn2, Dp1/Dn1, Dp2/Dn2; the common short names TX1+ … RX2− are informal.' } };
  const USB32_SOURCE = { title: 'Universal Serial Bus 3.2 Specification (USB-IF)', ref: 'Betriebsarten Gen 1×1, Gen 2×1, Gen 1×2, Gen 2×2',
    note: 'x1 nutzt eine Lane (TX1/RX1 oder, je nach Steckorientierung, TX2/RX2); x2 nutzt beide.',
    en: { ref: 'Operating modes Gen 1×1, Gen 2×1, Gen 1×2, Gen 2×2', note: 'x1 uses one lane (TX1/RX1 or, depending on plug orientation, TX2/RX2); x2 uses both.' } };
  const ETH_SOURCE = { title: 'IEEE Std 802.3', ref: '40.8 MDI (1000BASE-T, Tabelle 40-12 Crossover); Klauseln 14 und 25 (10BASE-T, 100BASE-TX)',
    note: 'Kontaktpaare 1/2, 3/6, 4/5, 7/8. MDI-X tauscht die Paare A↔B und C↔D.',
    en: { ref: '40.8 MDI (1000BASE-T, Table 40-12 crossover); clauses 14 and 25 (10BASE-T, 100BASE-TX)', note: 'Contact pairs 1/2, 3/6, 4/5, 7/8. MDI-X swaps pairs A↔B and C↔D.' } };
  const text = (obj, key, lang) => (lang === 'en' && obj?.en?.[key] !== undefined ? obj.en[key] : obj?.[key]) ?? '';

  function usbC() {
    const A = ['GND', 'SSTXp1', 'SSTXn1', 'VBUS', 'CC1', 'Dp1', 'Dn1', 'SBU1', 'VBUS', 'SSRXn2', 'SSRXp2', 'GND'];
    const B = ['GND', 'SSTXp2', 'SSTXn2', 'VBUS', 'CC2', 'Dp2', 'Dn2', 'SBU2', 'VBUS', 'SSRXn1', 'SSRXp1', 'GND'];
    const SHORT = { SSTXp1: 'TX1+', SSTXn1: 'TX1−', SSRXp1: 'RX1+', SSRXn1: 'RX1−', SSTXp2: 'TX2+', SSTXn2: 'TX2−', SSRXp2: 'RX2+', SSRXn2: 'RX2−',
      Dp1: 'D+', Dn1: 'D−', Dp2: 'D+', Dn2: 'D−' };
    const role = name => name === 'GND' ? 'ground' : name === 'VBUS' ? 'power' : /^CC/.test(name) ? 'config' : /^SBU/.test(name) ? 'sideband' : /^D[pn]/.test(name) ? 'usb2' : 'superspeed';
    const contacts = [];
    // Front view into the receptacle: row A on top from A1 (left) to A12, row B below from B12 (left) to B1.
    A.forEach((name, k) => contacts.push({ id: 'A' + (k + 1), normative: name, label: SHORT[name] || name, role: role(name), x: k, y: 0 }));
    B.forEach((name, k) => contacts.push({ id: 'B' + (k + 1), normative: name, label: SHORT[name] || name, role: role(name), x: 11 - k, y: 1.4 }));
    const pairs = [
      { id: 'TX1', plus: 'A2', minus: 'A3', name: 'SuperSpeed TX1', group: 'superspeed' }, { id: 'RX1', plus: 'B11', minus: 'B10', name: 'SuperSpeed RX1', group: 'superspeed' },
      { id: 'TX2', plus: 'B2', minus: 'B3', name: 'SuperSpeed TX2', group: 'superspeed' }, { id: 'RX2', plus: 'A11', minus: 'A10', name: 'SuperSpeed RX2', group: 'superspeed' },
      { id: 'D-A', plus: 'A6', minus: 'A7', name: 'USB 2.0 D± (Reihe A)', group: 'usb2', en: { name: 'USB 2.0 D± (row A)' } }, { id: 'D-B', plus: 'B6', minus: 'B7', name: 'USB 2.0 D± (Reihe B)', group: 'usb2', en: { name: 'USB 2.0 D± (row B)' } }
    ];
    const swap = id => (id[0] === 'A' ? 'B' : 'A') + id.slice(1), mirror = id => id[0] + (13 - Number(id.slice(1)));
    return {
      schema: SCHEMA, version: VERSION, id: 'usb-c-receptacle-thru', revision: '1.0.0', status: 'validated',
      family: 'USB Type-C', name: 'USB-C Receptacle · 24 Kontakte, Durchgangsmessung', variant: 'Full-Featured Receptacle', gender: 'receptacle',
      view: 'Steckseite, Blick in die Buchse; Zeichnung schematisch, nicht maßstäblich',
      en: { name: 'USB-C receptacle · 24 contacts, thru measurement', view: 'Mating side, looking into the receptacle; schematic drawing, not to scale' },
      contacts, pairs, sources: [USB_SOURCE, USB32_SOURCE],
      // Internal connections a receptacle may or may not have; they are never assumed, only offered as information.
      nets: [{ id: 'GND', contacts: ['A1', 'A12', 'B1', 'B12'], note: 'Masse; im Bauteil oft verbunden, in der Messung dann nicht unabhängig' },
        { id: 'VBUS', contacts: ['A4', 'A9', 'B4', 'B9'], note: 'Versorgung; oft verbunden' }],
      measurement: { kind: 'thru', sides: [1, 2], sideNames: ['Seite 1', 'Seite 2'], note: 'Ein Messport je Kontakt und Seite (z. B. Leiterplattenseite und Steckseite). Andere Messaufbauten passen nicht zu diesem Profil.',
        en: { sideNames: ['Side 1', 'Side 2'], note: 'One measurement port per contact and side (e.g. board side and mating side). Other measurement set-ups do not fit this profile.' } },
      configurations: [
        { id: 'usb2', name: 'USB 2.0', pairs: ['D-A'] },
        { id: 'gen1x1', name: 'USB 3.2 Gen 1×1 (5 Gb/s)', pairs: ['TX1', 'RX1'], note: 'Eine Lane; gedreht TX2/RX2.', en: { note: 'One lane; flipped TX2/RX2.' } },
        { id: 'gen2x1', name: 'USB 3.2 Gen 2×1 (10 Gb/s)', pairs: ['TX1', 'RX1'], note: 'Eine Lane; gedreht TX2/RX2.', en: { note: 'One lane; flipped TX2/RX2.' } },
        { id: 'gen1x2', name: 'USB 3.2 Gen 1×2 (10 Gb/s)', pairs: ['TX1', 'RX1', 'TX2', 'RX2'] },
        { id: 'gen2x2', name: 'USB 3.2 Gen 2×2 (20 Gb/s)', pairs: ['TX1', 'RX1', 'TX2', 'RX2'] },
        { id: 'all', name: 'Alle Paare (SuperSpeed und USB 2.0)', pairs: ['TX1', 'RX1', 'TX2', 'RX2', 'D-A', 'D-B'], en: { name: 'All pairs (SuperSpeed and USB 2.0)' } }
      ],
      symmetries: [
        { id: 'flip', name: 'Steckorientierung gedreht (A↔B)', en: { name: 'Plug orientation flipped (A↔B)' }, map: Object.fromEntries(contacts.map(c => [c.id, swap(c.id)])) },
        { id: 'mirror', name: 'Links/rechts gespiegelt', en: { name: 'Mirrored left/right' }, map: Object.fromEntries(contacts.map(c => [c.id, mirror(c.id)])) },
        { id: 'flip-mirror', name: 'Gedreht und gespiegelt', en: { name: 'Flipped and mirrored' }, map: Object.fromEntries(contacts.map(c => [c.id, swap(mirror(c.id))])) }
      ]
    };
  }

  function rj45() {
    const contacts = [1, 2, 3, 4, 5, 6, 7, 8].map(k => ({ id: String(k), label: String(k), normative: 'Kontakt ' + k, role: 'signal', x: (k - 1) * 1.02, y: 0 }));
    const MDI = { 1: 'BI_DA+', 2: 'BI_DA−', 3: 'BI_DB+', 6: 'BI_DB−', 4: 'BI_DC+', 5: 'BI_DC−', 7: 'BI_DD+', 8: 'BI_DD−' };
    contacts.forEach(c => { c.label = c.id + ' · ' + MDI[c.id]; c.normative = MDI[c.id]; });
    const pairs = [
      { id: 'A', plus: '1', minus: '2', name: 'Paar 1/2 · BI_DA (10/100: TX)', group: 'eth', en: { name: 'Pair 1/2 · BI_DA (10/100: TX)' } }, { id: 'B', plus: '3', minus: '6', name: 'Paar 3/6 · BI_DB (10/100: RX)', group: 'eth', en: { name: 'Pair 3/6 · BI_DB (10/100: RX)' } },
      { id: 'C', plus: '4', minus: '5', name: 'Paar 4/5 · BI_DC', group: 'eth', en: { name: 'Pair 4/5 · BI_DC' } }, { id: 'D', plus: '7', minus: '8', name: 'Paar 7/8 · BI_DD', group: 'eth', en: { name: 'Pair 7/8 · BI_DD' } }
    ];
    return {
      schema: SCHEMA, version: VERSION, id: 'rj45-8p8c-thru', revision: '1.0.0', status: 'validated',
      family: 'RJ45 / 8P8C', name: 'RJ45 8P8C · 8 Kontakte, Durchgangsmessung', variant: 'Ethernet MDI', gender: 'receptacle',
      view: 'Steckseite der Buchse, Pin 8 links und Pin 1 rechts; Zeichnung schematisch', contacts, pairs, sources: [ETH_SOURCE], nets: [],
      en: { name: 'RJ45 8P8C · 8 contacts, thru measurement', view: 'Jack mating side, pin 8 at left and pin 1 at right; schematic drawing' },
      measurement: { kind: 'thru', sides: [1, 2], sideNames: ['Seite 1', 'Seite 2'], note: 'Ein Messport je Kontakt und Seite. Ein Magnetics-Kanal ist ein anderes Messmodell (siehe LAN-Magnetics).',
        en: { sideNames: ['Side 1', 'Side 2'], note: 'One measurement port per contact and side. A magnetics channel is a different measurement model (see LAN magnetics).' } },
      configurations: [
        { id: '10-100', name: '10BASE-T / 100BASE-TX (2 Paare)', pairs: ['A', 'B'], en: { name: '10BASE-T / 100BASE-TX (2 pairs)' } },
        { id: '1000', name: '1000BASE-T (4 Paare)', pairs: ['A', 'B', 'C', 'D'], en: { name: '1000BASE-T (4 pairs)' } }
      ],
      symmetries: [{ id: 'mirror', name: 'Kontaktreihe gespiegelt (1↔8)', en: { name: 'Contact row mirrored (1↔8)' }, map: Object.fromEntries(contacts.map(c => [c.id, String(9 - Number(c.id))])) }]
    };
  }

  // LAN magnetics: one port per pin, no sides. Channel = primary pair → secondary pair, optional centre taps.
  function magnetics(channels, taps) {
    const contacts = [], pairs = [], perSide = taps ? 3 : 2;
    for (let c = 1; c <= channels; c++) {
      const y0 = (c - 1) * (perSide + 1.2);
      const side = (prefix, x) => (taps ? ['+', 'CT', '−'] : ['+', '−']).map((s, k) => ({ id: prefix + c + s, label: prefix + (channels > 1 ? c : '') + ' ' + s, normative: (prefix === 'P' ? 'Primär ' : 'Sekundär ') + s,
        en: { normative: (prefix === 'P' ? 'Primary ' : 'Secondary ') + s }, role: s === 'CT' ? 'tap' : 'signal', x, y: y0 + k * (taps ? 1 : 2) }));
      contacts.push(...side('P', 0), ...side('S', 4));
      pairs.push({ id: 'P' + c, plus: 'P' + c + '+', minus: 'P' + c + '−', name: 'Kanal ' + c + ' primär', en: { name: 'Channel ' + c + ' primary' }, group: 'mag', channel: c, side: 'P' },
        { id: 'S' + c, plus: 'S' + c + '+', minus: 'S' + c + '−', name: 'Kanal ' + c + ' sekundär', en: { name: 'Channel ' + c + ' secondary' }, group: 'mag', channel: c, side: 'S' });
    }
    const n = contacts.length;
    return {
      schema: SCHEMA, version: VERSION, id: 'lan-magnetics-' + n + 'p', revision: '1.0.0', status: 'validated',
      family: 'LAN-Magnetics', name: 'LAN-Magnetics · S' + n + 'P · ' + channels + (channels > 1 ? ' Kanäle' : ' Kanal') + (taps ? ' mit Mittelanzapfungen' : ''),
      variant: taps ? 'Übertrager mit Mittelanzapfung' : 'Übertrager ohne Mittelanzapfung', gender: 'device',
      view: 'Schaltungssicht: primär links, sekundär rechts', contacts, pairs, nets: [],
      en: { name: 'LAN magnetics · S' + n + 'P · ' + channels + (channels > 1 ? ' channels' : ' channel') + (taps ? ' with centre taps' : ''), family: 'LAN magnetics',
        variant: taps ? 'Transformer with centre tap' : 'Transformer without centre tap', view: 'Circuit view: primary left, secondary right' },
      sources: [{ title: 'Messmodell-Vorlage, keine Norm', ref: 'S4P: ein Kanal; S6P: ein Kanal mit zwei Mittelanzapfungen; S12P: zwei S6P-Kanäle', note: 'Topologie wird aus den Messdaten geprüft (galvanische Gruppen), nicht angenommen.',
        en: { title: 'Measurement model template, not a standard', ref: 'S4P: one channel; S6P: one channel with two centre taps; S12P: two S6P channels', note: 'The topology is checked from the measured data (galvanic groups), not assumed.' } }],
      measurement: { kind: 'pins', note: 'Ein Messport je Bauteilanschluss. Welche Seite primär heißt, folgt aus Metadaten oder der Portreihenfolge, nicht aus der Messung.',
        en: { note: 'One measurement port per terminal of the part. Which side is called primary follows from metadata or the port order, not from the measurement.' } },
      configurations: [{ id: 'all', name: 'Alle Kanäle', en: { name: 'All channels' }, pairs: pairs.map(p => p.id) }],
      symmetries: [{ id: 'sides', name: 'Primär und sekundär vertauscht', en: { name: 'Primary and secondary swapped' }, map: Object.fromEntries(contacts.map(c => [c.id, (c.id[0] === 'P' ? 'S' : 'P') + c.id.slice(1)])) }],
      magnetics: { channels, taps }
    };
  }

  const PROFILES = [usbC(), rj45(), magnetics(1, false), magnetics(1, true), magnetics(2, true)];
  // Profiles built from a port-map file (sidecar) live only in the session that loaded them.
  const CUSTOM = new Map();
  const profile = id => PROFILES.find(p => p.id === id) || CUSTOM.get(id) || null;
  const customProfiles = () => [...CUSTOM.values()];
  const canonical = value => Array.isArray(value) ? value.map(canonical) :
    value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
  function checkRegistration(p) {
    const v = validateProfile(p);
    if (!v.ok) throw new Error('Profil ungültig: ' + v.errors.slice(0, 3).join(' · '));
    if (p.status !== 'file') throw new Error('Eine eingebettete Profildefinition muss ein Dateiprofil sein.');
    if (PROFILES.some(x => x.id === p.id)) throw new Error('Die Kennung ' + p.id + ' gehört zu einem eingebauten Profil.');
    const existing = CUSTOM.get(p.id);
    if (existing && JSON.stringify(canonical(existing)) !== JSON.stringify(canonical(p))) {
      throw new Error('Konflikt für Connector-Profil ' + p.id + ' · Revision ' + p.revision);
    }
  }
  function register(p) {
    checkRegistration(p);
    CUSTOM.set(p.id, p);
    return p;
  }

  // Sidecar port map (simonlation.synthetic-portmap.v1 and compatible): every port names its pin, signal, side and role,
  // differential pairs name their + and − ports. It becomes a one-port-per-terminal profile plus the mapping of the file.
  // Nothing in it is taken as measured: the channel check below compares it with the S-matrix.
  const SIDECAR_SCHEMA = /^simonlation\.(synthetic-)?portmap\.v1$/;
  function fromSidecar(json, n = null) {
    const d = typeof json === 'string' ? JSON.parse(json) : json;
    if (!SIDECAR_SCHEMA.test(String(d?.schema || ''))) throw new Error('Keine Port-Map-Datei (schema simonlation.portmap.v1).');
    const ports = Array.isArray(d.ports) ? d.ports : [];
    if (!ports.length || ports.length > 64) throw new Error('Die Port-Map nennt keine oder zu viele Ports.');
    if (d.number_of_ports !== undefined && d.number_of_ports !== ports.length) throw new Error('Die deklarierte Portzahl stimmt nicht mit der Portliste überein.');
    if (ports.some((x, i) => Number(x?.port) !== i + 1)) throw new Error('Die Ports der Port-Map sind nicht lückenlos 1…N nummeriert.');
    if (n !== null && ports.length !== n) throw new Error('Die Port-Map gilt für ' + ports.length + ' Ports, die Datei hat ' + n + '.');
    const clean = v => String(v ?? '').replace(/[<>&"']/g, '').slice(0, 40);
    const sides = [...new Set(ports.map(x => clean(x.side) || '–'))];
    const ROLE = { ground: 'ground', power: 'power', 'center-tap': 'tap', centertap: 'tap', tap: 'tap', shield: 'shield', signal: 'signal', control: 'config', led: 'led' };
    const idOf = x => (sides.length > 1 ? (sides.indexOf(clean(x.side) || '–') + 1) + '·' : '') + (clean(x.pin) || String(x.port));
    const contacts = [], perSide = sides.map(() => 0), rowsPerColumn = 12, colOffset = [];
    let x0 = 0;
    for (const side of sides) {
      const count = ports.filter(x => (clean(x.side) || '–') === side).length;
      colOffset.push(x0); x0 += Math.ceil(count / rowsPerColumn) * 2.6 + 0.8;
    }
    for (const x of ports) {
      const k = sides.indexOf(clean(x.side) || '–'), i = perSide[k]++;
      const id = idOf(x);
      if (contacts.some(c => c.id === id)) throw new Error('Pin ' + id + ' kommt in der Port-Map doppelt vor.');
      contacts.push({ id, pin: clean(x.pin) || String(x.port), label: clean(x.signal) || clean(x.pin), normative: clean(x.signal), role: ROLE[String(x.role || '').toLowerCase()] || 'signal',
        x: 0.6 + colOffset[k] + Math.floor(i / rowsPerColumn) * 2.6, y: (i % rowsPerColumn) * 1.35, side: sides[k] });
    }
    const pairs = [];
    for (const dp of Array.isArray(d.differential_pairs) ? d.differential_pairs : []) {
      const a = ports[Number(dp.positive_port) - 1], b = ports[Number(dp.negative_port) - 1];
      if (!a || !b || a === b) throw new Error('Differenzpaar ' + clean(dp.pair) + ' nennt ungültige Ports.');
      const side = clean(dp.side) || clean(a.side) || '–', name = clean(dp.pair) || ('P' + (pairs.length + 1));
      if (side !== (clean(a.side) || '–') || side !== (clean(b.side) || '–')) throw new Error('Ein Differenzpaar muss auf derselben Messseite liegen.');
      pairs.push({ id: name + (sides.length > 1 ? '·' + (sides.indexOf(side) + 1) : ''), plus: idOf(a), minus: idOf(b), name: name + ' · ' + side, en: { name: name + ' · ' + side },
        group: 'file', channel: name, channelKey: name, end: sides.indexOf(side) + 1 });
    }
    if (new Set(pairs.map(p => p.id)).size !== pairs.length) throw new Error('Ein Differenzpaar kommt auf derselben Seite doppelt vor.');
    const model = clean(d.model) || 'Port-Map';
    const p = {
      schema: SCHEMA, version: VERSION, id: 'file:' + model, revision: '1.0.0', status: 'file', family: 'Port-Map-Datei', name: 'Port-Map · ' + model,
      variant: d.synthetic ? 'synthetische Testdaten laut Datei' : 'aus Datei', gender: 'device', view: 'Anschlüsse je Seite: ' + sides.join(' · '),
      en: { name: 'Port map · ' + model, family: 'Port map file', variant: d.synthetic ? 'synthetic test data according to the file' : 'from file', view: 'Terminals per side: ' + sides.join(' · ') },
      contacts, pairs, nets: [],
      sources: [{ title: 'Port-Map-Datei, keine Norm', ref: model, note: 'Belegung und Paare stammen aus der Datei. Die Messung prüft Durchgang und Polarität je Kanal.',
        en: { title: 'Port map file, not a standard', ref: model, note: 'Assignment and pairs come from the file. The measurement checks transmission and polarity per channel.' } }],
      measurement: { kind: 'pins', note: 'Ein Messport je Anschluss, wie in der Port-Map-Datei beschrieben.', en: { note: 'One measurement port per terminal, as described in the port map file.' } },
      configurations: [{ id: 'all', name: 'Alle Paare der Datei', en: { name: 'All pairs of the file' }, pairs: pairs.map(x => x.id) }],
      symmetries: [], sidecar: { model, synthetic: !!d.synthetic, sides }
    };
    p.faces = connectorFaces(p).map(face => ({
      ...face, gender: d.connectorGender?.[face.side] === 'plug' ? 'plug' : 'receptacle'
    }));
    if (d.polarityReference !== undefined) p.polarityReference = d.polarityReference;
    const m = emptyMapping(p, ports.length);
    ports.forEach((x, i) => { m.ports[i] = idOf(x); m.source[i] = 'file'; });
    const v = validateProfile(p);
    if (!v.ok) throw new Error(v.errors.join(' · '));
    if (d.paths !== undefined) m.links = validateLinks(p, d.paths);
    return { profile: p, mapping: m, name: model };
  }

  function connectorFaces(p) {
    const faces = [];
    for (const side of p.sidecar.sides) {
      const contacts = p.contacts.filter(c => c.side === side);
      const has = pins => pins.every(pin => contacts.some(c => c.pin === String(pin)));
      const pairPins = (a, b) => p.pairs.some(pair => contacts.some(c => c.id === pair.plus && c.pin === String(a)) &&
        contacts.some(c => c.id === pair.minus && c.pin === String(b)));
      if (has(Array.from({ length: 19 }, (_, i) => i + 1)) && [[1,3],[4,6],[7,9],[10,12]].every(([a,b]) => pairPins(a,b) || pairPins(b,a))) {
        for (const c of contacts) {
          const pin = Number(c.pin);
          if ([2,5,8,11].includes(pin)) c.role = 'shield';
          if (pin === 17) c.role = 'ground';
          if (pin === 18) c.role = 'power';
          if ([13,14,15,16,19].includes(pin)) c.role = 'sideband';
        }
        faces.push({ kind: 'hdmi', side, gender: 'receptacle', reference: 'Haivision Makito X Decoder · HDMI Type A (mating face)' });
      } else if (p.sidecar.model.includes('7499110124') && has(Array.from({ length: 8 }, (_, i) => 'J' + (i + 1)))) {
        faces.push({ kind: 'magjack', side, gender: 'receptacle', reference: 'Würth Elektronik 7499110124 · front view' });
      } else if (contacts.length === 8 && [[1,2],[3,6],[4,5],[7,8]].every(([a,b]) => pairPins(a,b) || pairPins(b,a))) {
        faces.push({ kind: 'rj45', side, gender: 'receptacle', reference: 'Amphenol P-RJHSE-338X · schematic mating face' });
      }
    }
    return faces;
  }

  // Existing sessions store their imported sidecar profile. Recreate only the display fields
  // that predate this extension, so reopening the original sidecar compares the same definition.
  function migrateFileProfile(p) {
    if (p?.status !== 'file' || p.faces !== undefined || !Array.isArray(p.sidecar?.sides) ||
        !Array.isArray(p.contacts) || !Array.isArray(p.pairs)) return p;
    const sides = p.sidecar.sides;
    const contacts = p.contacts.map(c => {
      const prefix = (sides.indexOf(c.side) + 1) + '·';
      return { ...c, pin: c.pin ?? (sides.length > 1 && c.id.startsWith(prefix) ? c.id.slice(prefix.length) : c.id) };
    });
    const sidesByContact = new Map(contacts.map(c => [c.id,c.side]));
    const pairs = p.pairs.map(pair => ({ ...pair, end: sides.indexOf(sidesByContact.get(pair.plus)) + 1 }));
    const migrated = { ...p, contacts, pairs };
    migrated.faces = connectorFaces(migrated);
    return migrated;
  }

  const pairKey = (pair, side) => JSON.stringify([pair, side ?? null]);
  const pathId = (fromKey, toKey) => JSON.stringify([fromKey, toKey]);
  function validateLinks(p, links) {
    const sides = p.measurement.kind === 'thru' ? p.measurement.sides : [null];
    const keys = new Set(p.pairs.flatMap(pair => sides.map(side => pairKey(pair.id, side))));
    const seen = new Set();
    if (!Array.isArray(links)) throw new Error('Signalwege müssen als Liste vorliegen.');
    return links.map(link => {
      if (!keys.has(link?.fromKey) || !keys.has(link?.toKey) || link.fromKey === link.toKey) throw new Error('Signalweg nennt ein unbekanntes Paar oder dieselbe Quelle und dasselbe Ziel.');
      const id = pathId(link.fromKey, link.toKey);
      if (seen.has(id)) throw new Error('Signalweg ist doppelt vorhanden.');
      seen.add(id);
      return { fromKey: link.fromKey, toKey: link.toKey, ...(link.fromData ? { fromData: true } : {}) };
    });
  }

  function directedPaths(channels, links = null) {
    const byKey = new Map(channels.map(c => [pairKey(c.pair, c.side), c]));
    let sourceLinks = links;
    if (!sourceLinks) {
      // Restore older two-end configurations and their fan-out without choosing a single destination.
      sourceLinks = channels.flatMap(a => channels.filter(b => a.channel === b.channel && a.end < b.end)
        .map(b => ({ fromKey: pairKey(a.pair, a.side), toKey: pairKey(b.pair, b.side) })));
    }
    const paths = new Map();
    for (const { fromKey, toKey } of sourceLinks) {
      const a = byKey.get(fromKey), b = byKey.get(toKey);
      if (!a || !b || a === b) continue;
      for (const reverse of [false, true]) {
        const source = reverse ? b : a, target = reverse ? a : b;
        const id = reverse ? pathId(toKey, fromKey) : pathId(fromKey, toKey);
        const channel = a.channel === b.channel ? a.channel : a.channel + ' → ' + b.channel;
        if (!paths.has(id)) paths.set(id, { id, channel, a: source, b: target, reverse });
      }
    }
    for (const path of paths.values()) {
      const { a, b } = path;
      const end = a.end ?? a.side;
      // Excitations are physical differential ports. A shared source (fan-out) is counted only once.
      const shared = new Set([...paths.values()].filter(k => k.a === a || k.b === b || k.a === b || k.b === a).flatMap(k => [k.a.id, k.b.id]));
      const atEnd = e => channels.filter(c => (c.end ?? c.side) === e && !shared.has(c.id)).map(c => c.id);
      path.aggressors = { near: atEnd(end), far: atEnd(b.end ?? b.side) };
    }
    return [...paths.values()];
  }

  // A phase sample only proves polarity in the presence of a separately established phase reference.
  function checkChannels(p, mapping, dataset, reference = p.polarityReference) {
    const pairs = mappedPairs(p, mapping), out = [], n = dataset.n;
    const sddOf = (a, b) => dataset.samples.map(s => {
      if (!s) return null;
      let re = 0, im = 0;
      for (const [i, j, w] of [[b.plus, a.plus, 1], [b.plus, a.minus, -1], [b.minus, a.plus, -1], [b.minus, a.minus, 1]]) { re += w * s[2 * (i * n + j)] * 0.5; im += w * s[2 * (i * n + j) + 1] * 0.5; }
      return [re, im];
    });
    const judge = (channel, a, b, fromData) => {
      const sdd = sddOf(a, b), mags = sdd.map(v => v ? Math.hypot(v[0], v[1]) : 0);
      const max = mags.reduce((m, v) => Math.max(m, v), 0);
      const strong = v => v > 0.1 && v >= 0.9 * max;
      const anchored = goodReference(reference) ? mags.findIndex((v, i) => strong(v) &&
        dataset.freq[i] >= 0 && dataset.freq[i] <= reference.maxFrequencyHz &&
        360 * dataset.freq[i] * reference.maxDelaySeconds <= 30) : -1;
      const k = anchored >= 0 ? anchored : mags.findIndex(strong);
      const phase = k >= 0 ? Math.atan2(sdd[k][1], sdd[k][0]) * 180 / Math.PI : NaN;
      const polarity = !(max > 0.1) ? 'none' : anchored < 0 ? 'open' :
        Math.abs(phase) <= 60 ? 'ok' : Math.abs(phase) >= 120 ? 'inverted' : 'open';
      return { channel, from: a.pair, to: b.pair, fromKey: pairKey(a.pair, a.side), toKey: pairKey(b.pair, b.side),
        maxDb: 20 * Math.log10(Math.max(max, 1e-12)), freq: k >= 0 ? dataset.freq[k] : NaN, phase, polarity, fromData,
        reference: anchored >= 0 ? reference.source : null };
    };
    if (mapping.links) {
      const byKey = new Map(pairs.map(x => [pairKey(x.pair, x.side), x]));
      return mapping.links.flatMap(({ fromKey, toKey, fromData }) => {
        const a = byKey.get(fromKey), b = byKey.get(toKey);
        return a && b ? [judge(a.channel === b.channel ? a.channel : a.channel + ' → ' + b.channel, a, b, !!fromData)] : [];
      });
    }
    const groups = new Map(); for (const x of pairs) { if (!groups.has(x.channel)) groups.set(x.channel, []); groups.get(x.channel).push(x); }
    const single = [];
    for (const [channel, list] of groups) {
      const ends = new Set(list.map(x => x.end));
      if (ends.size < 2) { single.push(...list); continue; }
      const a = list.find(x => x.end === Math.min(...ends));
      for (const b of list.filter(x => x.end !== a.end)) out.push(judge(channel, a, b, false));
    }
    for (const b of single) {
      let best = null, bestMax = 0;
      for (const a of single) {
        if (!(a.end < b.end)) continue;
        const max = sddOf(a, b).reduce((m, v) => v ? Math.max(m, Math.hypot(...v)) : m, 0);
        if (max > bestMax) { bestMax = max; best = a; }
      }
      if (best && bestMax > 0.316) out.push(judge(best.channel + ' → ' + b.channel, best, b, true));
    }
    return out;
  }

  // A profile is only offered as validated when it is complete and consistent.
  const goodReference = r => typeof r?.source === 'string' && !!r.source.trim() &&
    Number.isFinite(r.maxDelaySeconds) && r.maxDelaySeconds >= 0 &&
    Number.isFinite(r.maxFrequencyHz) && r.maxFrequencyHz > 0 && r.response === 'noninverting-baseband';
  function validateProfile(p) {
    const errors = [], ids = new Set();
    if (typeof p?.id !== 'string' || !p.id || typeof p.revision !== 'string' || !p.revision ||
        !Array.isArray(p.contacts) || !p.contacts.length || p.contacts.length > 64 ||
        !Array.isArray(p.pairs) || !Array.isArray(p.configurations) || !p.configurations.length ||
        !Array.isArray(p.sources) || !Array.isArray(p.symmetries)) return { ok: false, errors: ['Profilstruktur unvollständig.'] };
    if (p.polarityReference !== undefined && !goodReference(p.polarityReference)) errors.push('Ungültige Polaritätsreferenz.');
    if (p.faces !== undefined && (!Array.isArray(p.faces) || p.faces.some(f =>
      !['hdmi', 'magjack', 'rj45'].includes(f?.kind) || typeof f.side !== 'string' || !['receptacle', 'plug'].includes(f.gender) ||
      typeof f.reference !== 'string' || !p.contacts.some(c => c?.side === f.side)))) errors.push('Ungültiges Steckgesicht.');
    if (p.schema !== SCHEMA) errors.push('Schema fehlt oder ist falsch.');
    if (!(p.version >= 1)) errors.push('Version fehlt.');
    if (!p.sources?.length) errors.push('Quellen fehlen.');
    for (const c of p.contacts || []) {
      if (typeof c?.id !== 'string' || !c.id || c.id.includes('@') || typeof c.label !== 'string') { errors.push('Ungültiger Kontakt.'); continue; }
      if (ids.has(c.id)) errors.push('Kontakt doppelt: ' + c.id);
      ids.add(c.id);
      if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) errors.push('Position fehlt: ' + c.id);
    }
    const used = new Set(), pairIds = new Set();
    for (const pair of p.pairs) {
      if (typeof pair?.id !== 'string' || !pair.id || pairIds.has(pair.id)) { errors.push('Ungültige oder doppelte Paar-ID.'); continue; }
      pairIds.add(pair.id);
      for (const c of [pair.plus, pair.minus]) {
        if (!ids.has(c)) errors.push('Paar ' + pair.id + ' nennt unbekannten Kontakt ' + c);
        if (used.has(c)) errors.push('Kontakt ' + c + ' in mehreren Paaren');
        used.add(c);
      }
    }
    for (const conf of p.configurations) {
      if (typeof conf?.id !== 'string' || !Array.isArray(conf.pairs) || conf.pairs.some(id => !pairIds.has(id))) errors.push('Ungültige Profilkonfiguration.');
    }
    for (const s of p.symmetries || []) {
      if (!s?.map || Object.keys(s.map).some(id => !ids.has(id))) { errors.push('Ungültige Symmetrie.'); continue; }
      const image = new Set(Object.values(s.map));
      if (image.size !== ids.size || [...image].some(id => !ids.has(id))) errors.push('Symmetrie ' + s.id + ' ist keine Permutation der Kontakte');
    }
    if (!['thru', 'pins'].includes(p.measurement?.kind)) errors.push('Messmodell fehlt.');
    if (p.measurement?.kind === 'thru' && (p.measurement.sides?.join(',') !== '1,2' || p.measurement.sideNames?.length !== 2 || p.contacts.length > 32)) errors.push('Ungültige Messseiten.');
    return { ok: !errors.length, errors };
  }

  // ---------- Nodes and mappings ----------
  const nodesOf = p => p.measurement.kind === 'thru' ? p.contacts.flatMap(c => p.measurement.sides.map(s => c.id + '@' + s)) : p.contacts.map(c => c.id);
  const portCount = p => nodesOf(p).length;
  const splitNode = node => { const [contact, side] = String(node).split('@'); return { contact, side: side ? Number(side) : null }; };
  const nodeId = (contact, side) => side ? contact + '@' + side : contact;
  const emptyMapping = (p, n) => ({ schema: MAP_SCHEMA, version: VERSION, profile: p.id, profileRevision: p.revision, ports: Array.from({ length: n }, () => null), source: Array.from({ length: n }, () => '') });

  // Duplicates, unmeasured contacts, half-measured pairs and unknown nodes. Never repairs anything silently.
  function validateMapping(p, mapping, n = portCount(p)) {
    const issues = [], seen = new Map(), nodes = new Set(nodesOf(p));
    const ports = mapping?.ports;
    if (!Array.isArray(ports) || ports.length !== n || n !== portCount(p)) {
      return { ok: false, issues: [{ level: 'error', text: 'Zuordnung, Profil und Messdatei müssen dieselbe Portzahl haben.' }], portOf: () => undefined };
    }
    Array.from(ports).forEach((node, port) => {
      if (node === null) return;
      if (!nodes.has(node)) issues.push({ level: 'error', port, text: 'Port ' + (port + 1) + ' zeigt auf unbekannten Knoten ' + node });
      if (seen.has(node)) issues.push({ level: 'error', port, text: 'Knoten ' + node + ' ist doppelt belegt: Port ' + (seen.get(node) + 1) + ' und Port ' + (port + 1) });
      else seen.set(node, port);
    });
    const portOf = node => seen.get(node);
    const sides = p.measurement.kind === 'thru' ? p.measurement.sides : [null];
    const ends = new Map();
    for (const pair of p.pairs) for (const s of sides) {
      const a = portOf(nodeId(pair.plus, s)), b = portOf(nodeId(pair.minus, s));
      if ((a === undefined) !== (b === undefined)) issues.push({ level: 'warn', pair: pair.id, text: 'Paar ' + pair.id + (s ? ' Seite ' + s : '') + ' nur halb zugeordnet' });
      const channel = s ? pair.id : pair.channelKey ?? pair.channel ?? pair.id;
      if (!ends.has(channel)) ends.set(channel, []);
      ends.get(channel).push({ end: s ?? pair.end ?? (pair.side === 'S' ? 2 : 1), complete: a !== undefined && b !== undefined });
    }
    for (const [channel, entries] of ends) {
      if (new Set(entries.map(e => e.end)).size > 1 && entries.some(e => e.complete) && entries.some(e => !e.complete)) {
        issues.push({ level: 'warn', text: 'Signalweg ' + channel + ' unvollständig · mindestens ein Paarende fehlt.' });
      }
    }
    const free = mapping.ports.filter(x => !x).length;
    if (free) issues.push({ level: 'info', text: free + (free === 1 ? ' Port ist' : ' Ports sind') + ' keinem Kontakt zugeordnet; sie werden beim Übernehmen abgeschlossen.' });
    return { ok: !issues.some(i => i.level === 'error'), issues, portOf };
  }

  // Pairs available with the current mapping: per pair and side the two ports, if both are mapped.
  function mappedPairs(p, mapping) {
    const { portOf } = validateMapping(p, mapping), out = [];
    const sides = p.measurement.kind === 'thru' ? p.measurement.sides : [null];
    for (const pair of p.pairs) for (const s of sides) {
      const plus = portOf(nodeId(pair.plus, s)), minus = portOf(nodeId(pair.minus, s));
      // channel: the signal path the pair belongs to; end: 1 or 2 along that path (thru: the side; magnetics: primary 1, secondary 2)
      const channel = s ? pair.id : pair.channelKey ?? 'K' + (pair.channel ?? pair.id), end = s ?? pair.end ?? (pair.side === 'S' ? 2 : 1);
      if (plus !== undefined && minus !== undefined) out.push({ pair: pair.id, side: s, channel, end, plus, minus, name: pair.name + (s ? ' · ' + p.measurement.sideNames[s - 1] : '') });
    }
    return out;
  }

  // The analyzer configuration of a mapping: chosen pairs become mixed-mode pairs (ids in the order of the list), all other ports are
  // terminated (matched to the reference by default, or left open/active). Centre taps of magnetics stay open unless asked otherwise.
  function toConfig(p, mapping, n, { pairs = null, others = 'match', taps = 'open' } = {}) {
    const validation = validateMapping(p, mapping, n);
    if (!validation.ok) throw new Error(validation.issues.find(i => i.level === 'error').text);
    const chosen = mappedPairs(p, mapping).filter(x => !pairs || pairs.includes(x.pair));
    const loads = Array.from({ length: n }, () => ({ type: others === 'active' ? 'active' : others }));
    const config = { loads, pairs: [], ref: null }, channels = [];
    chosen.forEach((x, i) => {
      loads[x.plus] = { type: 'active' }; loads[x.minus] = { type: 'active' };
      config.pairs.push({ p: x.plus, q: x.minus, id: i + 1 });
      channels.push({ ...x, id: i + 1 });
    });
    mapping.ports.forEach((node, port) => {
      if (!node) return;
      const c = p.contacts.find(k => k.id === splitNode(node).contact);
      if (c?.role === 'tap') loads[port] = { type: taps === 'active' ? 'active' : taps };
    });
    return { config, channels };
  }

  // ---------- Evidence from the S-matrix ----------
  const mag = (s, n, i, j) => { const k = 2 * (i * n + j); return Math.hypot(s[k], s[k + 1]); };
  // Mean |S_ij| over a frequency band (indices). Sparse sampling keeps 48-port files fast.
  function bandMatrix(dataset, lo, hi, maxPoints = 24) {
    const n = dataset.n, idx = [];
    for (let i = 0; i < dataset.freq.length; i++) if (dataset.freq[i] >= lo && dataset.freq[i] <= hi && dataset.samples[i]) idx.push(i);
    const step = Math.max(1, Math.ceil(idx.length / maxPoints)), use = idx.filter((_, k) => k % step === 0);
    const m = new Float64Array(n * n);
    for (const k of use) { const s = dataset.samples[k]; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) m[i * n + j] += mag(s, n, i, j); }
    if (use.length) for (let i = 0; i < m.length; i++) m[i] /= use.length;
    return { m, points: use.length };
  }
  function bands(dataset) {
    const f = dataset.freq.filter(x => x > 0), lo = f[0], hi = f.at(-1), r = hi / lo;
    return { low: [lo, lo * r ** 0.2], high: [lo * r ** 0.5, hi], lo, hi };
  }
  // Thru paths: every port's strongest low-frequency partner; mutual best partners with a clear margin form a conductor.
  function thruPaths(dataset) {
    const n = dataset.n, b = bands(dataset), { m } = bandMatrix(dataset, ...b.low), best = [];
    for (let i = 0; i < n; i++) {
      let j1 = -1, v1 = -1, v2 = 0;
      for (let j = 0; j < n; j++) if (j !== i) { const v = m[i * n + j]; if (v > v1) { v2 = v1; v1 = v; j1 = j; } else if (v > v2) v2 = v; }
      best.push({ j: j1, v: v1, margin: v1 / Math.max(v2, 1e-6) });
    }
    const paths = [], used = new Set();
    for (let i = 0; i < n; i++) {
      const { j, v, margin } = best[i];
      if (j > i && best[j].j === i && !used.has(i) && !used.has(j)) {
        used.add(i); used.add(j);
        paths.push({ a: i, b: j, mag: v, margin: Math.min(margin, best[j].margin), clear: v > 0.5 && Math.min(margin, best[j].margin) > 2 });
      }
    }
    return { paths, unmatched: [...Array(n).keys()].filter(i => !used.has(i)), best };
  }
  const tokens = name => String(name || '').toUpperCase().replace(/[−–]/g, '-').split(/[^A-Z0-9+\-]+/).filter(Boolean);
  // Port names from the file ("Port[k] = …") checked against contact ids and signal names. Returns per port the matching node or null.
  function fromNames(p, dataset) {
    const out = Array.from({ length: dataset.n }, () => null), names = dataset.portNames || [];
    // "LEFT | A1 | GND | ground": a first field with exactly two values, each on half of the ports, names the two sides in order.
    const first = names.map(name => String(name || '').split('|')[0].trim().toUpperCase());
    const fieldSides = names.every(name => String(name || '').includes('|')) ? [...new Set(first)] : [];
    const sideOf = fieldSides.length === 2 && fieldSides.every(v => v && first.filter(x => x === v).length === dataset.n / 2) ? v => fieldSides.indexOf(v) + 1 : null;
    const byId = new Map(p.contacts.map(c => [c.id.toUpperCase(), c.id]));
    const byName = new Map();
    for (const c of p.contacts) for (const label of [c.normative, c.label]) {
      const key = String(label || '').toUpperCase().replace(/[−–]/g, '-').replace(/\s+/g, '');
      if (key && p.contacts.filter(k => [k.normative, k.label].some(l => String(l || '').toUpperCase().replace(/[−–]/g, '-').replace(/\s+/g, '') === key)).length === 1) byName.set(key, c.id);
    }
    names.forEach((name, port) => {
      const t = sideOf ? tokens(String(name).split('|').slice(1).join('|')) : tokens(name);
      let contact = null, side = null;
      for (const tok of t) {
        if (!contact && byId.has(tok) && p.measurement.kind === 'thru' && /^[AB]\d+$|^\d+$/.test(tok) && p.contacts.length > 1) contact = byId.get(tok);
        if (!contact && byName.has(tok)) contact = byName.get(tok);
      }
      const joined = String(name || '').toUpperCase();
      const m = joined.match(/(?:SIDE|SEITE|S)\s*([12])\b|_([12])$|\b(NEAR|FAR|IN|OUT|L|R|LEFT|RIGHT|LINKS|RECHTS)\b/);
      if (sideOf) side = sideOf(first[port]);
      else if (m) side = m[1] ? Number(m[1]) : m[2] ? Number(m[2]) : ['NEAR', 'IN', 'L', 'LEFT', 'LINKS'].includes(m[3]) ? 1 : 2;
      if (contact && (p.measurement.kind !== 'thru' || side)) out[port] = nodeId(contact, p.measurement.kind === 'thru' ? side : null);
    });
    return out;
  }

  // Geometric neighbourhood of contacts (used only to rank placements, never as a measured fact).
  function weights(p) {
    const n = p.contacts.length, w = new Float64Array(n * n);
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (a !== b) {
      const d = Math.hypot(p.contacts[a].x - p.contacts[b].x, p.contacts[a].y - p.contacts[b].y);
      w[a * n + b] = d < 2.2 ? 1 / (d * d) : 0;
    }
    return w;
  }
  // Which end of each conductor lies on which side. Ends on the same side couple differently (near end) from ends on opposite
  // sides (far end). For neighbouring conductors u, v compare same = |S(a_u,a_v)| + |S(b_u,b_v)| with cross = |S(a_u,b_v)| + |S(b_u,a_v)|;
  // a maximum spanning tree over |ln(same/cross)| fixes the relative orientation. Which side is "1" stays open (a symmetry).
  function orient(paths, hm, n) {
    const K = paths.length, rel = [];
    for (let u = 0; u < K; u++) for (let v = u + 1; v < K; v++) {
      const a = paths[u], b = paths[v], same = hm[a.a * n + b.a] + hm[a.b * n + b.b], cross = hm[a.a * n + b.b] + hm[a.b * n + b.a];
      if (same > 0 && cross > 0) rel.push({ u, v, flip: cross > same, w: Math.abs(Math.log(same / cross)) * Math.max(same, cross) });
    }
    rel.sort((x, y) => y.w - x.w);
    const flip = new Array(K).fill(null), conf = new Array(K).fill(0);
    const parent = [...Array(K).keys()], root = x => parent[x] === x ? x : (parent[x] = root(parent[x])), adj = Array.from({ length: K }, () => []);
    for (const e of rel) { const a = root(e.u), b = root(e.v); if (a === b) continue; parent[a] = b; adj[e.u].push(e); adj[e.v].push(e); }
    for (let start = 0; start < K; start++) {
      if (flip[start] !== null) continue;
      flip[start] = false; conf[start] = Infinity;
      const queue = [start];
      while (queue.length) {
        const u = queue.shift();
        for (const e of adj[u]) { const v = e.u === u ? e.v : e.u; if (flip[v] !== null) continue; flip[v] = flip[u] !== e.flip; conf[v] = Math.min(conf[u], e.w); queue.push(v); }
      }
    }
    return paths.map((x, k) => ({ ...x, a: flip[k] ? x.b : x.a, b: flip[k] ? x.a : x.b, orientation: conf[k] }));
  }
  // Coupling between conductors (thru paths, already oriented): mean near-end coupling at both ends in the upper band, in log units.
  function conductorCoupling(dataset, paths, hm) {
    const n = dataset.n, k = paths.length, out = new Float64Array(k * k);
    for (let u = 0; u < k; u++) for (let v = 0; v < k; v++) if (u !== v) {
      const a = paths[u], b = paths[v];
      const c = (hm[a.a * n + b.a] + hm[a.b * n + b.b]) / 2;
      out[u * k + v] = Math.log10(Math.max(c, 1e-6)) + 6;   // ≥ 0, larger = stronger coupling
    }
    return out;
  }
  function pearson(x, y) {
    const n = x.length; if (n < 3) return 0;
    const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
    return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
  }

  // How well a mapping agrees with the measured structure. thru: share of contacts whose two sides are a measured conductor.
  // adjacency: correlation of measured coupling with geometric neighbourhood. names: share of named ports that agree.
  function scoreMapping(p, mapping, ev) {
    const n = mapping.ports.length, portOf = new Map();
    mapping.ports.forEach((node, port) => node && portOf.set(node, port));
    // only clear thru paths confirm a contact; a weak mutual best partner (e.g. an open contact) does not
    const pathOf = new Map(); ev.thru.paths.filter(x => x.clear).forEach(x => { pathOf.set(x.a, x.b); pathOf.set(x.b, x.a); });
    const result = { thru: null, adjacency: null, names: null, unconfirmed: [] };
    if (p.measurement.kind === 'thru') {
      let ok = 0, both = 0;
      for (const c of p.contacts) {
        const a = portOf.get(nodeId(c.id, 1)), b = portOf.get(nodeId(c.id, 2));
        both++;                                   // every contact of the profile counts; an empty one is unconfirmed
        if (a !== undefined && b !== undefined && pathOf.get(a) === b) ok++; else result.unconfirmed.push(c.id);
      }
      result.thru = both ? ok / both : 0;
      // clear thru paths whose two ends this mapping puts on different contacts (or leaves open): direct contradictions
      result.contradict = ev.thru.paths.filter(x => x.clear).filter(x => {
        const na = mapping.ports[x.a], nb = mapping.ports[x.b];
        return !na || !nb || splitNode(na).contact !== splitNode(nb).contact || splitNode(na).side === splitNode(nb).side;
      }).length;
      const x = [], y = [], w = ev.weights, cs = p.contacts;
      for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
        const a1 = portOf.get(nodeId(cs[i].id, 1)), b1 = portOf.get(nodeId(cs[j].id, 1)), a2 = portOf.get(nodeId(cs[i].id, 2)), b2 = portOf.get(nodeId(cs[j].id, 2));
        if ([a1, b1, a2, b2].some(v => v === undefined)) continue;
        x.push(Math.log10(Math.max(1e-6, (ev.high[a1 * n + b1] + ev.high[a2 * n + b2]) / 2)));
        y.push(w[i * cs.length + j]);
      }
      result.adjacency = pearson(x, y);
      // side consistency: for strongly coupled neighbours, the ends the mapping puts on the same side must couple as near ends
      let agree = 0, total = 0;
      for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
        if (w[i * cs.length + j] < 0.5) continue;
        const a1 = portOf.get(nodeId(cs[i].id, 1)), b1 = portOf.get(nodeId(cs[j].id, 1)), a2 = portOf.get(nodeId(cs[i].id, 2)), b2 = portOf.get(nodeId(cs[j].id, 2));
        if ([a1, b1, a2, b2].some(v => v === undefined)) continue;
        const same = ev.high[a1 * n + b1] + ev.high[a2 * n + b2], cross = ev.high[a1 * n + b2] + ev.high[a2 * n + b1];
        if (Math.abs(Math.log(same / cross)) < 0.05) continue;
        total++; if (same > cross) agree++;
      }
      // Consistency, not direction: whether near-end coupling is stronger than far-end coupling depends on the structure
      // (inductive and capacitive coupling add at the near end and partly cancel at the far end, but not in every model).
      // A single contact with swapped ends breaks the consistency; which side is which is a symmetry of the data.
      result.sides = total ? Math.max(agree, total - agree) / total : null;
      result.nearStronger = total ? agree >= total - agree : null;
    }
    let named = 0, agree = 0;
    ev.names.forEach((node, port) => { if (!node) return; named++; if (mapping.ports[port] === node) agree++; });
    result.names = named ? agree / named : null;
    result.total = (result.thru ?? 1) * 0.5 + Math.max(0, result.adjacency ?? 0) * 0.2 + (result.sides ?? 1) * 0.15 + (result.names ?? 0.5) * 0.15;
    return result;
  }
  // The placement objective Σ near-end coupling × neighbourhood for any thru mapping; comparable with place().score.
  function objective(p, mapping, ev) {
    const n = mapping.ports.length, portOf = new Map(), cs = p.contacts, w = ev.weights;
    mapping.ports.forEach((node, port) => node && portOf.set(node, port));
    let sum = 0;
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const wij = w[i * cs.length + j]; if (!wij) continue;
      const a1 = portOf.get(nodeId(cs[i].id, 1)), b1 = portOf.get(nodeId(cs[j].id, 1)), a2 = portOf.get(nodeId(cs[i].id, 2)), b2 = portOf.get(nodeId(cs[j].id, 2));
      if ([a1, b1, a2, b2].some(v => v === undefined)) continue;
      // orientation-independent: the stronger of same-end and opposite-end coupling (which one dominates depends on the structure)
      const same = ev.high[a1 * n + b1] + ev.high[a2 * n + b2], cross = ev.high[a1 * n + b2] + ev.high[a2 * n + b1];
      sum += wij * (Math.log10(Math.max(Math.max(same, cross) / 2, 1e-6)) + 6);
    }
    return sum;
  }
  const applySymmetry = (mapping, sym) => ({ ...mapping, ports: mapping.ports.map(node => { if (!node) return node; const { contact, side } = splitNode(node); return nodeId(sym.map[contact] ?? contact, side); }) });
  const swapSides = mapping => ({ ...mapping, ports: mapping.ports.map(node => { if (!node) return node; const { contact, side } = splitNode(node); return side ? nodeId(contact, 3 - side) : node; }) });

  // Port-numbering conventions of thru measurements: one hypothesis each, judged by the data.
  function conventions(p, n) {
    const C = p.contacts.length, out = [];
    if (p.measurement.kind !== 'thru' || n !== 2 * C) return out;
    const make = (id, name, f) => { const m = emptyMapping(p, n); for (let port = 0; port < n; port++) { const [c, s] = f(port); m.ports[port] = nodeId(p.contacts[c].id, s); m.source[port] = 'convention'; } out.push({ id, name, mapping: m }); };
    make('block', 'Ports 1–' + C + ' Seite 1 in Kontaktreihenfolge, ' + (C + 1) + '–' + n + ' Seite 2', port => [port % C, port < C ? 1 : 2]);
    make('interleaved', 'Abwechselnd: ungerade Ports Seite 1, gerade Seite 2', port => [Math.floor(port / 2), port % 2 + 1]);
    make('block-reverse', 'Seite 2 in umgekehrter Kontaktreihenfolge', port => [port < C ? port : 2 * C - 1 - port, port < C ? 1 : 2]);
    return out;
  }

  // Data-driven placement of conductors onto contacts: maximise Σ coupling·neighbourhood by simulated annealing with
  // deterministic restarts. Symmetric images of the connector score exactly the same – that ambiguity is reported, not hidden.
  function place(p, ev) {
    const K = ev.thru.paths.length, C = p.contacts.length;
    if (K < 2 || K > C) return null;
    const paths = orient(ev.thru.paths, ev.high, ev.dataset.n);
    const cc = conductorCoupling(ev.dataset, paths, ev.high), w = ev.weights;
    let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const score = perm => { let s = 0; for (let u = 0; u < K; u++) for (let v = u + 1; v < K; v++) s += cc[u * K + v] * w[perm[u] * C + perm[v]]; return s; };
    const results = [];
    for (let restart = 0; restart < 6; restart++) {
      let perm = [...Array(C).keys()];
      for (let i = C - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
      let cur = score(perm), best = perm.slice(), bestScore = cur, T = Math.max(cur, 1) * 0.05;
      for (let it = 0; it < 6000; it++) {
        const i = Math.floor(rnd() * C), j = Math.floor(rnd() * C);
        if (i === j || (i >= K && j >= K)) continue;
        [perm[i], perm[j]] = [perm[j], perm[i]];
        const next = score(perm);
        if (next >= cur || rnd() < Math.exp((next - cur) / T)) { cur = next; if (cur > bestScore) { bestScore = cur; best = perm.slice(); } }
        else [perm[i], perm[j]] = [perm[j], perm[i]];
        T *= 0.9993;
      }
      results.push({ perm: best, score: bestScore });
    }
    results.sort((a, b) => b.score - a.score);
    const toMapping = perm => { const m = emptyMapping(p, ev.dataset.n); paths.forEach((x, u) => { const c = p.contacts[perm[u]].id; m.ports[x.a] = nodeId(c, 1); m.ports[x.b] = nodeId(c, 2); m.source[x.a] = m.source[x.b] = 'data'; }); return m; };
    return { mapping: toMapping(results[0].perm), score: results[0].score, runnerUp: results.find(r => r.score < results[0].score * 0.999)?.score ?? null };
  }

  // ---------- Magnetics: galvanic groups, centre taps, channels, polarity ----------
  // Within a winding |S_ij| rises towards low frequency (the winding becomes a short); across the isolation it falls (∝ ω).
  function magneticsStructure(dataset) {
    const n = dataset.n, f = dataset.freq, b = bands(dataset);
    const lowIdx = Array.from(f, (x, i) => [x, i]).filter(([x]) => x > 0 && x <= b.lo * 3).map(([, i]) => i);
    const i0 = lowIdx[0], i1 = lowIdx.at(-1) ?? i0;
    if (i0 === undefined || i0 === i1) return { ok: false, reason: 'Zu wenige Punkte im untersten Frequenzbereich.' };
    const s0 = dataset.samples[i0], s1 = dataset.samples[i1];
    const galvanic = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = mag(s0, n, i, j), c = mag(s1, n, i, j), slope = Math.log(c / a) / Math.log(f[i1] / f[i0]);
      if (a > 0.3 && slope < 0.25) galvanic.push([i, j]);
    }
    const parent = [...Array(n).keys()], root = x => parent[x] === x ? x : (parent[x] = root(parent[x]));
    for (const [i, j] of galvanic) parent[root(i)] = root(j);
    const groups = new Map(); for (let i = 0; i < n; i++) { const r = root(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
    const list = [...groups.values()].sort((a, b) => a[0] - b[0]);
    const tapOf = g => g.length !== 3 ? null : g.map(c => ({ c, v: Math.min(...g.filter(x => x !== c).map(x => mag(s0, n, c, x))) })).sort((a, b) => b.v - a.v)[0].c;
    return { ok: true, groups: list.map(g => { const tap = tapOf(g); return { ports: g, tap, ends: g.filter(x => x !== tap) }; }), freq: [f[i0], f[i1]] };
  }
  // Differential transmission between two port pairs at a mid-band frequency (power waves, equal references).
  function sdd21(s, n, [a, b], [c, d]) {
    const g = (i, j) => [s[2 * (i * n + j)], s[2 * (i * n + j) + 1]];
    const re = (g(c, a)[0] - g(c, b)[0] - g(d, a)[0] + g(d, b)[0]) / 2, im = (g(c, a)[1] - g(c, b)[1] - g(d, a)[1] + g(d, b)[1]) / 2;
    return [re, im];
  }
  function detectMagnetics(p, dataset, ev) {
    const st = magneticsStructure(dataset), notes = [], { channels, taps } = p.magnetics, per = taps ? 3 : 2;
    if (!st.ok) return { candidates: [], notes: [st.reason] };
    const sizes = st.groups.map(g => g.ports.length).sort().join(',');
    if (st.groups.length !== 2 * channels || st.groups.some(g => g.ports.length !== per)) {
      return { candidates: [], structure: st, notes: ['Die galvanischen Gruppen der Messung (' + st.groups.map(g => g.ports.map(x => 'P' + (x + 1)).join('/')).join(' · ') + ') passen nicht zu ' + channels + '×' + (taps ? '2×3' : '2×2') + ' Anschlüssen.'] };
    }
    // pair primary and secondary groups by differential transmission in mid band
    const mid = dataset.freq.findIndex(f => f >= Math.sqrt(bands(dataset).lo * bands(dataset).hi)), s = dataset.samples[mid] || dataset.samples.find(Boolean), n = dataset.n;
    const G = st.groups, used = new Set(), links = [];
    for (let a = 0; a < G.length; a++) {
      if (used.has(a)) continue;
      let best = -1, bv = -1;
      for (let b = 0; b < G.length; b++) if (b !== a && !used.has(b)) { const v = Math.hypot(...sdd21(s, n, G[a].ends, G[b].ends)); if (v > bv) { bv = v; best = b; } }
      used.add(a); used.add(best); links.push([a, best, bv]);
    }
    const m = emptyMapping(p, n);
    links.sort((x, y) => Math.min(...G[x[0]].ports) - Math.min(...G[y[0]].ports)).forEach(([a, b], k) => {
      const [pri, sec] = Math.min(...G[a].ports) < Math.min(...G[b].ports) ? [G[a], G[b]] : [G[b], G[a]], c = k + 1;
      const [pp, pm] = pri.ends.slice().sort((x, y) => x - y);
      let [sp, sm] = sec.ends.slice().sort((x, y) => x - y);
      const t = sdd21(s, n, [pp, pm], [sp, sm]);
      if (t[0] < 0) [sp, sm] = [sm, sp];             // dot convention from the measured phase
      m.ports[pp] = 'P' + c + '+'; m.ports[pm] = 'P' + c + '−'; m.ports[sp] = 'S' + c + '+'; m.ports[sm] = 'S' + c + '−';
      m.source[pp] = m.source[pm] = 'convention'; m.source[sp] = m.source[sm] = 'data';
      if (taps) { m.ports[pri.tap] = 'P' + c + 'CT'; m.ports[sec.tap] = 'S' + c + 'CT'; m.source[pri.tap] = m.source[sec.tap] = 'data'; }
    });
    notes.push('Galvanische Gruppen aus dem Verlauf zu tiefen Frequenzen (' + st.groups.map(g => g.ports.map(x => 'P' + (x + 1)).join('/')).join(' · ') + ').');
    if (taps) notes.push('Mittelanzapfung je Gruppe: der Anschluss mit der stärksten Verbindung zu beiden anderen.');
    notes.push('Gleichsinnige Polarität der Sekundärseite aus der Phase der Differenzübertragung (Punktkonvention aus der Messung).');
    notes.push('Welche Seite „primär“ heißt und welcher Primäranschluss „+“ ist, folgt aus der Portreihenfolge, nicht aus der Messung.');
    const named = ev.names.filter(Boolean).length, agree = ev.names.filter((node, port) => node && m.ports[port] === node).length;
    const category = named === n && agree === n ? 'certain' : 'likely';
    return { structure: st, notes, candidates: [{ id: 'magnetics', name: 'Aus der Messung: galvanische Gruppen und Phase', mapping: m, category, score: { thru: null, adjacency: null, names: named ? agree / named : null, total: 1 },
      alternatives: [{ id: 'sides', name: 'Primär und sekundär vertauscht', equivalent: true }] }] };
  }

  // ---------- Main entry ----------
  // Returns ranked candidates with a category: certain · likely · several · unresolved. A candidate is never "certain" unless
  // independent evidence (port names in the file) agrees with the measured structure.
  function detect(dataset, profileId) {
    const p = typeof profileId === 'string' ? profile(profileId) : profileId;
    if (!p) return { error: 'Unbekanntes Profil.' };
    const n = dataset.n, need = portCount(p), notes = [];
    if (n !== need) return { profile: p.id, candidates: [], status: 'mismatch', notes: ['Das Profil erwartet ' + need + ' Messports, die Datei hat ' + n + '. Diese Interpretation passt nicht.'] };
    const b = bands(dataset);
    const ev = { dataset, thru: thruPaths(dataset), names: fromNames(p, dataset), weights: weights(p), high: bandMatrix(dataset, ...b.high).m };
    if (p.measurement.kind === 'pins') {
      const r = detectMagnetics(p, dataset, ev);
      const best = r.candidates[0];
      return { profile: p.id, candidates: r.candidates, status: best ? best.category : 'unresolved', notes: r.notes, structure: r.structure };
    }
    const clear = ev.thru.paths.filter(x => x.clear).length;
    notes.push(clear + ' von ' + p.contacts.length + ' Durchgängen eindeutig erkannt (|S| im unteren Band > 0,5 und mindestens doppelt so stark wie der nächste Kandidat).');
    const candidates = [];
    const named = ev.names.filter(Boolean).length;
    if (named) {
      const m = emptyMapping(p, n); ev.names.forEach((node, port) => { m.ports[port] = node; m.source[port] = node ? 'names' : ''; });
      candidates.push({ id: 'names', name: 'Aus den Portnamen der Datei (' + named + ' von ' + n + ')', mapping: m });
    }
    for (const c of conventions(p, n)) candidates.push(c);
    const placed = place(p, ev);
    if (placed) {
      candidates.push({ id: 'data', name: 'Aus den Messdaten: Durchgänge und Nachbarkopplung', mapping: placed.mapping, placement: placed });
      notes.push('Nur aus Messdaten: Welche Leiterenden auf derselben Seite liegen, folgt aus der Annahme, dass Nahübersprechen stärker ist als Fernübersprechen.');
    }
    const optimum = placed ? placed.score : null;
    for (const c of candidates) {
      c.score = scoreMapping(p, c.mapping, ev);
      if (optimum) { c.objective = objective(p, c.mapping, ev); c.objectiveGap = (optimum - c.objective) / optimum; }
      const v = validateMapping(p, c.mapping);
      c.valid = v.ok;
      // symmetric alternatives that the measurement cannot tell apart
      c.alternatives = [...(p.symmetries || []).map(sym => ({ id: sym.id, name: sym.name, mapping: applySymmetry(c.mapping, sym) })), { id: 'sides', name: 'Seite 1 und 2 vertauscht', mapping: swapSides(c.mapping) }]
        .map(alt => { const s = scoreMapping(p, alt.mapping, ev); return { id: alt.id, name: alt.name, score: s, equivalent: Math.abs(s.thru - c.score.thru) < 1e-9 && Math.abs((s.adjacency ?? 0) - (c.score.adjacency ?? 0)) < 0.02 && Math.abs((s.sides ?? 1) - (c.score.sides ?? 1)) < 0.02 }; });
    }
    const rank = c => c.valid ? c.score.total : -1;
    candidates.sort((a, b) => rank(b) - rank(a));
    const bestAdj = Math.max(...candidates.filter(c => c.valid).map(c => c.score.adjacency ?? -1)), bestSides = Math.max(...candidates.filter(c => c.valid).map(c => c.score.sides ?? 0));
    for (const c of candidates) {
      const structural = c.score.thru >= 0.9 && (c.score.adjacency ?? 0) > 0.3 && (c.score.sides ?? 1) > 0.9;
      if (c.score.unconfirmed?.length && c.score.thru >= 0.9) c.conflict = (c.conflict ? c.conflict + ' ' : '') + 'Nicht durch einen eindeutigen Durchgang bestätigt: ' + c.score.unconfirmed.join(', ') + '.';
      const ambiguous = c.alternatives.some(a => a.equivalent);
      // Names on every port that no clear thru path contradicts: contacts without a measurable path (open, not populated)
      // keep the name assignment but stay marked as unconfirmed.
      const namesOnly = c.id === 'names' && named === n && c.valid && c.score.contradict === 0 && c.score.thru >= 0.25;
      if (namesOnly && c.score.thru < 0.9) {
        c.category = 'likely';
        c.conflict = 'Ohne messbaren Durchgang (offen oder nicht verbunden), Zuordnung nur aus den Portnamen: ' + c.score.unconfirmed.join(', ') + '.';
      } else if (!c.valid || c.score.thru < 0.9) c.category = 'unresolved';
      else if (c.score.names !== null && c.score.names > 0.999 && named === n && structural && c.score.thru > 0.999 && (c.score.adjacency ?? 0) >= bestAdj - 0.02 && (c.score.sides ?? 1) >= bestSides - 0.02 && !(c.objectiveGap > 0.003)) c.category = 'certain';
      else if (c.id === 'names' && structural) { c.category = 'likely'; c.conflict = 'Die Portnamen widersprechen teilweise der gemessenen Nachbarkopplung; eine andere Belegung passt besser zu den Daten.'; }
      else if (c.id !== 'data' && structural) c.category = 'likely';
      else if (structural) c.category = ambiguous ? 'several' : 'likely';
      else c.category = 'unresolved';
      c.ambiguous = ambiguous;
    }
    // A data-only placement that disagrees with the best convention lowers that convention to "several".
    const best = candidates[0];
    if (best && best.id !== 'data' && best.category === 'likely') {
      const data = candidates.find(c => c.id === 'data');
      if (data && data.score.total > best.score.total + 0.02) best.category = 'several';
    }
    return { profile: p.id, candidates, status: best ? best.category : 'unresolved', notes, thru: ev.thru };
  }

  // ---------- Multiport: crosstalk, delay and skew per channel ----------
  // From the mixed-mode matrices of an applied mapping. Victim channel v with ends a (1) and b (2); aggressors are all other channels.
  // PSNEXT at an end: Σ |S(D_v, D_k)|² over aggressors at the same end; PSFEXT: Σ |S(D_v@b, D_k@a)|² (excited at end 1, seen at end 2).
  // Delay: group delay of SDD21 (TD.groupDelay, guided unwrapping is reported). Intra-pair skew: τ(S b+←a+) − τ(S b−←a−) from the
  // single-ended matrix. Medians over the band where the transmission is above −6 dB (delay) or |S| > 0.3 (skew). No limits.
  function crosstalk({ freq, mm, se, modes, active, channels, paths }) {
    const nm = modes.length, ns = active.length, F = freq.length;
    const modeIdx = id => modes.findIndex(m => m.key === 'D' + id), cIdx = id => modes.findIndex(m => m.key === 'C' + id);
    const cplx = (mats, n, i, j) => mats.map(s => s && i >= 0 && j >= 0 ? [s[2 * (i * n + j)], s[2 * (i * n + j) + 1]] : null);
    const p2 = v => v ? v[0] * v[0] + v[1] * v[1] : NaN;
    const db = x => 10 * Math.log10(Math.max(x, 1e-30));
    const median = a => { const b = a.filter(Number.isFinite).sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
    const list = paths ?? directedPaths(channels).filter(p => !p.reverse);
    const out = [];
    for (const v of list) {
      const va = modeIdx(v.a.id), vb = modeIdx(v.b.id);
      if (va < 0 || vb < 0) continue;
      const r = { id: v.id, channel: v.channel, reverse: v.reverse, a: v.a, b: v.b, worstNext: null, worstFext: null };
      const sum = (ids, receiver, kind, end) => {
        const indices = ids.map(modeIdx).filter(i => i >= 0);
        if (!indices.length) return null;
        const power = new Float64Array(F);
        for (const i of indices) {
          const series = cplx(mm, nm, receiver, i).map(p2);
          let peak = -Infinity, at = -1;
          series.forEach((x, f) => { power[f] += x; if (x > peak) { peak = x; at = f; } });
          if (at >= 0 && (!r[kind] || peak > r[kind].p2)) {
            const c = channels.find(ch => modeIdx(ch.id) === i);
            r[kind] = { p2: peak, db: db(peak), freq: freq[at], aggressor: c?.channel, end };
          }
        }
        return Array.from(power, db);
      };
      r.psnext1 = sum(v.aggressors.near, va, 'worstNext', 1);
      r.psnext2 = sum(v.aggressors.far, vb, 'worstNext', 2);
      r.psfext = sum(v.aggressors.near, vb, 'worstFext', 1);
      if (vb >= 0) {
        const sdd = cplx(mm, nm, vb, va), il = sdd.map(x => db(p2(x)));
        const gd = TD ? TD.groupDelay(freq, sdd) : null;
        r.il = il; r.rl1 = cplx(mm, nm, va, va).map(x => db(p2(x))); r.rl2 = cplx(mm, nm, vb, vb).map(x => db(p2(x)));
        r.scd = cplx(mm, nm, cIdx(v.b.id), va).map(x => db(p2(x)));
        if (gd) { r.delay = median(Array.from(gd.tau).filter((t, f) => il[f] > -6)); r.delaySeries = gd.tau; r.guided = gd.guided; }
        const port = p => active.indexOf(p);
        if (se && TD) {
          const pp = cplx(se, ns, port(v.b.plus), port(v.a.plus)), mmn = cplx(se, ns, port(v.b.minus), port(v.a.minus));
          const tp = TD.groupDelay(freq, pp), tn = TD.groupDelay(freq, mmn);
          const ok = f => Math.sqrt(p2(pp[f])) > 0.3 && Math.sqrt(p2(mmn[f])) > 0.3;
          r.skew = median(Array.from(tp.tau, (t, f) => ok(f) ? t - tn.tau[f] : NaN));
          r.guided = (r.guided || 0) + tp.guided + tn.guided;
        }
      }
      out.push(r);
    }
    for (const reverse of [false, true]) {
      const rows = out.filter(r => !!r.reverse === reverse), delays = rows.map(r => r.delay).filter(Number.isFinite);
      const mean = delays.length ? delays.reduce((x, y) => x + y, 0) / delays.length : NaN;
      for (const r of rows) r.laneSkew = r.delay - mean;
    }
    return out;
  }

  // ---------- Templates (port maps) ----------
  function exportMap(p, mapping, meta = {}) {
    const v = validateMapping(p, mapping);
    if (!v.ok) throw new Error(v.issues.find(i => i.level === 'error').text);
    return { schema: MAP_SCHEMA, version: VERSION, profile: { id: p.id, revision: p.revision },
      ...(PROFILES.some(b => b.id === p.id) ? {} : { profileDefinition: p }),
      ports: mapping.ports.length, map: mapping.ports.slice(), ...(mapping.links ? { paths: validateLinks(p,mapping.links) } : {}),
      ...(meta.selectedPath ? { selectedPath: meta.selectedPath } : {}),
      created: meta.created || null, name: meta.name || '', note: meta.note || '' };
  }
  function importMap(json, n = null) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    if (data?.schema !== MAP_SCHEMA || data.version !== VERSION) throw new Error('Keine unterstützte Port-Zuordnung im SIMONLATION-Format.');
    const p = migrateFileProfile(data.profileDefinition ?? profile(data.profile?.id));
    if (!p) throw new Error('Unbekanntes Connector-Profil: ' + data.profile?.id + '. Lade die ursprüngliche Port-Map mit Profildefinition.');
    if (p.id !== data.profile?.id || p.revision !== data.profile?.revision) throw new Error('Profil-ID oder Revision stimmt nicht überein.');
    if (data.profileDefinition) checkRegistration(p);
    if (!Number.isInteger(data.ports) || data.ports !== portCount(p) || (n !== null && data.ports !== n) ||
        !Array.isArray(data.map) || data.map.length !== data.ports) throw new Error('Zuordnung, Profil und Messdatei müssen dieselbe Portzahl haben.');
    const m = emptyMapping(p, data.ports);
    m.ports = data.map.slice();
    m.source = m.ports.map(node => node === null ? '' : 'template');
    const v = validateMapping(p,m);
    if (!v.ok) throw new Error(v.issues.find(i => i.level === 'error').text);
    if (data.paths !== undefined) m.links = validateLinks(p, data.paths);
    return { profile: p, mapping: m, selectedPath: typeof data.selectedPath === 'string' ? data.selectedPath : '', name: String(data.name || '').slice(0, 80) };
  }

  const CATEGORY = { certain: 'Eindeutig zugeordnet', likely: 'Wahrscheinlich zugeordnet', several: 'Mehrere mögliche Zuordnungen', unresolved: 'Nicht zuverlässig bestimmbar', mismatch: 'Profil passt nicht zur Portzahl' };
  return { SCHEMA, MAP_SCHEMA, VERSION, PROFILES, CATEGORY, profile, text, validateProfile, nodesOf, portCount, splitNode, nodeId, emptyMapping, validateMapping, mappedPairs, toConfig,
    thruPaths, magneticsStructure, fromNames, detect, scoreMapping, applySymmetry, swapSides, exportMap, importMap,
    register, customProfiles, fromSidecar, checkChannels, crosstalk, directedPaths, pairKey };
})();
