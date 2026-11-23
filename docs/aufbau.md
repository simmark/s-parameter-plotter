# Aufbau des Quelltexts

Die App wird als **eine** Datei ausgeliefert: `index.html`. Sie läuft offline, braucht keinen Server und lädt nichts nach. Einzige Drittkomponente ist CodeMirror 6 für den Quelltext-Editor (`docs/drittkomponenten.md`). Geschrieben wird sie aber in `src/`, aufgeteilt in Module. `python3 tools/build.py` setzt alles zu `index.html` zusammen. `index.html` bleibt im Repository, weil GitHub Pages sie unverändert ausliefert. **Bearbeitet wird `src/`, nie `index.html`.**

## Ablauf beim Ändern

```
npm install                    # einmalig: Entwicklungspakete für Tests und Werkzeuge (die App selbst braucht keine)
# Dateien in src/ bearbeiten, dann:
node tools/importe.mjs         # import-/export-Zeilen nachziehen, wenn Code zwischen Modulen verschoben wurde
python3 tools/build.py         # index.html aus src/ bauen und die Cache-Version in sw.js stempeln
node tests/module.mjs          # Modulgrenzen und Schichten prüfen
node tests/e2e/run.mjs         # alle Tests (oder --fast ohne Browser)
```

`tests/static.mjs` schlägt an, wenn `index.html` nicht zu `src/` passt, also der Build vergessen wurde.

## Ordner

| Ordner | Inhalt |
|---|---|
| `src/index.src.html` | Gerüst der Seite. `@@include pfad@@` setzt eine Datei unverändert ein, `@@bundle app@@` die gebündelten Module aus `src/app/`. |
| `src/css/` | Stylesheets. Ihre Reihenfolge im Gerüst ist die Kaskade (siehe unten). |
| `src/html/` | Kopfleiste, Arbeitsbereich, Dialoge, Methodik, Lizenz, Installationshinweis |
| `src/js/kerne/` | Rechenkerne ohne Oberfläche: `rf-core` (Netzwerk, Mixed Mode, Touchstone), `spice-core`, `magnetic-core` (Bauteilerkennung), `td-core` (Zeitbereich, Auge), `connector-core` (Steckverbinder), `store-core` (IndexedDB). Sie stehen als eigene `<script>`-Blöcke in der Seite. Tests laden sie direkt, und der Rechen-Worker baut sich aus drei davon. |
| `src/js/` | `theme.js` (Hell/Dunkel), `i18n.js` (Deutsch/Englisch), `plot.js` (Diagramm), `pwa.js` (Installation, Updates) |
| `src/js/fremd/` | Drittkomponenten, erzeugt, nicht von Hand geändert: `codemirror.js` (CodeMirror 6, MIT, gebaut mit `tools/fremd/codemirror.mjs`). Siehe `docs/drittkomponenten.md`. |
| `src/app/` | Die Anwendung als ES-Module, in Schichten (nächster Abschnitt) |

## Schichten in `src/app/`

```
oberflaeche/   Rahmen der Seite: Tabs, Seitenleiste, Ereignisse, Export, Start
module/        Fachmodule: je ein Tab oder Werkzeug, angebunden nur über basis/erweiterung.js
analyse/       Netzwerk rechnen, Kurven, Ansichten S/Smith/Z/CISPR, Marker, Achsen, Vergleich, Erkennung
dateien/       Sitzung, Import, Quellen, Bibliothek, Speicher, Einstellungen pro Datei, Vorlagen
basis/         DOM-Helfer, Formatierung, Farben, Zustand, Rechen-Worker, Sprache, Erweiterungspunkte
```

Regeln, die `tests/module.mjs` prüft:

- `basis/` importiert nur aus `basis/`.
- `analyse/`, `dateien/` und `oberflaeche/` importieren nichts aus `module/`.
- Ein Fachmodul (`module/name.js` oder ein Ordner `module/name/`) importiert nichts aus einem anderen Fachmodul.
- Kein Modul benutzt einen Namen eines anderen Moduls, ohne ihn zu importieren. Jeder Import zeigt auf einen Export, kein Import bleibt ungenutzt, und kein Modul ist länger als 700 Zeilen.

Die Kernschichten untereinander (`analyse`, `dateien`, `oberflaeche`) dürfen sich gegenseitig aufrufen. Typisch ist der Neuaufbau: Eine Änderung irgendwo ruft `renderMain()` im Rahmen auf.

