# S-Parameter Analyzer

Offline-Analyse von Touchstone-Dateien (`.s1p` … `.s32p`, `.ts`) im Browser und als installierbare App für Android, Windows und iPhone.

**App öffnen:** https://simmark.github.io/s-parameter-plotter/

Alle Berechnungen laufen lokal auf dem Gerät. Messdateien werden nicht hochgeladen.

## Funktionen

- **S-Parameter**: Single Ended und Mixed Mode (Sdd, Scc, Sdc, Scd), dB, linear, Phase, entfaltete Phase, Gruppenlaufzeit
- **Ports & Lasten**: Portpaare frei zuordnen; offene Ports mit Open, Short, R, R + jX oder RLC abschließen; Renormierung auf beliebige Bezugsimpedanz
- **Smith-Chart** mit Zᵢₙ am Marker
- **Impedanz**: Zᵢₙ aus Reflexion, Z- und Y-Matrix, Serien- und Shunt-Fixture; L und C als Serien- oder Parallelersatz
- **CISPR 17:2011 § 6.3.1**: Eintor, Zweitor (Serie/Shunt) und Vierport CM/DM
- **CMC-Modell**: Cw, Cg, Ct, L, M und k aus den natürlichen Moden der Y-Matrix; Eigenresonanzen CM/DM
- **Marker**: zwei Marker, Delta, Min/Max-Suche; Eingabe auch kurz wie `100M` oder `2.4G`
- **Export**: CSV, CSV für deutsches Excel (Semikolon, Dezimalkomma), PNG, reduziertes Netzwerk als Touchstone 2.1; am Handy über das Teilen-Menü
- **Würth 7490220115** (WE-LAN): Pinbelegung wird erkannt, Paare und offene Mittelanzapfungen sind vorbelegt

## Bedienung am Handy

| Geste | Wirkung |
|---|---|
| Tippen | Marker setzen |
| Waagerecht wischen | Marker verschieben |
| Zwei Finger spreizen | Frequenzachse zoomen und verschieben |
| Doppeltippen | Zoom zurücksetzen |

Die zuletzt geöffneten Dateien (bis 6, je bis 30 MB) bleiben mit ihrer Portkonfiguration auf dem Gerät gespeichert. Beim nächsten Start öffnet die App die letzte Datei.

## Installation auf Android

1. https://simmark.github.io/s-parameter-plotter/ in **Chrome** öffnen.
2. Warten, bis oben rechts „Offline bereit“ steht (am Handy über das Handy-Symbol in der Kopfzeile).
3. Auf das **Handy-Symbol** tippen oder Chrome-Menü **⋮ → App installieren**.
4. Die App startet ab jetzt vom Startbildschirm, auch im Flugmodus.
5. Messdatei öffnen: in der App **Datei öffnen** – oder im Dateimanager bzw. in einer Mail die `.sNp`-Datei **teilen → S-Analyzer**.

Windows: In Chrome oder Edge das Installationssymbol in der Adressleiste anklicken. Danach lässt sich die App mit Touchstone-Dateien verknüpfen.
iPhone: In Safari **Teilen → Zum Home-Bildschirm**.

## Veröffentlichung über GitHub Pages (einmalig)

1. Auf GitHub im Repo **Settings → Pages** öffnen.
2. Unter **Build and deployment**: Source **Deploy from a branch**, Branch **main**, Ordner **/ (root)**, **Save**.
3. Nach 1–2 Minuten ist die App unter https://simmark.github.io/s-parameter-plotter/ erreichbar.

## Aktualisieren

Neue Fassung von `index.html` ins Repo legen und anschließend `python tools/build.py <quellordner> <zielordner>` ausführen; das Skript schreibt eine neue Cache-Version in `sw.js`. Installierte Apps zeigen beim nächsten Öffnen „Neue Version verfügbar → Neu laden“.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | komplette App (Rechenkern, Diagramm, Oberfläche) |
| `sw.js` | Service Worker: Offline-Cache und Android-Teilen |
| `manifest.webmanifest` | App-Name, Symbole, Teilen-Ziel, Dateizuordnung |
| `icons/` | App-Symbole |
| `tools/build.py` | erzeugt die Cache-Version für `sw.js` |

## Methodik und Grenzen

Formeln und Voraussetzungen stehen in der App unter **Methodik**. Wellenreferenzen müssen reell, positiv und frequenzunabhängig sein. Je Datei sind bis 150.000 Frequenzpunkte, 4 Mio. komplexe Matrixeinträge und 100 MiB möglich.
