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

## Lizenz

© 2026 Simon Mark · info.simonlation@gmail.com. Alle Rechte vorbehalten. Kein Open Source: Kopieren, Verändern oder Weiterverwenden des Quelltexts, auch in Teilen, nur mit schriftlicher Zustimmung des Autors.

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

### Viewer, port profile and templates (version 3)

Open several files, a folder or a ZIP; step through with PgUp/PgDn; overlay up to 6 files and show the difference to the open file. "Save to file" stores pairs, terminations, reference impedances and the curve selection as a comment block (`! [SPA-Port-Profile] 1 …`) inside the Touchstone file (2.x: inside `[Begin Information]`). "Learn as template" stores a behaviour fingerprint that assigns the ports of similar files automatically, even with a different port order.

### Version 4

SPICE library viewer (R, L, C, K, X, parameterised subcircuits → S-parameters), in-app library with folders, arrow-key stepping, reduced and full-screen view, 0–4 markers, tying ports together, equivalent circuit up to the second resonance with SPICE export, dark theme.

### License

© 2026 Simon Mark. All rights reserved. Not open source: copying, modifying or reusing the source code, in whole or in part, requires the written permission of the author.
