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
- **Tab Z · Impedanz:** Zᵢₙ, Z- und Y-Matrix, Serien- und Shunt-Fixture; R/ESR, X, Phase, L/ESL und C als Serien- oder Parallelersatz mit Vorzeichen, Güte Q
- **Tab Z · CISPR 17:2011 § 6.3.1:** Eintor, Zweitor (Serie/Shunt) und Vierport CM/DM; Ω-Kurven standardmäßig log-log
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

## Viewer, Port-Profil und Vorlagen (Version 3)

- **Mehrere Dateien:** mehrere Dateien, einen Ordner (mit Unterordnern) oder ein ZIP öffnen bzw. hineinziehen. Die Dateiliste steht links, `Bild↑`/`Bild↓` oder die Pfeile oben blättern. Ansicht und Einstellungen bleiben je Datei erhalten.
- **Vergleich:** `+` neben einer Datei legt deren Kurven über die geöffnete Datei ⟨A⟩, `Δ zu ⟨A⟩` zeigt die Differenz. Bis zu 6 Dateien.
- **Port-Profil in der Datei:** „In Datei speichern“ (Tab Ports & Lasten) schreibt Paare, Abschlüsse, Bezugsimpedanzen und Kurvenauswahl als Kommentarblock in die Touchstone-Datei. Die Messdaten bleiben unverändert.

  ```
  ! [SPA-Port-Profile] 1
  ! SPA name: LAN-Übertrager
  ! SPA pair 1: 1 3
  ! SPA pair 2: 4 6
  ! SPA load 2: open
  ! SPA load 5: open
  ! SPA view: tab=s basis=mm format=db
  ! SPA traces mm: D2:D1 C2:C1 D1:D1 C1:C1
  ! [End SPA-Port-Profile]
  ```

  Touchstone 1.x: Block am Dateianfang. Touchstone 2.x: innerhalb von `[Begin Information]`/`[End Information]`.
- **Lernende Vorlagen:** „Als Vorlage lernen“ speichert einen Verhaltens-Fingerabdruck (|Sdd|, |Scc|, Modenkonversion). Neue Dateien mit gleicher Portzahl werden damit automatisch zugeordnet, auch bei anderer Portreihenfolge.
- **Grenzen des Browsers:** Direktes Überschreiben der Datei geht nur, wenn sie über „Öffnen mit“ (Desktop) oder die Ordnerauswahl geöffnet wurde; sonst wird eine Kopie heruntergeladen. „Öffnen mit“ aus dem Dateimanager gibt es nur auf Desktop-Chrome/Edge, auf Android läuft das über „Teilen“. Nachbardateien eines Ordners sieht die App erst nach einmaliger Ordnerfreigabe.

## Version 4: SPICE-Viewer, Bibliothek, Ersatzschaltbild, dunkles Design

- **SPICE-Bibliotheken:** `.lib`/`.sub`/`.cir` öffnen (auch im ZIP). Jeder Subcircuit wird ein Listeneintrag und per AC-Analyse in S-Parameter umgerechnet. Unterstützt sind R, L, C, K, X und `.subckt` mit Parametern; der Sweep ist links einstellbar.
- **Bibliothek:** „Ablegen“ speichert geöffnete Dateien dauerhaft in der App, in Ordnern je Bauteiltyp. Ein Klick auf einen Ordner lädt ihn zum Durchblättern.
- **Blättern:** `←`/`→` (auch im Diagramm; `Umschalt`+Pfeil bewegt den Marker). Der gewählte Tab bleibt dabei erhalten.
- **Ansicht:** Knopf im Diagrammkopf schaltet normal → reduziert → Vollbild, `Esc` beendet.
- **Marker:** 0 bis 4 Marker; die Tabelle zeigt nur die gewählte Darstellung.
- **Ports verbinden:** Abschluss „Verbinden mit Px“ schließt Pins zu einem Knoten zusammen, der dann aktiv bleibt, in ein Paar geht oder einen Abschluss bekommt.
- **ESB:** L(f) mit Vorzeichen, C über die Thomson-Gleichung mit Kontrolle über der Frequenz, Skala auf den Nennwert begrenzt. Für Induktivitäten und CMCs ein Modell bis zur 2. Resonanz, als SPICE-`.lib` exportierbar.
- **Design:** hell/dunkel, folgt dem System oder dem Knopf oben.

## Version 6: Handy-Kopfzeile und Dark-Mode-Korrektur

