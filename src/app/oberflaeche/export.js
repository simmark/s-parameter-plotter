// oberflaeche/export – Export: CSV, Touchstone, Bilder, Teilen und Herunterladen.
import { $, checked, coarse, disabled, esc, icon, openDialog, toast } from '../basis/dom.js';
import { registerActions, view } from '../basis/erweiterung.js';
import { complexAt } from '../basis/format.js';
import { state } from '../basis/zustand.js';

function exportDialog() {
  const canExport = !!state.network && state.network.gaps < state.dataset.freq.length;
  const hasPlot = !!state.view?.traces.some(t => t.visible);
  const items = [
    ['csv', 'Kurven als CSV', 'Alle Frequenzen der sichtbaren Kurven · Komma-getrennt, Dezimalpunkt', !hasPlot],
    ['csv-de', 'Kurven als CSV für Excel (DE)', 'Semikolon-getrennt, Dezimalkomma · öffnet direkt in deutschem Excel', !hasPlot],
    ['png', 'Diagramm als PNG', 'Aktuelle Ansicht mit Achsen und Markern', !hasPlot],
    ['touchstone', 'Netzwerk als Touchstone', 'Reduzierte S-Matrix · ' + (state.basis === 'mm' ? 'Mixed Mode' : 'Single Ended') + ' · .ts', !canExport]
  ];
  $('export-content').innerHTML = items.map(([kind, title, subtitle, off]) =>
    '<button class="export-item" type="button" data-action="download" data-value="' + kind + '"' + disabled(off) + '>' +
    icon('export') + '<span><strong>' + esc(title) + '</strong><small>' + esc(subtitle) + '</small></span></button>').join('') +
    (canShareFiles() ? '<label class="checkbox-line share-line"><input type="checkbox" id="export-share"' + checked(shareExports()) +
      '> Über das Teilen-Menü senden (Mail, Drive, Messenger …)</label>' : '');
  openDialog('export-dialog');
}

function canShareFiles() {
  try {
    return !!navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.txt', { type: 'text/plain' })] });
  } catch { return false; }
}

function shareExports() {
  try {
    const saved = localStorage.getItem('spa-share-exports');
    return saved === null ? coarse.matches : saved === '1';
  } catch { return coarse.matches; }
}

function csvText(german = false) {
  const view = state.view, fs = state.dataset.freq;
  const separator = german ? ';' : ',';
  const decimal = german ? value => value.replace('.', ',') : value => value;
  const traces = view.traces.filter(trace => trace.visible);
  const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
  const scalar = value => {
    if (value === -Infinity) return '-Inf';
    if (value === Infinity) return 'Inf';
    return Number.isFinite(value) ? decimal(String(value)) : '';
  };
  const heads = ['Frequenz_Hz'];
  traces.forEach(t => {
    heads.push(t.label + (view.unit ? '_' + view.unit : '_Wert'));
    if (t.complex) {
      const native = view.native ? '_' + view.native : '';
      heads.push(t.label + '_Re' + native, t.label + '_Im' + native);
    }
    if (view.smith) heads.push(t.label + '_Zin_Re_Ω', t.label + '_Zin_Im_Ω');
  });
  const rows = [heads.map(h => quote(window.I18N.t(h))).join(separator)];
  for (let i = 0; i < fs.length; i++) {
    const line = [scalar(fs[i])];
    for (const t of traces) {
      line.push(scalar(t.values[i]));
      const raw = complexAt(t.complex, i);
      if (raw) line.push(scalar(raw[0]), scalar(raw[1]));
      if (view.smith) {
        const z = raw?.every(Number.isFinite) && RF.reflection(raw, view.smithRef);
        line.push(scalar(z?.[0]), scalar(z?.[1]));
      }
    }
    rows.push(line.join(separator));
  }
  return (german ? '\uFEFF' : '') + rows.join('\r\n') + '\r\n';
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function download(value) {
  const base = state.dataset.name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, 85) || 'Netzwerk';
  const suffix = state.tab === 's' ? 'S-Parameter' : view(state.tab).title.replaceAll(' ', '-');
  try {
    let blob, name;
    if (value === 'csv' || value === 'csv-de') {
      blob = new Blob([csvText(value === 'csv-de')], { type: 'text/csv;charset=utf-8' });
      name = base + '-' + suffix + (value === 'csv-de' ? '-Excel' : '') + '.csv';
    } else if (value === 'png') {
      blob = await Plot.image(state.view.title, state.dataset.name + ' · ' + state.view.caption);
      name = base + '-' + suffix + '.png';
    } else {
      blob = new Blob([RF.exportTouchstone(state.dataset, state.network, state.basis)], { type: 'text/plain;charset=utf-8' });
      name = base + '-' + (state.basis === 'mm' ? 'Mixed-Mode' : 'Single-Ended') + '.ts';
    }
    if (!blob) throw new Error('Das Diagramm ist für den Bildexport nicht verfügbar.');
    const shareBox = $('export-share');
    if (shareBox) {
      try { localStorage.setItem('spa-share-exports', shareBox.checked ? '1' : '0'); } catch {}
    }
    if (shareBox?.checked) {
      const file = new File([blob], name, { type: blob.type.split(';')[0] || 'application/octet-stream' });
      try {
        await navigator.share({ files: [file], title: name });
        $('export-dialog').close();
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
        // Some share targets reject a file type; the download keeps working.
      }
    }
    saveBlob(blob, name);
    $('export-dialog').close();
    toast(name + ' gespeichert.');
  } catch (error) {
    $('export-dialog').close();
    toast(error.message);
  }
}

registerActions({
  download,
});

export { exportDialog, saveBlob };