| Modul | Aufgabe |
|---|---|
| `basis/dom.js` | Elementzugriff, Escaping, Symbole, Formularbausteine, Hinweise, Dialoge |
| `basis/erweiterung.js` | Erweiterungspunkte: Ansichten, Aktionen, Formulare, Auswahllisten, Dateizustand |
| `basis/farben.js`, `basis/format.js` | Farben der Moden und Kurven; Zahlen, Frequenzen, komplexe Werte |
| `basis/rechnen.js` | Rechen-Worker mit Rückfall auf die Seite |
| `basis/sprache.js`, `basis/zustand.js` | Sprache und Locale; der gemeinsame Zustand `state` |
| `analyse/netzwerk.js` | Datensatz vorbereiten, Netzwerk neu rechnen |
| `analyse/ansichten.js`, `cispr.js` | Ansichten S-Parameter, Smith, Impedanz, CISPR 17 (je mit Bedienleiste) |
| `analyse/darstellung.js`, `daten.js`, `kurven.js`, `kurvenwahl.js`, `marker.js`, `achsen.js`, `steuerung.js`, `vergleich.js` | Diagrammbereich, Kurvendaten, Kurvenauswahl, Marker, Achsen, Bedienleiste, Dateivergleich |
| `analyse/erkennung.js`, `minidiagramm.js`, `formate.js` | Bauteilerkennung aus der Physik; kleines Liniendiagramm; Darstellungsformate |
| `dateien/sitzung.js`, `sitzungsliste.js`, `import.js`, `quellen.js` | Geöffnete Dateien, Dateiliste, Import mit Fortschritt, Ordner/ZIP/Ziehen |
| `dateien/bibliothek.js`, `speicher.js`, `einstellungen.js` | Bibliothek, Speicherdiagnose und Sicherung, Einstellungen pro Datei |
| `dateien/vorlagen.js`, `kurvenvorlieben.js`, `spice.js` | Gelernte Vorlagen, Kurvenvorlieben, SPICE-Bibliotheken |
| `module/ports/` | Tab „Ports & Lasten“: Paare, Lasten, Port-Profil, Erkennungskarten |
| `module/connector-studio.js` | Tab „Connector“ |
| `module/zeitbereich.js` | Tab „Zeitbereich“ |
| `module/esb/` | Tab „ESB-Modell“: Modelle, Schaltbilder, Modell-Editor, SPICE-Export |
| `module/vorlagen/` | Packs und Stapelverarbeitung |
| `module/quelltext/` | Tab „Quelltext“: Datei als Text, Messwerttabelle, Matrix, Portzuordnung (`docs/quelltext.md`) |
| `oberflaeche/rahmen.js` | Tabs, Seitentitel, Status, Ansichtsmodus, zentraler Neuaufbau (`renderMain`) |
| `oberflaeche/ereignisse.js`, `aktionen.js` | Allgemeine Ereignisse (Klick-, Formular- und Auswahl-Verteiler, Tastatur, Ablegen); Menü, Sprache, Design |
| `oberflaeche/seitenleiste.js`, `export.js`, `start.js` | Seitenleiste und Schublade; Export; Start der App (läuft als letztes Modul) |

## Modulform

Jede Datei in `src/app/` ist ein ES-Modul mit eigenem Gültigkeitsbereich. Was sie nicht exportiert, bleibt privat. Damit der Build ohne fremde Werkzeuge auskommt, gilt eine feste, einfache Form:

```js
// module/beispiel – eine Zeile, wozu das Modul da ist.
import { $, esc } from '../basis/dom.js';
import { registerView } from '../basis/erweiterung.js';

function renderBeispiel() { … }

registerView({ … });

export { renderBeispiel };
```

- Importe stehen oben, jeweils `import { a, b } from './pfad.js';`. Keine Default-Importe und keine `* as`-Importe.
- Exporte stehen in **einer** Liste `export { … };`, meist am Ende. Kein `export function`, kein `export default`.
- `tools/bundle.py` macht daraus je Modul eine Funktion und lädt sie in Abhängigkeitsreihenfolge. Ringabhängigkeiten zwischen **Funktionen** sind erlaubt: Ein Modul, das später geladen wird, ist über eine kleine Weiterleitung erreichbar. Ein **Wert** (Objekt, Zahl, Liste) muss aus einem Modul kommen, das früher lädt. Sonst bricht der Build mit einer Meldung ab, die den Ring nennt.
- `oberflaeche/start.js` lädt immer zuletzt und startet die App.

## Erweiterungspunkte

Ein Fachmodul meldet sich in `basis/erweiterung.js` an, statt in zentrale Tabellen eingetragen zu werden:

| Funktion | Wofür |
|---|---|
| `registerView({ id, title, … })` | Eine Ansicht mit Tab. Mit `panel` und `render` zeichnet sie ein eigenes Panel, ohne `panel` gehört sie zum Diagrammbereich und liefert `plot()` und `controls()`. Weitere Felder: `context` (Zeile unter dem Titel), `basis()` (Umschalter SE/MM zeigen), `button` (Tab einer anderen Ansicht mitbenutzen), `enter()` (beim Öffnen auf eine andere Ansicht umleiten), `after` (Platz des Tabs hinter einer anderen Ansicht), `iconPath` (eigenes Symbol, SVG-Pfad in 24 × 24). Ein Link `…/#<id>` öffnet die Ansicht nach dem Start. Fehlen Tab-Knopf oder Panel im HTML, werden sie angelegt. |
| `registerActions({ name: (value, button) => … })` | Knöpfe mit `data-action="name"` |
| `registerForms({ 'form-id': form => … })` | Formulare (submit) |
| `registerChanges({ name: (value, select) => … })` | Auswahllisten mit `data-change="name"`. Danach baut der Rahmen neu auf, außer bei `{ rerender: false }`. |
| `registerSlot(name, () => html)` | Beitrag zu einer benannten Stelle der Oberfläche. Heute gibt es `marker-tools`, die Knöpfe neben der Markersuche. Der Kern zeigt dort, was die Module liefern. |
| `registerFileState(key, { blank, save, load })` | Zustand, der zu einer Datei gehört: `state[key]` bekommt beim Öffnen `blank()`, `save` liefert den gespeicherten Teil, `load(saved, dataset)` prüft und stellt ihn wieder her. Wie alle Einstellungen geht er auch auf eine Datei gleicher Struktur über, die noch keine eigenen hat. |