- Am Handy zeigt die Kopfzeile nur Logo, Hell/Dunkel und ein Zahnrad. Dateien & Bibliothek, Sprache, Methodik, Export und Installation liegen im Zahnrad-Menü.
- Die Blätterpfeile für mehrere Dateien sitzen am Handy direkt unter dem Diagramm (mit Dateiname und Zähler); am Desktop bleiben sie oben.
- Im dunklen Design waren Akzent- und ausgewählte Buttons (Anwenden, Paar anlegen, Plus wählen, Export, Hell/Dunkel) unleserlich; alle sichtbaren Schaltflächen werden jetzt automatisch auf Kontrast geprüft.

## Version 7: Standardkurven, Kurvenwahl merken, Vorlagenpakete

- Standardkurven je Bauteiltyp: CMC zeigt Sdd21 und Scc21 (Erweitert: + Sdc21), LAN-Übertrager Sdd21, Scc21, Sdd11 und Sdc21 (Erweitert: + Scc11, Sdd22, Scd21). Der Typ kommt aus dem Bauteiltyp-Namen, sonst aus Struktur und Physik.
- Deine Kurvenauswahl und ausgeblendete Kurven gelten pro Bauteiltyp für alle Dateien (auch beim Durchblättern) und bleiben nach einem Neustart erhalten. Die zuletzt angesehene Datei wird beim Start wieder geöffnet.
- „Vorlagen & Einstellungen": Fingerabdrücke und Kurvenwahl als JSON-Paket exportieren, aus Datei oder per https-Adresse (GitHub) laden. Siehe `fingerprints/README.md`.

- Stapel analysieren (Seitenleiste → „Stapel“ oder Vorlagen-Dialog): lernt aus allen geladenen Dateien mit gespeichertem Port-Profil Fingerabdrücke und erkennt die übrigen damit automatisch, auch bei vertauschten Ports. Nicht erkannte Dateien werden als „Unbekannt“ aufgelistet.

## Version 8: Dauerhafter Speicher, Bibliothek, mobile Dateiverwaltung, Achsen

**Dateien bleiben nach F5 erhalten**

- Jede importierte Datei, jeder Ordner und jedes ZIP wird beim Import in den Browserspeicher geschrieben, zurückgelesen und mit dem Original verglichen (SHA-256). Erst danach gilt die Datei als gespeichert.
- Die **Sitzung** (alle geladenen Dateien, die geöffnete Datei, Tab, Ports, Marker, Achsen) ist nach Neuladen, Browser-Neustart und App-Update wieder da.
- Die **Bibliothek** ist die bewusst geordnete Sammlung: mehrere Bibliotheken, Ordner und Unterordner, Suche, Filter nach Portzahl und Bauteiltyp.
- **„In Bibliothek“** bietet: nur die geöffnete Datei, das gesamte ZIP bzw. Importpaket, mehrere ausgewählte Dateien, alle Dateien der Sitzung. Der Dialog zeigt Anzahl, gespeichert, fehlgeschlagen, Prozent und Speicherbelegung und prüft am Ende, was wirklich in der Bibliothek liegt.
- Gleiche Inhalte liegen nur einmal im Speicher. „Sitzung leeren“ löscht nichts aus der Bibliothek, Löschen in der Bibliothek beschädigt keine Sitzungsdatei.
- **Namenskonflikte** (gleicher Ort, anderer Inhalt): Überspringen, Ersetzen oder Umbenennen. Nichts wird unbemerkt überschrieben.
- **Unterbrochene Importe** (Tab geschlossen, Browser beendet, Abbrechen) hinterlassen nichts Halbes. Die App meldet sie beim nächsten Start und räumt auf.
- **ZIP:** verschachtelte Ordner, Unicode-Namen, ZIP64, CRC-Prüfung je Datei; verschlüsselte, beschädigte oder nicht unterstützte Einträge werden einzeln gemeldet. Schutz gegen ZIP-Bomben (100 MiB je Datei, 2 GiB je Archiv, 20 000 Einträge) und Pfade, die aus dem Archiv herausführen.
- **Speicher & Sicherung** (Kopfzeile bzw. Zahnrad-Menü): OPFS ja/nein, belegter und freier Speicher, persistente Speicherung, Anzahl Dateien und Bibliotheken, letzte Sicherung, Funktionstest (schreiben, lesen, vergleichen, entfernen), Sicherung als ZIP exportieren und wieder einspielen.
- Browserspeicher ist **nicht unzerstörbar**: Browserdaten löschen, App deinstallieren oder privater Modus entfernen die Dateien. Deshalb gibt es die Sicherung.
- Daten der Vorversion (Bibliothek und „Zuletzt geöffnet“) werden beim ersten Start übernommen und geprüft.

