# S-Parameter Analyzer

**Deutsch** · [English](#english)

Offline-Analyse von Touchstone-Dateien (`.s1p` … `.s32p`, `.ts`) im Browser und als installierbare App für Android, Windows und iPhone.

**App öffnen:** https://simmark.github.io/s-parameter-plotter/

Entwickelt von **Simon Mark** · info.simonlation@gmail.com

Alle Berechnungen laufen lokal auf dem Gerät. Messdateien werden nicht hochgeladen.

## Funktionen

- **S-Parameter** Single Ended und Mixed Mode (Sdd, Scc, Sdc, Scd): dB, linear, Phase, entfaltete Phase, Gruppenlaufzeit
- **Ports & Lasten**
  - Portpaare frei kombinierbar, jedes Paar mit eigener Farbe; bereits belegte Ports sind ausgegraut
  - Vorlagen für viele Ports: benachbart, gekreuzt, Hälften
  - Offene Ports mit Open, Short, R, R + jX oder RLC abschließen
- **Modenimpedanz je Paar:** Z_D und Z_C frei wählbar, z. B. 0,1 Ω / 100 Ω für Netzfilter nach CISPR 17
- **Smith-Chart** mit Zᵢₙ am Marker
- **Impedanz:** Zᵢₙ, Z- und Y-Matrix, Serien- und Shunt-Fixture, L/C als Serien- oder Parallelersatz
- **CISPR 17:2011 § 6.3.1:** Eintor, Zweitor (Serie/Shunt) und Vierport CM/DM; Ω-Kurven standardmäßig log-log
- **ESB-Modell mit automatischer Erkennung:**
  - **CMC:** Cw, Cg, Ct, L, M, k und Eigenresonanzen
  - **Übertrager (T-Modell):** OCL, OCL₀ aus LC-Fit, n, k, Streuinduktivität Lσ (Sekundärseite kurzgeschlossen), Cww, R, f_res, C_par
  - **Einzelbauteil Serie** (L, Ferrit): L, R_DC, SRF, C_p
  - **Einzelbauteil Shunt** (C): C, SRF, ESL, ESR
- **Marker M1–M4**
  - Magnetisches Einrasten auf der Kurve beim Überfahren
  - Marker an der M-Fahne ziehen, die Werte ändern sich live
  - Bei bis zu 4 Kurven stehen die Werte direkt im Diagramm, sonst in der Tabelle
  - Δ zu M1 und Min/Max-Suche
- **Export:** CSV, CSV für deutsches Excel, PNG, Touchstone 2.1; am Handy über das Teilen-Menü
- **Deutsch / English:** Umschalter oben rechts
- **Würth 7490220115** (WE-LAN): Pinbelegung wird erkannt

## Bedienung

| Maus | Touch | Wirkung |
|---|---|---|
| Klick | Tippen | Marker setzen |
| Über Kurve fahren | – | Wert mit magnetischem Einrasten |
| M-Fahne ziehen | M-Fahne ziehen | Marker verschieben |
| Bereich ziehen / Mausrad | Zwei Finger | Frequenzachse zoomen |
| Doppelklick | Doppeltippen | Zoom zurücksetzen |
| – | Waagerecht wischen | Aktiven Marker verschieben |

Die letzten 6 Dateien (je bis 30 MB) bleiben mit Portkonfiguration, Ansicht und Markern auf dem Gerät gespeichert.

## Installation auf Android

1. https://simmark.github.io/s-parameter-plotter/ in **Chrome** öffnen.
2. Auf das Handy-Symbol oben rechts tippen oder Chrome-Menü **⋮ → App installieren**.
3. Die App startet vom Startbildschirm, auch offline.
4. Messdatei öffnen: In der App die Dateischaltfläche nutzen, oder im Dateimanager bzw. in einer Mail die `.sNp`-Datei **teilen → S-Analyzer**.

Windows: Installationssymbol in der Adressleiste von Chrome oder Edge. iPhone: Safari **Teilen → Zum Home-Bildschirm**.

## Simulator (in Arbeit)

`simulator.html` ist eine zweite Seite im selben Repo: kleine lineare Schaltungen im Frequenzbereich lösen und gegen Single-Pair-Ethernet-Grenzwerte prüfen. Stand: Rechenkern mit Textnetzliste, 10BASE-T1L als erster Standard. Der grafische Editor folgt später.

**Öffnen:** https://simmark.github.io/s-parameter-plotter/simulator.html

| Datei | Inhalt |
|---|---|
| `sim/rf-core.js` | Rechenkern des Analyzers, erzeugt aus `index.html` mit `python tools/extract_core.py` |
| `sim/sim-core.js` | Netzliste, modifizierte Knotenanalyse, Touchstone-Blöcke, Mixed Mode |
| `sim/limits.js` | Grenzkurven als Daten, jede mit Quelle und Prüfstatus |
| `sim/templates.js` | Vorlagen (10BASE-T1L MDI, Lagevergleich der Gleichtaktdrossel, Speisung, Touchstone-Block) |
| `sim/data/` | Öffentliche Messdaten von Würth Elektronik: `74930000.s7p` (WE-STST), `744235251.s4p` (WE-CNSW). Der Simulator lädt sie bei Bedarf nach |
| `tests/` | `python tests/reference.py` rechnet die Referenz mit numpy und scikit-rf, `node tests/run-tests.js` vergleicht |

Netzliste (Werte wie in SPICE, `1m` = Milli, `1Meg` = Mega, Masse = `0`):

```
R1 a b 50                 Widerstand
C1 a b 100n esr=0.02      Kondensator, optional esr= esl=
L1 a b 470u rs=0.1        Spule, optional rs= cp= rp=
K1 L1 L2 0.998            Kopplung zweier Spulen (Punkt am 1. Knoten)
T1 p+ p- s+ s- 2          idealer Übertrager, ü = Up/Us
S1 n1 n2 n3 n4 ref=0 file=datei.s4p   Touchstone-Block
P1 mdi_p 0 50             Port mit Bezugsimpedanz
.pair 1 2                 Ports 1 und 2 als Mixed-Mode-Paar
.sweep log 100k 20MHz 401
.standard 10BASE-T1L [powered]
```

Portbelegung der mitgelieferten Dateien (aus den Messdaten bestimmt, nicht aus der Skizze im Dateikopf):

- `74930000.s7p`: P1 und P3 sind die Enden der Wicklung mit Mittelanzapfung P2. Die zweite Seite besteht aus den Hälften P5–P4 und P7–P6; mit P5 + P6 verbunden liegen die Enden an P7 (gleichphasig zu P1) und P4.
- `744235251.s4p`: Die Wicklungen liegen zwischen P1–P2 und P3–P4. Ein Leiterpaar ist also (P1, P3) auf der einen und (P2, P4) auf der anderen Seite. Die Datei beginnt bei 300 kHz.

Grenzen: nur lineare Kleinsignalanalyse, Touchstone-Blöcke werden nicht extrapoliert, und der Simulator ist noch nicht im Offline-Cache der App (`sw.js`, `tools/build.py`). Nach einer Änderung am Rechenkern in `index.html` muss `tools/extract_core.py` neu laufen.

## GitHub Pages

Settings → Pages → *Deploy from a branch* → `main` / `(root)`.

## Aktualisieren

`python tools/build.py <quellordner> <zielordner>` schreibt eine neue Cache-Version in `sw.js`. Installierte Apps zeigen beim nächsten Öffnen „Neue Version verfügbar → Neu laden“.

---

## English

Offline analysis of Touchstone files in the browser and as an installable app (Android, Windows, iPhone). Developed by **Simon Mark** · info.simonlation@gmail.com. All calculations run locally; files never leave the device.

Highlights:
- Single-ended and mixed-mode S-parameters.
- Colour-coded port pairs with per-pair mode impedances, e.g. 0.1 Ω / 100 Ω.
- Smith chart, impedance and CISPR 17 evaluation (log-log Ω plots).
- Equivalent circuits with automatic detection: CMC, transformer T model with OCL, leakage, Cww, n and k, and series/shunt components.
- Up to four markers with magnetic hover and draggable tags.
- CSV/PNG/Touchstone export.
- German/English UI.

**Install on Android:** open the link in Chrome → ⋮ → *Install app*. Share `.sNp` files to *S-Analyzer* to open them.
