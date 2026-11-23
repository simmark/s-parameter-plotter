// Addresses are from the parser, so tab width and continuation lines never determine matrix order.
function tokenRange(index, lines, start, count) {
  const rows = index.rows, end = start + count, out = [];
  let left = 0, right = rows.length;
  while (left < right) {
    const mid = (left + right) >>> 1;
    if (rows[mid][1] + rows[mid][2] <= start) left = mid + 1;
    else right = mid;
  }
  for (let i = left; i < rows.length && rows[i][1] < end; i++) {
    const [line, ordinal] = rows[i], text = lines[line - 1];
    let offset = ordinal;
    for (const match of text.split('!')[0].matchAll(/\S+/g)) {
      if (offset >= end) break;
      if (offset >= start) out.push({ line, col: match.index, word: match[0], ordinal: offset });
      offset++;
    }
  }
  return out;
}

const tokenNumber = token => /^-inf(?:inity)?$/i.test(token) ? -Infinity : Number(token.replace(/[dD]/, 'e'));

function compactValue(value) {
  if (value === -Infinity) return '−∞';
  if (!Number.isFinite(value)) return '—';
  if (!value) return '0';
  const mag = Math.abs(value);
  if (mag < 0.001 || mag >= 1e5) {
    const [mantissa, exponent] = value.toExponential(3).split('e');
    return Number(mantissa) + 'e' + exponent;
  }
  return String(Number(value.toFixed(3)));
}

function complexPair(a, b, format) {
  const first = tokenNumber(a.word), second = tokenNumber(b.word);
  if (format === 'RI') return [first, second];
  const mag = format === 'DB' ? 10 ** (first / 20) : first;
  return [mag * Math.cos(second * RF.RAD), mag * Math.sin(second * RF.RAD)];
}

const matrixKey = (r, c) => r + ':' + c;
function pointData(index, lines, point) {
  const width = 1 + index.positions.length * 2;
  const [frequency, ...values] = tokenRange(index, lines, width * point, width);
  const cells = index.positions.map(([r, c], i) => {
    const tokens = values.slice(2*i, 2*i+2);
    return { r, c, tokens, value: complexPair(...tokens, index.format) };
  });
  const lookup = new Map(cells.map(cell => [matrixKey(cell.r, cell.c), cell]));
  return { frequency, cells, lookup };
}
function matrixCell(data, row, col) {
  return data.lookup.get(matrixKey(row, col)) ||
    (row !== col ? data.lookup.get(matrixKey(col, row)) : null);
}
function matrixLabel(index, row, col) {
  const port = i => index.labels?.[i] || 'P' + (i+1);
  return index.labels || row >= 9 || col >= 9 ?
    index.kind + '(' + port(row) + ',' + port(col) + ')' : index.kind + (row+1) + (col+1);
}

function sourceNetwork(index, data, point, profile) {
  const raw = RF.matrix(index.n);
  for (const cell of data.cells) {
    RF.put(raw, index.n, cell.r, cell.c, cell.value);
    if (data.cells.length !== index.n ** 2 && cell.r !== cell.c) RF.put(raw, index.n, cell.c, cell.r, cell.value);
  }
  const single = RF.sourceToSingleEnded(raw, index.n, index.kind, index.version, index.optionRef, index.refs, index.inverse);
  if (!single) throw new Error('Die Umrechnung nach S ist bei dieser Frequenz singulär.');
  const dataset = {n:index.n, refs:index.physicalRefs, freq:[index.freq[point]], samples:[single]};
  const layout = RF.prepareNetwork(dataset, profile);
  return { layout, samples:RF.processPoint(dataset, profile, layout, 0) };
}

function mixedTerms(index, data, mode, output, input) {
  const sources = [input.p, input.q], targets = [output.p, output.q];
  return targets.flatMap((row, i) => sources.map((col, j) => ({
    row, col, cell: matrixCell(data, row, col), color: i*2+j,
    weight: (i && mode[0] === 'D' ? -0.5 : 0.5) * (j && mode[1] === 'D' ? -1 : 1)
  })));
}
function nativeMode(index, type, pair) {
  const direct = index.labels.indexOf(type + (pair.p+1) + ',' + (pair.q+1));
  if (direct >= 0) return { port:direct, sign:1 };
  const reversed = index.labels.indexOf(type + (pair.q+1) + ',' + (pair.p+1));
  return {port:reversed, sign:type === 'D' ? -1 : 1};
}

export { tokenNumber, compactValue, sourceNetwork, tokenRange, pointData, matrixCell, matrixLabel, mixedTerms,
  nativeMode };
