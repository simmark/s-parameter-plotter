// File bytes and CodeMirror's LF-normalized editing buffer are kept separately.
const sampleText = [
  '! SIMONLATION | Nichtreziprokes Zweitor',
  '! Vorwaerts S21, rueckwaerts S12. Alle Winkel in Grad.',
  '[Version] 2.0',
  '# MHz S DB R 50',
  '[Number of Ports] 2',
  '[Two-Port Data Order] 21_12',
  '[Number of Frequencies] 3',
  '[Network Data]',
  '! MHz   S11       S21       S12       S22',
  '10      -20 0     -3 0      -30 0     -20 0',
  '100     -20 0     -6 -45    -34 20    -20 0  ! S21 bei 100 MHz',
  '1000    -20 0     -9 -90    -40 40    -20 0',
  '[End]', ''
].join('\n');

// Deliberately irregular Touchstone 1.x lines. The selected D2←D1 terms are .6, .1, .2, .7 at 100 MHz.
const lanSample = () => ['! SIMONLATION | Synthetischer 6-Port fuer den Portprofil-Test', '# MHz S RI R 50',
  ...[10,100,1000].flatMap((f,k)=>Array.from({length:6},(_,r)=>{
    const values = Array.from({length:6},(_,c)=> {
      const transfer=({ '5:0':.6, '5:2':.1, '3:0':.2, '3:2':.7 })[r+':'+c] || 0;
      return String(Number((transfer*[.8,1,.5][k]).toPrecision(6))) + '\t0';
    });
    return (r===0?f+'   ':'\t')+values.join(r%2?'     ':'\t')+(r===5&&k===1?'  ! Fortsetzung bei 100 MHz':'');
  })), ''].join('\n');

function readSource(bytes) {
  let raw, encoding = 'UTF-8';
  try { raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { encoding = 'Windows-1252'; raw = new TextDecoder('windows-1252').decode(bytes); }
  const u = new Uint8Array(bytes);
  const bom = u[0] === 239 && u[1] === 187 && u[2] === 191;
  return { raw, bytes, encoding, bom };
}

function sourceLines(raw) {
  const endings = raw.match(/\r\n|\r|\n/g) || [];
  return { text: raw.replace(/\r\n|\r/g, '\n'), endings, newline: endings[0] || '\n' };
}

function editEndings(doc, changes) {
  // Unchanged separators keep their exact bytes, including mixed CRLF/LF files.
  let ends = doc.endings;
  for (const [from, to, added] of changes.slice().reverse()) {
    if (from === to && !added) continue;
    ends = ends.slice(0, from).concat(Array(added).fill(doc.newline), ends.slice(to));
  }
  doc.endings = ends;
}

function sourceRaw(doc) {
  let n = 0;
  return doc.text.replace(/\n/g, () => doc.endings[n++] || doc.newline);
}

function sourceBlob(doc) {
  const raw = sourceRaw(doc);
  if (raw === doc.raw) return new Blob([doc.bytes]);
  if (doc.encoding === 'UTF-8') return new Blob([doc.bom ? '\uFEFF' : '', raw]);
  const decoder = new TextDecoder('windows-1252'), map = new Map();
  for (let i = 0; i < 256; i++) map.set(decoder.decode(Uint8Array.of(i)), i);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    if (!map.has(raw[i])) throw new Error('„' + raw[i] + '“ liegt außerhalb von Windows-1252. Wähle „UTF-8-Kopie“.');
    bytes[i] = map.get(raw[i]);
  }
  return new Blob([bytes]);
}

function sourceRow(index, n) {
  const rows = index?.rows;
  if (!rows?.length) return null;
  let low = 0, high = rows.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (rows[mid][0] < n) low = mid + 1; else high = mid;
  }
  return rows[low]?.[0] === n ? rows[low] : null;
}

function sourceTokens(index, n, line) {
  const row = sourceRow(index, n);
  const tokens = [], expr = /!.*|\[[^\]]*\]|[^\s!]+/g;
  const option = line.trimStart().startsWith('#');
  for (const m of line.matchAll(expr)) {
    const word = m[0], ordinal = row && row[1] + tokens.length;
    let kind = 'plain';
    if (word.startsWith('!')) kind = 'comment';
    else if (word.startsWith('[')) kind = 'keyword';
    else if (option) kind = /^(?:[kmg]?hz)$/i.test(word) ? 'unit' : 'setting';
    else if (row) kind = ordinal % (1 + index.positions.length * 2) === 0 ? 'frequency' : 'number';
    else if (/^[-+.\d]/.test(word)) kind = 'number';
    tokens.push({from:m.index, to:m.index+word.length, kind, ordinal});
  }
  return tokens;
}

function sourceLocation(index, ordinal) {
  if (ordinal == null || !index?.positions) return null;
  const width = 1 + 2 * index.positions.length, slot = ordinal % width;
  const point = Math.floor(ordinal / width);
  if (!slot) return { point };
  const [r,c] = index.positions[Math.floor((slot-1)/2)];
  const half = (slot-1)%2, format = index.format;
  const part = format === 'RI' ? ['Realteil','Imaginärteil'][half] : half ? 'Winkel (°)' : format === 'DB' ? 'Betrag (dB)' : 'Betrag';
  const label = p => index.labels?.[p] || 'P' + (p+1);
  const name = index.labels || r >= 9 || c >= 9 ? index.kind + '(' + label(r) + ',' + label(c) + ')' : index.kind + (r+1) + (c+1);
  return { point, r, c, part, name, response:label(r), drive:label(c) };
}

function sourceChanges(doc) {
  const a = doc.raw.replace(/\r\n|\r/g,'\n').split('\n'), b = doc.text.split('\n');
  let first=0, left=a.length, right=b.length;
  while(first < left && first < right && a[first]===b[first]) first++;
  while(left>first && right>first && a[left-1]===b[right-1]) {left--;right--;}
  const span = (lines,end) => lines.slice(first,Math.min(first+8,end)).map(s=>s.slice(0,300)).join('\n')+(end-first>8?'\n…':'');
  const t = window.I18N.t;
  return first===left && first===right ? t('Keine Textänderung.') :
    t('Ab Zeile')+' '+(first+1)+' · '+t('Original')+' ('+(left-first)+' '+t('Zeilen')+')\n'+span(a,left)+
    '\n\n'+t('Arbeitskopie')+' ('+(right-first)+' '+t('Zeilen')+')\n'+span(b,right);
}

export { sampleText, lanSample, readSource, sourceLines, editEndings, sourceRaw, sourceBlob, sourceTokens,
  sourceLocation, sourceChanges };
