// Synthetic WE-LAN-style 6-port files: header with match code and pin sketch as in the manufacturer's Touchstone files,
// optional data from a SPICE model of a 1:1 transformer with centre taps. No manufacturer data.
// Ports: P1 = pin 1, P2 = pin 2 (tap), P3 = pin 3, P4 = pin 10, P5 = pin 11 (tap), P6 = pin 12; dotted ends at pin 1 and pin 12.
export function lanHeader({ part = '7490999999X', family = 'WE-LAN', pins = [1, 2, 3, 10, 11, 12], mirrored = true } = {}) {
  const right = mirrored ? [6, 5, 4] : [4, 5, 6], rpins = mirrored ? [pins[5], pins[4], pins[3]] : [pins[3], pins[4], pins[5]];
  return ['! Synthetic test file (not manufacturer data)', '! Match Code: ' + family + '   P/N: ' + part + '       Size:  ', '!',
    ...[0, 1, 2].map(k => '!\tPort ' + (k + 1) + ' --->|' + pins[k] + '|-----@||@------|' + rpins[k] + '|---> Port ' + right[k]), '!'].join('\n') + '\n';
}
// Each half winding 175 µH, k = 0.999 between all four halves: L₁₁ = L₂₂ ≈ 700 µH, n = 1, polarity pin 1 ↔ pin 12.
export const LAN_NETLIST = '.subckt LAN 1 2 3 4 5 6\n' +
  'R1 1 a 0.4\nLa a 2 175u\nLb 2 b 175u\nR3 b 3 0.4\n' +
  'R6 6 c 0.4\nLc c 5 175u\nLd 5 d 175u\nR4 d 4 0.4\n' +
  'Kab La Lb 0.999\nKcd Lc Ld 0.999\nKac La Lc 0.999\nKad La Ld 0.999\nKbc Lb Lc 0.999\nKbd Lb Ld 0.999\n' +
  'Rfe 1 3 15k\nCp 1 3 3p\nC16 1 6 2p\nC34 3 4 2p\n.ends\n';
export const zeroData = n => '# Hz S RI R 50\n1000 ' + Array(2 * n * n).fill('0').join(' ') + '\n2000 ' + Array(2 * n * n).fill('0').join(' ') + '\n';
