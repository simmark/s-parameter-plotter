# Tab „Quelltext“ (Version 12)

Der Tab zeigt eine Touchstone-Datei als Text und lässt sie bearbeiten. Bearbeitet wird immer eine **Kopie**: Die Originaldatei in Sitzung und Bibliothek bleibt unverändert. „Als Analyse öffnen“ importiert den Entwurf als neue Datei „Name · Edit n“.

## Ansichten

| Ansicht | Inhalt |
|---|---|
| Messwerttabelle | Werte je Frequenzpunkt, blätterbar; eine Zahl auswählen, ersetzen oder im Rohtext zeigen; Ausdrücke wie `SDD21 @ 100 MHz` mit den beteiligten Rohwerten |
| Matrix | ganze Matrix eines Frequenzpunkts in Re/Im, dB/° oder Betrag/°, Single Ended oder Mixed Mode |
| Rohtext | Editor mit Zeilennummern, Suchen/Ersetzen, Rückgängig; Sprung zu Zeile, Frequenz oder Element (`S21 @ 100 MHz`); Einfärbung nach den Token des Parsers |
| Portzuordnung | Port-Profil (Lasten, Paare) entwerfen und als Kommentarblock `[SPA-Port-Profile]` in den Text schreiben |

Jede Änderung wird nach 250 ms mit demselben Parser geprüft, mit dem auch importiert wird (`RF.inspectSource`, in einem eigenen Worker). Fehler nennen Zeile und Spalte, „Zur Fehlerstelle“ springt hin. Solange der Entwurf fehlerhaft ist, lässt er sich nicht übernehmen. Der Entwurf wird lokal gesichert (nach 450 ms, beim Verlassen der Seite) und beim nächsten Öffnen derselben Datei wiederhergestellt. Zeichensatz und Zeilenenden (LF, CRLF, CR) der Datei bleiben erhalten.

„Umrechnung ansehen“ wechselt das Zahlenformat (RI, MA, DB) nur bei den Messwerten. Kommentare, Frequenzen und Zeilenaufbau bleiben. Erst „Umrechnung übernehmen“ ändert den Entwurf.

Der Knopf „Quelltext“ neben der Markersuche springt in den Frequenzblock des aktiven Markers. Ein Link auf `…/#quelltext` öffnet den Tab nach dem Start.

## Aufbau

`src/app/module/quelltext/` ist ein Fachmodul. Es meldet sich nur über `basis/erweiterung.js` an: Ansicht mit eigenem Symbol und Platz hinter „S-Parameter“ (`registerView` mit `after` und `iconPath`), Knopf an den Markern (`registerSlot('marker-tools', …)`), Aktion `source-at-marker`. Stile: `src/css/module/quelltext.css`.

| Modul | Aufgabe |
|---|---|
| `editor.js` | Tab, Ablauf, Entwurf, Übernahme |
| `codeeditor.js` | Rohtext-Editor auf CodeMirror 6 |
| `dokument.js` | Bytes, Zeichensatz, Zeilenenden, Token-Fundstellen, Beispieldateien |
| `messwerte.js`, `datenansicht.js`, `matrixansicht.js` | Werte lesen, Tabelle, Matrix |
| `profil.js`, `umrechnen.js`, `pruefung.js` | Portzuordnung, Formatwechsel, Prüfung im Worker |

## Drittkomponente CodeMirror 6

Der Editor nutzt CodeMirror 6 (MIT). Siehe `docs/drittkomponenten.md`.

## Prüfungen

`node tests/e2e/quelltext.mjs` prüft (23 Prüfungen):
- Tab und Seitentitel, Prüfstatus, CRLF erkannt, Matrix- und Rohtextansicht
- Sprung `S21 @ 100 kHz`; Enter im Sprungfeld verändert den Text nicht
- Fehlerstelle mit Zeile und Spalte, Sperre der Übernahme, Rückgängig
- Wert ersetzen: Die Kopie ist bis auf diese Zahl bytegleich, CRLF bleibt
- Entwurf nach dem Neuladen wieder da
- RI → DB: dieselben Werte (≤ 10⁻⁶, gegen den RF-Kern in Node), gleiche Zeilenzahl
- Übernahme als „· Edit 1“, Original bleibt
- Sprung vom Marker, Link `#quelltext`
- Englische Oberfläche ohne deutsche Reste

## Herkunft und Grenzen

- Das Modul stammt aus einer separat gebauten Fassung (`SIMONLATION-Quelltexteditor-Frequenzmatrix.html`). Sie wurde in ihre Quellen zurückzerlegt und in den Aufbau eingeordnet. Dabei:
  - wurde der minifizierte Editor-Wrapper lesbar neu geschrieben (`codeeditor.js`),
  - wird CodeMirror aus festgelegten npm-Versionen neu gebaut,
  - kommen Tab und Markerknopf über Erweiterungspunkte statt über HTML und Analysecode,
  - ist ein Fehler behoben: Enter im Feld „Gehe zu“ fügte einen Zeilenumbruch in die Datei ein.
- Geprüft ist das Modul nur mit synthetischen Dateien. Sehr große Dateien (nahe 100 MiB) und Touchstone 2.0 mit Mixed-Mode-Reihenfolge sind nicht eigens getestet.
