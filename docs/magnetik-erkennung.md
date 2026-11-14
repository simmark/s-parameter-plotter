# Bauteil-Erkennung aus der komplexen S-Matrix

Stand: 14.11.2026 · Modul `Magnetic` 1.0.0 (in `index.html`, `<script id="magnetic-core">`)

## Was das Modul tut

Beim Öffnen einer 1-, 2- oder 4-Port-Datei wertet das Modul offline die **komplexe** S-Matrix aus und zeigt im Tab **Ports** die Karte **Bauteil-Erkennung**:

- **Vierpol (s4p):** Wicklungspfade, L₁, L₂, M, Kopplungsfaktor k, Windungsverhältnis n, Kernverlust tan δ, Eigenresonanz, Sdd21/Scc21/Sdc21/Scd21. Daraus folgt der Kandidat **CMC**, **gekoppelte Doppeldrossel**, **Übertrager**, **zwei getrennte Zweipole**, **sonstiges Netzwerk** oder **nicht eindeutig**.
- **Zweipol (s1p, s2p):** Serien- oder Querelement, Induktivität (Ferritkern, Luft-/Keramikkern, Ferrit-Perle), Kondensator oder Widerstand mit L, C, R, ESR, Eigenresonanz und Güte.
- **6-, 7-, 8-Port:** keine Physik-Klassifikation, die bisherigen Vorlagen gelten unverändert.

Herstellerangaben aus dem Dateikopf (`Match Code: WE-DD P/N: …`) werden **getrennt** angezeigt und nur verglichen („passt zur Messung“ / „widerspricht“). Der Dateiname geht nicht in die Klassifikation ein.

Nichts wird ohne Klick übernommen. Die Knöpfe „Als Leitungen übernehmen“ (CMC/Doppeldrossel-Lesart) und „Als Wicklungen übernehmen“ (Übertrager-Lesart) setzen die Paare mit den gepunkteten Enden als Plus.

## Priorität beim Öffnen

1. Einstellungen der laufenden Sitzung
2. Auf dem Gerät gemerkte Einstellungen dieser Datei
3. Gespeicherte SPICE-Modell-Einstellungen
4. Im Dateikopf eingebettetes Port-Profil
5. Gelernte Vorlage mit ≤ 5 dB Abstand, **nur wenn die Physik nicht widerspricht**
6. Einstellungen der vorherigen Datei gleicher Portzahl
7. Standard

Neu ist nur die Bedingung in Punkt 5. Widerspricht die Messung der Klasse der Vorlage, wird die Vorlage nicht automatisch angewendet. Der Grund steht in der Karte. Das gilt zum Beispiel für eine als „CMC“ gelernte Vorlage auf einer Doppeldrossel, und auch dann, wenn die Messung zwischen CMC und Doppeldrossel nicht eindeutig ist. Die Klasse einer Vorlage kommt aus dem neuen Feld `category`, sonst aus dem Namen. Auch bei einem Widerspruch zum Dateikopf wird gesperrt. Ein physikalischer Vorschlag wird nie automatisch angewendet.

Wenn die aktiven Paare nicht zu den gemessenen Wicklungen passen, zeigt der S-Tab eine Warnung. Das gilt für Paare quer zu den Wicklungen ebenso wie für gegensinnig verbundene Paare.

## Methode

**Wicklungspfade.** Zwei schwebende Wicklungen a→b und c→d erzwingen in der Y-Matrix `Y[a,:] + Y[b,:] = 0` und `Y[c,:] + Y[d,:] = 0`. Für alle drei Aufteilungen der vier Ports wird der relative Restfehler im unteren Frequenzband berechnet (Median, f ≤ 30·f_min).

| Restfehler der besten Aufteilung | Abstand zur zweitbesten | Einstufung |
|---|---|---|
| ≤ 0,01 | ≥ 0,03 oder Faktor 8 | **sicher** |
| ≤ 0,05 | Faktor 3 | **wahrscheinlich** |
| sonst | | **unklar**, keine Klassifikation |

