# Drittkomponenten

Die App enthält eine Komponente Dritter: **CodeMirror 6** (MIT-Lizenz), für den Rohtext-Editor im Tab „Quelltext“.

- Sie steht als eigener Block `<script id="fremd-codemirror">` in `index.html` (Quelle: `src/js/fremd/codemirror.js`). Der Block stellt die globale Variable `CodeMirror6` bereit und lädt nichts nach. Er enthält keinen Netzzugriff (`fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`), geprüft per Textsuche im Bündel.
- Erzeugt wird er mit `node tools/fremd/codemirror.mjs` aus den in `package.json` fest eingetragenen Versionen. Der Kopf des Blocks nennt jedes enthaltene Paket mit Version und vollem Lizenztext, gelesen aus `node_modules`. Das Skript bricht ab, wenn ein Paket nicht unter MIT steht oder keinen Lizenztext hat. Nicht von Hand ändern.
- Enthaltene Pakete (Stand des Builds): `@codemirror/commands` 6.11.1, `@codemirror/language` 6.13.1, `@codemirror/search` 6.7.2, `@codemirror/state` 6.7.6, `@codemirror/streamparser` 6.0.0, `@codemirror/view` 6.43.15, `@lezer/common` 1.5.6, `@lezer/highlight` 1.2.5, `@marijn/find-cluster-break` 1.0.4, `crelt` 1.0.7, `style-mod` 4.1.5, `w3c-keyname` 2.2.8. Die ersten Pakete sind direkt eingetragen, die übrigen kommen als Abhängigkeiten mit.
- In der App zeigt **Lizenz → „Enthaltene Drittkomponenten und ihre Lizenztexte“** diese Texte unverändert an.
- `tests/static.mjs` prüft:
  - Fremdcode steht nur in Blöcken `fremd-…`, und jeder beginnt mit seinen Lizenztexten.
  - Außerhalb dieser Blöcke steht kein fremder Lizenzkopf.
  - Nichts wird von außen nachgeladen.

Die eigene Lizenz (`LICENSE.txt`, Ziffer 5) sieht Drittkomponenten vor: Für sie gelten ihre eigenen Lizenzbedingungen.
