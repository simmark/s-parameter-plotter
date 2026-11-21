  // ---- Packs: fingerprints (templates) and curve preferences as one JSON file, from disk, GitHub or the app itself. ----
  const PACK_LIMIT = 4 * 1024 * 1024;

  function packData() {
    return { app: 'spa-pack', version: 1, created: new Date().toISOString(), templates: Templates.all(), curves: Prefs.all() };
  }

  function applyPack(text, origin) {
    if (text.length > PACK_LIMIT) throw new Error('Das Paket ist größer als 4 MB.');
    let pack;
    try { pack = JSON.parse(text); } catch { throw new Error('Das ist keine gültige JSON-Datei.'); }
    if (!pack || pack.app !== 'spa-pack' || pack.version !== 1) throw new Error('Das ist kein Vorlagenpaket dieser App.');
    const t = Templates.merge(pack.templates), c = Prefs.merge(pack.curves);
    const parts = [t.added + ' Fingerabdrücke neu'];
    if (c) parts.push(c + ' Kurvenwahlen übernommen');
    if (t.skipped) parts.push(t.skipped + ' ungültige übersprungen');
    toast(origin + ': ' + parts.join(' · '));
    renderPacks();
    if (state.dataset) renderConfig();
  }

  const rawUrl = value => {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:') throw new Error('Nur https-Adressen sind erlaubt.');
    const blob = url.hostname === 'github.com' && url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
    return blob ? 'https://raw.githubusercontent.com/' + blob[1] + '/' + blob[2] + '/' + blob[3] : url.href;
  };

  async function packFromUrl(value) {
    let address;
    try { address = rawUrl(value); } catch (error) { throw new Error(error.message.startsWith('Nur') ? error.message : 'Das ist keine gültige Adresse.'); }
    const response = await fetch(address, { cache: 'no-cache' });
    if (!response.ok) throw new Error('Der Download ist fehlgeschlagen (' + response.status + ').');
    applyPack(await response.text(), 'Paket geladen');
  }

  function renderPacks() {
    const box = $('pack-content');
    if (!box) return;
    const prefs = Prefs.all();
    const names = { cmc: 'CMC', lan: 'LAN-Übertrager', pair: 'Ein Paar', se: 'Single-Ended' };
    const curveRows = Object.keys(prefs).map(type => '<li><span><strong>' + esc(names[type] || type) + '</strong> · ' + ((prefs[type].mm || prefs[type].se || []).length) + ' Kurven' +
      ((prefs[type].hidden || []).length ? ' · ' + prefs[type].hidden.length + ' ausgeblendet' : '') + '</span></li>').join('');
    const stored = Templates.groups().map(group => '<li><span><strong>' + esc(group.name) + '</strong> · ' + group.n + ' Ports · ' + group.pairs + ' Paare · ' +
      group.count + (group.count === 1 ? ' Beispiel' : ' Beispiele') + '</span>' + iconButton('Vorlage ' + group.name + ' löschen', 'delete-template', group.key, 'close') + '</li>').join('');
    insertHtml(box,
      '<section class="pack-section"><h3>Auf diesem Gerät</h3><p class="note">' + Templates.size + ' Fingerabdrücke · ' + Prefs.size + ' gemerkte Kurvenwahlen (pro Bauteiltyp). ' +
      'Die Kurvenwahl und ausgeblendete Kurven bleiben beim Blättern durch Dateien und nach einem Neustart erhalten.</p>' +
      '<div class="pack-actions">' + actionButton('Paket exportieren', 'pack-export', '', 'button primary', 'export', disabled(!Templates.size && !Prefs.size)) +
      actionButton('Datei laden …', 'pack-import', '', 'button', 'upload') + actionButton('Stapel analysieren', 'batch-open', '', 'button', 'network', disabled(session.items.length < 2)) +
      actionButton('Kurvenwahl zurücksetzen', 'pack-reset', '', 'button', 'reset', disabled(!Prefs.size)) + '</div></section>' +
      '<section class="pack-section"><h3>Aus dem Netz laden</h3><p class="note">Adresse eines Pakets, z. B. aus deinem GitHub-Repository (github.com/…/blob/… oder raw.githubusercontent.com/…).</p>' +
      '<form id="pack-url-form" class="pack-url"><input class="field-input mono" id="pack-url" type="url" inputmode="url" placeholder="https://raw.githubusercontent.com/…/default.json" aria-label="Adresse des Pakets" autocomplete="off">' +
      '<button class="button" type="submit">Laden</button></form>' +
      '<div class="pack-actions">' + actionButton('Standardpaket laden', 'pack-default', '', 'button', 'install') + '</div></section>' +
      (curveRows ? '<section class="pack-section"><h3>Kurvenwahl pro Bauteiltyp</h3><ul class="pack-list">' + curveRows + '</ul></section>' : '') +
      (stored ? '<section class="pack-section"><h3>Gelernte Fingerabdrücke</h3><ul class="pack-list">' + stored + '</ul></section>' : ''));
  }

  function openPacks() { renderPacks(); openDialog('pack-dialog'); }

