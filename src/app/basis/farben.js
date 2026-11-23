// basis/farben – Farben und Strichmuster für Moden, Paare und Kurven.

// Mixed-mode colour families: differential blue, common mode green, conversion C→D (Sdc, immunity) amber,
// conversion D→C (Scd, emission) crimson, single-ended ports violet. Reflections dashed, transmissions solid.
const MODE_PALETTE = {
  dd: ['#1f5fd1', '#5b8ee6', '#163f8c', '#3d78dc', '#2a4fa8', '#86aaf0'],
  cc: ['#08875a', '#3fb07f', '#055e3e', '#21a06c', '#2c7a52', '#78c9a2'],
  dc: ['#e07b0f', '#b45f06', '#f2a23f', '#8a4705'],
  cd: ['#c62f4b', '#962036', '#e0687f', '#701628'],
  p: ['#7a4fc2', '#a07bdc', '#55348f', '#8d63cf', '#6a45a9', '#c1a5ea'],
  m0: ['#7a5a12', '#a9821f', '#5a420c'],
  mab: ['#1f6fb2', '#3d8fd1', '#14507f', '#5aa7e0'],
  mx: ['#b23a8e', '#d16ab0', '#7f2766']
};
const MODE_COLOR = { D: 'var(--mode-d)', C: 'var(--mode-c)', P: 'var(--mode-p)', Z: '#7a5a12', A: '#1f6fb2', B: '#1f6fb2' };
const MODAL_TYPES = new Set(['Z', 'A', 'B']), MODAL_SYMBOL = { Z: '0', A: 'α', B: 'β', D: 'd', C: 'c' };
const REFLECTION_DASH = [6, 4];

function traceFamily(row, col) {
  if (MODAL_TYPES.has(row.type) || MODAL_TYPES.has(col.type)) {
    if (row.type === col.type) return row.type === 'Z' ? 'm0' : 'mab';
    return 'mx';
  }
  if (row.type === 'P' && col.type === 'P') return 'se';
  if (row.type === 'P' || col.type === 'P') return 'p';
  if (row.type !== col.type) return row.type === 'D' ? 'dc' : 'cd';
  return row.type === 'D' ? 'dd' : 'cc';
}

function modeMarkup(text) {
  return text.replace(/\b(D\d+)/g, '<b class="d">$1</b>').replace(/\b(C\d+)/g, '<b class="c">$1</b>');
}

// One colour per differential pair, used wherever ports appear (editor, table, schematic).
const PAIR_COLORS = ['#3a9fbf', '#d98a0b', '#7b8a92', '#a8a21e', '#a06cc7', '#d0607a', '#4c9f70', '#5b6fd6', '#b5713a', '#2f8f9f', '#8f6bb0', '#c25555'];
const pairColor = id => PAIR_COLORS[(Math.max(1, id) - 1) % PAIR_COLORS.length];

const COLORS = ['#3266ce', '#008879', '#a26016', '#8a55b6', '#ca5260', '#4f842f', '#157eab', '#a04d7b', '#967234', '#5059a8', '#47616d', '#bb6235', '#007385', '#6b4d33', '#a32c63', '#6b7428'];

export { MODE_PALETTE, MODE_COLOR, MODAL_TYPES, MODAL_SYMBOL, REFLECTION_DASH, traceFamily, modeMarkup, PAIR_COLORS,
  pairColor, COLORS };