**Handy**

- Das Ordnersymbol links oben öffnet die Dateiverwaltung als Schublade von links. Schließen mit X, Tippen daneben, Wischen nach links oder der Zurück-Taste.
- Datei antippen → Diagramm → Schublade zu. Kein Sprung an den Seitenanfang, die Scrollposition der Schublade bleibt.

**Diagramme**

- L(f) und C(f) werden mit Vorzeichen gezeichnet; Resonanzen und Vorzeichenwechsel haben keine Lücken mehr.
- Y-Achse **±Log** (symmetrisch logarithmisch) für vorzeichenbehaftete Größen. Die einfache Log-Achse gibt es nur für positive Größen.
- Y-Skala mit der Maus: Mausrad zoomt, Ziehen verschiebt, Doppelklick setzt zurück; Umschalt + Mausrad im Diagramm zoomt ebenfalls vertikal. Minimum und Maximum lassen sich eingeben. Achsen werden je Datei und Ansicht gespeichert.
- Impedanz und CISPR 17 liegen in einem Tab **Z**; gespeicherte Einstellungen bleiben gültig.

**ESB**

- Bei 1- und 2-Port-Dateien wählt die Physik-Erkennung das Modell (induktiv oder kapazitiv) und die Fixture (Serie, Shunt, Eintor). Ein Kondensator in einer Serien-Fixture wird nicht mehr als Induktivität behandelt. Das Ergebnis ist als sicher, wahrscheinlich oder nicht eindeutig gekennzeichnet und lässt sich übersteuern.

## Tests

```
node tests/static.mjs            # Lizenz, Cache-Version, Syntax
node tests/magnetic.unit.mjs     # Bauteil-Erkennung
node tests/rf.reference.mjs      # RF-Mathematik gegen Referenznetzwerke und gegen main
node tests/e2e/run.mjs           # Browser-Abläufe A–D, ZIP, Speicher, Achsen, ESB (braucht Playwright und Chrome)
```

Die Browser-Tests brauchen einmalig `npm install playwright` (oder `CHROME_PATH=/pfad/zu/chrome`). Alle Testdaten sind synthetisch und werden zur Laufzeit erzeugt. Was nur am echten Gerät geprüft werden kann, steht in [docs/geraetetests.md](docs/geraetetests.md). Aufbau des Speichers: [docs/speicher.md](docs/speicher.md).

## Bauteil-Erkennung (Physik)

- Beim Öffnen von 1-, 2- und 4-Port-Dateien wertet die App die komplexe S-Matrix aus. Vierpole: Wicklungspfade, L₁, L₂, k, Windungsverhältnis, Kernverlust, Eigenresonanz, Sdd21/Scc21/Sdc21. Daraus folgt der Kandidat CMC, gekoppelte Doppeldrossel, Übertrager oder „nicht eindeutig“. Zweipole: Induktivität (Ferrit, Luft/Keramik, Perle), Kondensator, Widerstand.
- Die Karte „Bauteil-Erkennung“ im Tab Ports zeigt Begründung, Herstellerangabe aus dem Dateikopf (getrennt bewertet) und die Knöpfe „Als Leitungen/Wicklungen übernehmen“. Nichts wird ohne Klick übernommen.
- Eine gelernte Vorlage wird nicht mehr automatisch angewendet, wenn die Messung ihrer Klasse widerspricht (z. B. „CMC“-Vorlage auf einer Doppeldrossel).
- Gelernte Vorlagen speichern zusätzlich Klasse und Physik-Fingerabdruck (spa-pack v1, optionale Felder).
- Methode, Ergebnisse und Grenzen: [docs/magnetik-erkennung.md](docs/magnetik-erkennung.md). Tests: `node tests/magnetic.unit.mjs`.

## Lizenz

© 2026 Simon Mark · info.simonlation@gmail.com. Alle Rechte vorbehalten. **Proprietäre Software, kein Open Source.**