Ein doppelt angemeldeter Name bricht beim Laden mit einer klaren Meldung ab.

### Ein neues Fachmodul anlegen

Beispiel: ein künftiger Tab „EMV“. So sähe das Gerüst aus. Es ist **nicht** in der App enthalten, solange es keine Funktion hat.

1. Datei `src/app/module/emv.js` anlegen:

   ```js
   // module/emv – Tab „EMV“: …
   import { $, esc } from '../basis/dom.js';
   import { registerActions, registerFileState, registerView } from '../basis/erweiterung.js';
   import { state } from '../basis/zustand.js';
   import { persistSettings } from '../dateien/einstellungen.js';

   const blank = () => ({ limit: '' });

   function renderEmv() {
     $('emv-panel').innerHTML = '…';
   }

   registerView({ id: 'emv', title: 'EMV', short: 'EMV', icon: 'wave', panel: 'emv-panel', render: renderEmv,
     context: 'Filter und Störaussendung' });
   registerActions({ 'emv-apply': value => { state.emv.limit = value; persistSettings(); renderEmv(); } });
   registerFileState('emv', { blank, save: e => ({ limit: e.limit }), load: e => typeof e === 'object' ? { ...blank(), limit: String(e.limit || '') } : undefined });
   ```

2. Stile, falls nötig, in `src/css/module/emv.css` ablegen und im Gerüst nach `css/module/zeitbereich.css` einbinden.
3. `node tools/importe.mjs`, `python3 tools/build.py`, `node tests/module.mjs`, Tests ergänzen und laufen lassen.

Am Rahmen, an der Ereignisverteilung und am Speichern der Einstellungen ändert sich dabei nichts. Der Build nimmt jede Datei unter `src/app/` automatisch auf.

## CSS

Die Reihenfolge der Stylesheets im Gerüst ist die Kaskade. `basis.css` und die Dateien bis `dialoge.css` sind nach Themen geschnitten, darunter `css/module/` für Connector Studio und Zeitbereich. Die Dateien danach (`claude-schicht.css` bis `telefon-dateischublade.css`) sind spätere Schichten, die frühere Regeln gezielt überschreiben. Sie sind deshalb nach ihrer Entstehung benannt und nicht nach Themen. Sie umzusortieren würde das Aussehen verändern.

`css/dark.css` wird von `python3 tools/dark.py` aus allen Stylesheets vor ihr erzeugt. Die Stylesheets danach sind handgeschriebene Korrekturen für das dunkle Design und werden nicht gespiegelt. Der heutige Inhalt von `dark.css` ist absichtlich der Stand vor dem Umbau. Eine Neuerzeugung brächte einige zusätzliche Regeln für Connector und Auge und gehört geprüft in einen eigenen Schritt.

## Was bewusst nicht entkoppelt ist

- **Ein gemeinsamer Zustand.** `state` in `basis/zustand.js` ist ein Objekt, das alle Module lesen und ändern. Fachmodule bekommen ihren eigenen Teil über `registerFileState`, die älteren Bereiche (S, Z, CISPR, ESB, Achsen) liegen noch direkt in `state`.
- **Kernschichten rufen sich gegenseitig auf.** Der Neuaufbau läuft über `renderMain()` und `render()` im Rahmen. Deshalb hat das Bündel Weiterleitungen für Funktionen, die erst später geladen werden.
- **Tab-Knöpfe und Panels der bestehenden Ansichten stehen im HTML**, damit ihre Reihenfolge und Beschriftung unverändert bleiben. Neue Ansichten brauchen keinen HTML-Eintrag.

## Wie der Umbau geprüft wurde

- Erster Schritt (rein mechanisch): Jede Deklaration wanderte unverändert in ihr Modul, Importe und Exporte wurden aus einer Scope-Analyse erzeugt. Volle Testsuite: 26 von 26 Gruppen bestanden.
- Zweiter Schritt (Erweiterungspunkte): Tabs, Aktionen, Formulare, Auswahllisten, Dateizustand und fachspezifische Ereignisse liegen in den Modulen. `tests/e2e/erweiterung.mjs` baut die App zusätzlich mit einem Probemodul und prüft Tab, Panel, Aktion, Auswahlliste, Dateizustand über Dateiwechsel und Neuladen sowie die Meldung bei doppelter Anmeldung.
- CSS: Die Menge der Regeln ist vor und nach dem Aufteilen gleich (1010 Regeln). Verschoben wurde nur ein Block mit eigenen Selektoren (`.cn-cell`), der mit den Nachbarregeln nichts teilt.