**Zweigmatrix.** Aus der Y-Matrix folgt die 2×2-Zweigadmittanz. Für sie werden die vier gleichwertigen Einträge gemittelt, etwa `Yb11 = (Yaa − Yab − Yba + Ybb)/4`. Daraus `Zb = Yb⁻¹`, also `L = Im Z/ω`, `R = Re Z`, `M = Im Z12/ω` und `k = M/√(L₁L₂)`. Das Vorzeichen von k gibt den Wickelsinn an.

**Band für k.** Ausgewertet wird unter 0,2·f_res. Die Streureaktanz muss ≥ 1 Ω sein, damit sie im 50-Ω-System messbar ist, und ωL ≤ 50 kΩ. Ist das Band zu schmal, wird die Schwelle gelockert und das Ergebnis als „eingeschränkt“ oder „unsicher“ gekennzeichnet. L wird an den ersten messbaren Punkten abgelesen.

**Kernverlust.** `tan δ = (R(f) − R_DC)/(ωL)` bis 0,5·f_res. Ein hoher Wert bedeutet hochpermeablen, verlustbehafteten Ferrit (CMC), ein kleiner einen verlustarmen, gescherten Kern (Speicherdrossel).

**Zweipol.** Ein Serienelement erfüllt `S11 ≈ 1 − S21`, ein Querelement `S11 ≈ S21 − 1`. Der kleinere Restfehler (≤ 0,1 und doppelt so gut wie der andere) bestimmt die Topologie. Die erste deutlich dominierende Reaktanz bestimmt L oder C; bleibt sie aus, ist es ein Widerstand.
- **Kernart:** Fällt L, deutet das auf einen Kern; konstantes L bei hoher Güte deutet auf einen Luft- oder Keramikkern.
- **Ferrit-Perle:** Wird R > X weit unter der Resonanz, ist es eine Ferrit-Perle.
- **Kernart unklar:** Bleibt sie offen, lautet das Ergebnis „Induktivität“.

**Entscheidung.** Jeder Befund vergibt Merkmalspunkte an die Klassen (Tabelle unten). Die Stufen lauten:
- **wahrscheinlich:** mindestens 3 Punkte und mindestens 2,5 Abstand zur zweiten Klasse,
- **möglich:** mindestens 2 Punkte und mindestens 1,5 Abstand,
- **nicht eindeutig:** alles darunter.

Die Punkte sind **keine kalibrierte Wahrscheinlichkeit**.

| Befund | CMC | Doppeldrossel | Übertrager |
|---|---:|---:|---:|
| \|k\| < 0,9 | −2,5 | +2,5 | −2,5 |
| 0,9 ≤ \|k\| < 0,95 | −1 | +1,5 | −2 |
| 0,95 ≤ \|k\| < 0,99 | | +1 | −1 |
| 0,99 ≤ \|k\| < 0,999 | +0,5 | | +0,5 |
| \|k\| ≥ 0,999 (+ „gleicher Aufbau“ bei n ≈ 1) | +1 | −1 | +1,5 (+1) |
| n ≥ 1,15 | −3 | −2 | +4 |
| L₁ ≈ L₂ | +0,5 | +0,5 | |
| tan δ ≥ 0,25 | +3 | −2 | +0,5 |
| tan δ ≤ 0,15 | −1,5 | +2 | |
| L ≥ 1 mH | +2,5 | −1,5 | |
| L ≤ 20 µH und \|k\| < 0,995 | | +0,5 | |
| \|k\| < 0,3 | → „zwei getrennte Zweipole“ | | |

## Ergebnisse

Alle Zahlen stammen aus Daten, die beim Entwerfen der Regeln bekannt waren. Sie sind deshalb eine **Regression, keine unabhängige Genauigkeit**. Die Regeln wurden zuerst anhand der WE-DD-1210/1260-Messungen und der vier WE-CMB-Messungen festgelegt. Die übrigen 51 WE-DD- und 25 WE-MCRI-Messungen kamen erst danach dazu. Nach der Sichtung der Simulationen wurden die Gewichte noch einmal nachjustiert (k < 0,9, Verlustschwellen, mH-Regel).

