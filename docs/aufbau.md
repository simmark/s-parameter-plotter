# Aufbau des Quelltexts

Die App wird weiterhin als **eine** Datei ausgeliefert: `index.html`. Geschrieben wird sie aber nicht mehr dort, sondern in `src/`. `tools/build.py` setzt die Teile zu `index.html` zusammen. `index.html` bleibt im Repository, weil GitHub Pages sie unverändert ausliefert. Sie ist eine erzeugte Datei: **bearbeitet wird `src/`, nie `index.html`.**

## Ablauf beim Ändern

```
# Datei in src/ bearbeiten, dann:
python3 tools/build.py          # schreibt index.html aus src/ und die Cache-Version in sw.js
node tests/static.mjs           # prüft, dass index.html zu src/ passt (build.py --check)
```

Vergisst man den Build, schlägt `tests/static.mjs` fehl, und `python3 tools/build.py --check` beendet sich mit Fehlercode 1. `build.py` bricht außerdem ab, wenn eine Datei in `src/` nirgends eingebunden ist oder eine Einbindung auf eine fehlende Datei zeigt.

## Aufbau von `src/`

`src/index.src.html` ist das Gerüst der Seite. Jede Zeile `@@include pfad@@` wird durch den Inhalt der Datei `src/pfad` ersetzt, ohne Änderung, ohne zusätzliche Zeilenumbrüche.

| Ordner | Inhalt |
|---|---|
| `css/` | Stylesheets in der Reihenfolge, in der sie wirken (die Reihenfolge im Gerüst ist die Kaskade). `dark.css` ist **erzeugt** (siehe unten). |
| `html/` | Symbolsammlung, Kopfleiste und Arbeitsbereich, Dialoge, Methodik, Speicher und Lizenz (enthält den Lizenztext), Installationshinweis |
| `js/theme.js`, `js/i18n.js`, `js/plot.js`, `js/pwa.js` | Hell/Dunkel, Zweisprachigkeit (Deutsch/Englisch), Diagrammzeichnung, Service Worker und Installation |
| `js/kerne/` | Die eigenständigen Rechenkerne: `rf-core`, `spice-core`, `magnetic-core`, `td-core`, `connector-core`, `store-core`. Sie hängen nicht an der Oberfläche. Die Tests laden sie direkt, und der Rechen-Worker baut sich aus drei davon. |
| `app/01…19-*.js` | Die Oberfläche in 19 Abschnitten (Sitzung, Import, Bibliothek, Speicher, Connector Studio, Zeitbereich, Modell-Editor, Packs, Batch usw.) |

## Was diese Aufteilung ist und was nicht

- **Gleiches Ergebnis wie vorher.** Beim Umbau wurde die erzeugte `index.html` Byte für Byte mit der früheren verglichen: identisch. Am Verhalten der App hat sich nichts geändert.
- **Die Kerne sind echte Dateien**, jede für sich lesbar und testbar.
- **Die Dateien in `app/` sind Abschnitte eines einzigen Programms**, keine unabhängigen Module. Sie liegen in derselben Funktion (`(() => { … })()`) und teilen sich ihre Variablen. Man kann sie also gut finden und lesen, aber eine Datei allein ist kein gültiges JavaScript, und eine Funktion in einem Abschnitt kann einen anderen Abschnitt weiter benutzen.
- **Warum nicht gleich echte ES-Module?** Die App muss offline und als einzelne Datei laufen, der Rechen-Worker wird zur Laufzeit aus dem Text der Kerne gebaut, und die Tests schneiden die Kerne aus `index.html`. Echte Module würden das alles anfassen und lassen sich nicht mehr mit einem einfachen Vergleich „vorher = nachher“ absichern. Der nächste sinnvolle Schritt wäre, die `app/`-Abschnitte einzeln herauszulösen: jeweils mit klar benannter Schnittstelle, Abschnitt für Abschnitt, mit der Testsuite als Netz.

## Dunkles Design

`css/dark.css` wird von `python3 tools/dark.py` aus allen Stylesheets **vor** ihr erzeugt. Stylesheets dahinter (`kontrast-menue-pager.css` und folgende) sind handgeschriebene Korrekturen für das dunkle Design und werden nicht noch einmal gespiegelt. Der heutige Inhalt von `dark.css` ist der Stand vor dem Umbau und wurde bewusst nicht neu erzeugt (siehe README).