Das Repository ist öffentlich lesbar. Das ist keine Freigabe: Kopieren, Verändern, Weiterverbreiten oder Einbauen des Quelltexts in andere Produkte, auch in Teilen, ist nur mit vorheriger schriftlicher Zustimmung des Rechteinhabers gestattet. Die bestimmungsgemäße Nutzung der bereitgestellten Web-App ist erlaubt.

Die vollständigen Bedingungen stehen in [LICENSE.txt](LICENSE.txt) und in der App unter **Lizenz**. Die App enthält keine Softwarekomponenten Dritter.

## Bedienung

| Maus | Touch | Wirkung |
|---|---|---|
| Klick | Tippen | Marker setzen |
| Über Kurve fahren | – | Wert mit magnetischem Einrasten |
| M-Fahne ziehen | M-Fahne ziehen | Marker verschieben |
| Bereich ziehen / Mausrad | Zwei Finger | Frequenzachse zoomen |
| Doppelklick | Doppeltippen | Zoom zurücksetzen |
| – | Waagerecht wischen | Aktiven Marker verschieben |

| Mausrad / Ziehen auf der Y-Skala | – (Achsendialog) | Vertikale Achse zoomen / verschieben |
| Doppelklick auf die Y-Skala | – | Vertikale Achse zurücksetzen |

Alle geladenen Dateien (je bis 100 MiB, bis 1000 je Sitzung) bleiben mit Portkonfiguration, Ansicht, Markern und Achsen auf dem Gerät gespeichert.

## Installation auf Android

1. https://simmark.github.io/s-parameter-plotter/ in **Chrome** öffnen.
2. Auf das Handy-Symbol oben rechts tippen oder Chrome-Menü **⋮ → App installieren**.
3. Die App startet vom Startbildschirm, auch offline.
4. Messdatei öffnen: In der App die Dateischaltfläche nutzen, oder im Dateimanager bzw. in einer Mail die `.sNp`-Datei **teilen → S-Analyzer**.

Windows: Installationssymbol in der Adressleiste von Chrome oder Edge. iPhone: Safari **Teilen → Zum Home-Bildschirm**.

## GitHub Pages

Settings → Pages → *Deploy from a branch* → `main` / `(root)`.

## Aktualisieren

`python3 tools/build.py` schreibt die Cache-Version (Hash der App-Dateien) direkt in `sw.js`. Das muss vor jedem Commit laufen, der die App ändert: Ohne neue Version zeigt eine installierte App weiter die alte `index.html` aus dem Cache. `python3 tools/build.py --check` prüft das, `node tests/static.mjs` ebenfalls. Installierte Apps zeigen beim nächsten Öffnen „Neue Version verfügbar → Neu laden“. Gespeicherte Dateien bleiben bei einem Update erhalten.

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

### Viewer, port profile and templates (version 3)

Open several files, a folder or a ZIP; step through with PgUp/PgDn; overlay up to 6 files and show the difference to the open file. "Save to file" stores pairs, terminations, reference impedances and the curve selection as a comment block (`! [SPA-Port-Profile] 1 …`) inside the Touchstone file (2.x: inside `[Begin Information]`). "Learn as template" stores a behaviour fingerprint that assigns the ports of similar files automatically, even with a different port order.

### Version 4

SPICE library viewer (R, L, C, K, X, parameterised subcircuits → S-parameters), in-app library with folders, arrow-key stepping, reduced and full-screen view, 0–4 markers, tying ports together, equivalent circuit up to the second resonance with SPICE export, dark theme.

### Version 8

Durable storage: every imported file, folder and ZIP is written to browser storage (OPFS, IndexedDB as fallback), read back and verified, so the session survives reloads, restarts and updates. Libraries with folders, search and filters; adding the open file, a whole ZIP or a selection with progress and a verified result. Robust ZIP reader (ZIP64, CRC, size limits, path checks). Storage diagnosis, self test, backup export and import. On phones the file manager is a drawer from the left. Signed L(f)/C(f), symmetric log Y axis, Y axis by mouse, one tab "Z" for impedance and CISPR 17. Equivalent-circuit model and fixture for one- and two-port files follow the physics detection.

### License

© 2026 Simon Mark. All rights reserved. **Proprietary software, not open source.** The repository is publicly readable; that is not a release: copying, modifying, redistributing or incorporating the source code, in whole or in part, requires the prior written permission of the copyright holder. Using the provided web app for its intended purpose is permitted. Full terms: [LICENSE.txt](LICENSE.txt) and in the app under **License**. The app contains no third-party software components.