| Datensatz | Herkunft | Ergebnis |
|---|---|---|
| WE-DD, 71 Messungen | Hersteller-S4P | 63 Doppeldrossel wahrscheinlich · 8 möglich · **0 CMC** |
| WE-MCRI, 25 Messungen | Hersteller-S4P | 19 wahrscheinlich · 6 möglich · **0 CMC** |
| WE-DD 744870471 (Scc21 −57,3 dB bei 1 MHz) | Hersteller-S4P | Doppeldrossel wahrscheinlich |
| WE-CMB 744821039/120, 744823210/333 | Hersteller-S4P (komplex, mit Phase) | 4 × CMC wahrscheinlich |
| WE-RFI, 4 × s2p | Hersteller-S4P | 4 × Ferritkern-Induktivität möglich |
| 7490220115, auf 4 Ports reduziert (Mittelanzapfungen offen) | Hersteller-S6P | CMC möglich (enthält eine CMC in Reihe; 1:1-Übertrager und CMC sind kaum trennbar) |
| Wicklungspfade der 96 WE-DD/MCRI | gegen Prototyp-CSV | 96/96 gleich, alle „sicher“, darunter 7 Fälle mit P1–P4/P2–P3 |
| k gemessen gegen K der WE-DD-LTspice-Modelle | 71 Artikel | Median \|Δk\| 0,024, Maximum 0,060 |
| Unabhängige Gegenrechnung Sdd21/Scc21/Sdc21 gegen die App | 3 Dateien × 5 Frequenzen | Abweichung < 0,005 dB (Rundung) |
| Experimentelles 52er-Vorlagenpaket (50 × „CMC“) im Browser | 96 WE-DD/MCRI + 4 WE-CMB | 70 Doppeldrosseln hätten eine CMC-Vorlage automatisch erhalten, jetzt **70 × gesperrt**; 26 ohne Treffer ≤ 5 dB; die 4 CMCs erhalten ihre CMC-Vorlage weiterhin automatisch |
| Nutzerpaket (8 CMC + 2 LAN) | 96 WE-DD/MCRI | kein Treffer ≤ 5 dB, keine Änderung |
| Port-Permutationen und vertauschte Wicklungsenden | 5 Dateien × 4 Permutationen, synthetisch 5 | Klasse unverändert, Paare folgen den Ports |

Zum Vergleich der experimentelle Prototyp `cmc_vs_coupled_classifier.js` (v0.2) auf denselben Dateien:
- WE-DD: 64 Doppeldrossel wahrscheinlich, 5 möglich, 2 unklar.
- WE-MCRI: 25 wahrscheinlich.
- Die **4 echten CMCs: 4 × „nicht eindeutig“**. Bei 100 kHz bis 1 MHz liegen sie schon über ihrer Eigenresonanz, sodass sein k-Proxy dort nicht rechenbar ist.

**Simulierte Herstellermodelle** (eigener SPICE-Teilsimulator, 1 kHz bis 1 GHz; Stichprobe von bis zu 12 Modellen je Familie, 1575 Modelle aus allen unverschlüsselten Bibliotheken; das Etikett ist die Familie laut Katalog):

| Familienklasse | Ergebnis |
|---|---|
| CMC, 4-polig (219) | 186 CMC · 21 unklar · 12 Doppeldrossel (WE-SCC, WE-CMDC) |
| Gekoppelt, 4-polig (102) | 55 Doppeldrossel · 23 CMC (WE-DPC, WE-CFWI, WE-DCT, WE-TDC) · 12 Übertrager (WE-MTCI, WE-EHPI mit n ≠ 1) · 11 unklar |
| Übertrager, 4-polig (53) | 49 Übertrager · 3 Doppeldrossel · 1 unklar |
| Induktivität, 2-polig (618) | 456 Ferritkern · 113 Induktivität (Kern unklar) · 26 Luft-/Keramikkern · 16 Perle · 7 Daten unzureichend |
| Kondensator, 2-polig (420) | 390 Kondensator · 26 Luft-/Keramikkern · 4 Ferritkern (große Elkos: in der Serienschaltung ab 1 kHz nur ESR und ESL sichtbar) |
| Ferrit-Perle, 2-polig (120) | 74 Perle · 46 Ferritkern-Induktivität |
| Luftspule, 2-polig (22) | 22 Luft-/Keramikkern |

Viele Modelle bilden die frequenzabhängigen Kernverluste nicht nach. Ideale Speicherdrossel-Modelle wirken deshalb kernlos, und manche CMC-Modelle wirken verlustarm. Für Messdaten ist der Kernverlust aussagekräftiger als für Modelle.

Laufzeit: Median 4 ms, Maximum 70 ms je Datei (Node, 800 Frequenzpunkte).

## Grenzen

- Echte, komplexe CMC-Messungen gibt es nur aus **einer** Familie (WE-CMB, 4 Dateien). Für Signal-CMCs (WE-CNSW, WE-SL), 1:1-Übertrager und Fremdhersteller fehlen gemessene Positivbeispiele. Eine Empfindlichkeit für unbekannte CMCs ist damit nicht belegt.
- Ein 1:1-Übertrager und eine CMC sind gleich aufgebaut. Die S-Parameter trennen sie kaum, das Ergebnis ist dann „nicht eindeutig“ oder „möglich“.
- Doppeldrosseln, die auch als CMC einsetzbar sind (z. B. WE-DPC), können als „CMC möglich“ erscheinen.
- Der Kernverlust enthält oberhalb einiger MHz auch Kupfer-Zusatzverluste (Skin- und Proximity-Effekt).
- Die Erkennung berücksichtigt nur reale, positive Bezugsimpedanzen. Komplexe Bezugsimpedanzen und Ports mit Massebezug innerhalb der Wicklung (Mittelanzapfungen) gelten als „nicht anwendbar“ bzw. „keine Wicklungen“.
- Die 42 synthetischen CMC-Vorlagen des Experimentalpakets enthalten keine Klasse und keine Physik. Werden sie importiert, greift die Sperre nur über den Namen („CMC“).

## Vorlagen und Pakete

Beim Lernen erhalten Vorlagen drei optionale Felder:
- `category` (aus dem Namen, sonst aus einer eindeutigen Physik),
- `categorySource` (`name` oder `physik`),
- `phys` (Physik-Fingerabdruck: Vierpol L₁, L₂, k, n, tan δ, f_res, Q, Sdd21/Scc21/Sdc21/Scd21 bei 10 kHz … 100 MHz; Zweipol Topologie, L/C/R, f_res, Q, tan δ).

Das Format bleibt `spa-pack` Version 1; ältere App-Versionen ignorieren die Felder. Beim Import werden ungültige `phys`/`category` verworfen, die Vorlage selbst bleibt. Die Karte zeigt zusätzlich „physikalisch ähnlich gelernte“ Bauteile (Abstand im Log-Raum ≤ 0,6), getrennt von der dB-Ähnlichkeit.

## Tests

- `tests/magnetic.unit.mjs`: 35 Prüfungen auf synthetischen SPICE-Netzen, ohne Herstellerdaten:
  - CMC, Doppeldrossel, 1:2-Übertrager, ungekoppelte Spulen, Massenetz,
  - Permutationen und Wickelsinn,
  - Kondensator quer/seriell, Widerstand, Luftspule, Ferritspule, Perle, Eintor,
  - schmales Band, 6-Port, Herstellerwiderspruch, Fingerabdruck, Unveränderlichkeit der Eingabe.
- `tests/magnetic.data.mjs`: 41 Prüfungen auf privaten Herstellerdaten. Der Ordner wird über `SPA_PRIVATE_DATA` angegeben (`dd/`, `mcri/`, `cmc/`, `rfi/`, `lan/`, `libs/dd/WE-DD.lib`, `sim/*.json`); fehlende Ordner werden übersprungen.

```
node tests/magnetic.unit.mjs
SPA_PRIVATE_DATA=/pfad/zu/daten node tests/magnetic.data.mjs
```

Würth-Messungen und -Modelle liegen bewusst **nicht** im Repository und nicht im GitHub-Pages-Bundle. Die Nutzungsrechte sind nicht geklärt.
