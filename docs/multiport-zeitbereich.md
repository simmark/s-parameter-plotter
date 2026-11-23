# Multiport, 0/α/β-Moden, Zeitbereich und Augendiagramm (Version 10)

Phasen 2, 3, 5 und 6 des SIMONLATION-Auftrags. Phase 4 (Filter & EMV Studio) ist bewusst nicht enthalten.

## Port-Map-Datei (Sidecar)

- Format: `simonlation.portmap.v1` oder `simonlation.synthetic-portmap.v1`. Je Port `port` (lückenlos 1…N), `pin`, `signal`, `side` und `role`, dazu `differential_pairs` mit `pair`, `side`, `positive_port` und `negative_port`.
- Daraus entsteht ein Profil mit einem Anschluss je Port (`file:<model>`) und die Zuordnung der Datei, Quelle „Port-Map-Datei“. Texte aus der Datei werden von `< > & " '` befreit und gekürzt. Eingebaute Profile lassen sich nicht überschreiben.
- Das Profil wird in den Einstellungen der Datei gespeichert und beim Öffnen geprüft (`validateProfile`), bevor es registriert wird.
- Nichts in der Datei gilt als gemessen. Die **Kanalprüfung** vergleicht sie mit der S-Matrix:
  - Je Kanal (gleicher Paarname an verschiedenen Seiten) wird SDD21 zwischen den Enden gebildet.
  - Liegt |SDD21| nirgends über 0,1, gilt der Kanal als „kein Durchgang“.
  - **Polarität (seit Version 12):** Eine Phase beweist das Vorzeichen nur, wenn die Laufzeit begrenzt ist; sonst kann 0° auch 360° sein. Ohne Phasenbezug bleibt die Polarität deshalb **„unbestimmt“**. Die Port-Map kann einen Bezug angeben: `polarityReference: { source, maxDelaySeconds, maxFrequencyHz, response: "noninverting-baseband" }`. Bewertet wird dann ein Punkt mit |SDD21| ≥ 90 % des Maximums, an dem die größte mögliche Laufzeit höchstens 30° Phase ergibt: bis ±60° richtig gepolt, ab ±120° vertauscht, dazwischen offen. Die Quelle des Bezugs steht in der Tabelle. Ein unvollständiger Bezug wird abgelehnt.
  - Weitere Felder seit Version 12: `paths` (Signalwege von Paar zu Paar, für Übersprechen und Kanalprüfung), `connectorGender` je Seite (`plug` oder `receptacle`, für die Ansicht der Steckseite). Eine Port-Map, deren Profil unter derselben Kennung schon mit anderem Inhalt geladen ist, wird abgelehnt („Konflikt“). Eine Vorlage mit unbekannten Knoten wird ganz abgelehnt statt teilweise übernommen.
  - Paare ohne Partner gleichen Namens (Fan-out, Übertrager PRI/SEC) werden mit dem Paar eines früheren Endes verknüpft, zu dem |SDD21| über −10 dB liegt. Solche Verknüpfungen sind als „aus der Messung“ markiert.

## Automatische Zuordnung: zwei Korrekturen

- **Portnamen mit Seitenfeld:** Namen wie `LEFT | A1 | GND | ground` werden verstanden. Hat das erste Feld genau zwei Werte, die je die Hälfte der Ports belegen, sind das die beiden Seiten in der Reihenfolge ihres Auftretens. Dazu kommen die Schlüsselwörter LEFT/RIGHT und LINKS/RECHTS.
- **Keine Annahme NEXT > FEXT bei der Bewertung:**
  - Die Seitenkonsistenz prüft nur noch, ob alle Nachbarn dieselbe Richtung zeigen.
  - Die Zielfunktion nimmt je Nachbarpaar die stärkere der beiden Kopplungen (gleiches Ende oder gegenüberliegendes Ende).
  - Nur die rein datengetriebene Platzierung braucht für die Lage der Leiterenden weiterhin diese Annahme; das steht in den Hinweisen.
- **Teilweise verbundene Dateien:** Wenn alle Ports Namen tragen und kein eindeutiger Durchgang ihnen widerspricht, ist die Zuordnung „wahrscheinlich“ (z. B. USB2-Kabel mit offenen SuperSpeed-Kontakten). Die Kontakte ohne Durchgang werden aufgezählt.

## Phase 2: Übersprechen, Laufzeit, Skew

Die Werte stammen aus der Mixed-Mode-Matrix der übernommenen Zuordnung. Opfer ist Kanal v mit den Enden a (1) und b (2); Störer sind alle anderen Kanäle k.

| Größe | Definition |
|---|---|
| PSNEXT Ende 1 | 10·lg Σ_k \|S(D_v@1, D_k@1)\|² |
| PSNEXT Ende 2 | 10·lg Σ_k \|S(D_v@2, D_k@2)\|² |
| PSFEXT | 10·lg Σ_k \|S(D_v@2, D_k@1)\|² |
| Laufzeit | Median der Gruppenlaufzeit τ = −dφ/dω von SDD21, wo \|SDD21\| > −6 dB |
| Lane | Laufzeit minus Mittel aller Kanäle |
| Skew im Paar | Median von τ(S b+←a+) − τ(S b−←a−), wo beide \|S\| > 0,3 |
| Konversion | \|SCD21\| |

Es gibt keine Grenzwerte und keine Pass/Fail-Aussage.

## Phasenentfaltung

- Standard ist der Schritt, der am nächsten an null liegt.
- Wenn die drei letzten Laufzeitschätzungen positiv sind und innerhalb von 10 % übereinstimmen und der vorhergesagte Schritt über 90° liegt, wird der Schritt gewählt, der der Vorhersage −τ·Δω am nächsten kommt („geführt“).
- Das ist eine Annahme einer glatten Laufzeit. Die App meldet sie jedes Mal, wenn sie greift.
- Filterflanken (z. B. ein Hochpass) liefern keine übereinstimmenden Schätzungen und werden nicht geführt.

## Phase 3: Dreileitergruppen 0/α/β

- Leistungsinvariante Clarke-Transformation, orthonormal:
  - V₀ = (V₁+V₂+V₃)/√3
  - Vα = (2V₁−V₂−V₃)/√6
  - Vβ = (V₂−V₃)/√2
- Sie wirkt direkt auf die Wellen, S_m = T·S·Tᵀ. Jede Mode behält die Portreferenz. Bei ungleichen Referenzen der drei Ports wird vorher auf das geometrische Mittel renormiert (Hinweis wie bei Paaren).
- Die Moden heißen intern Z (0), A (α) und B (β); Kurven: S00·21, Sαα·21, Sββ·21, Sα0·21 usw.
- Ein Port kann nicht zugleich in einem Paar und einer Gruppe sein. Eine Gruppe, deren Port anders belegt wird, wird mit Hinweis aufgelöst.
- Touchstone kennt diese Moden nicht, deshalb wird der Export der 0/α/β-Basis abgelehnt.

## Phase 5: Zeitbereich

1. Magnitude und entfaltete Phase werden linear in f auf ein gleichmäßiges Raster 0…f_max mit 4096 Punkten interpoliert.
2. Unterhalb des ersten Messpunkts wird die Magnitude gehalten und die Phase mit der Laufzeit der beiden tiefsten Punkte extrapoliert. Der Gleichanteil ist reell, sein Vorzeichen folgt aus der extrapolierten Phase (nahe 0 oder π). Weicht sie stark davon ab, erscheint ein Hinweis.
3. Fenster (Hann, Kaiser β = 6 oder Rechteck), optional mit Gauß-Flanke: |H| = exp(−ln2/2·(f/f₃)²) mit f₃ = 0,3394/t_r.
4. Hermitesche Ergänzung, Nullauffüllung ×4, inverse FFT. Vor t = 0 liegt ein Achtel des Fensters, die Sprungantwort ist das Trapezintegral der Impulsantwort.
5. TDR: Z = Z₀·(1+ρ)/(1−ρ) aus der Sprungantwort der Reflexion, Z₀ = Referenz der Mode (100 Ω für D bei 50-Ω-Ports).

Hinweise erscheinen bei logarithmischer oder ungleichmäßiger Abtastung, unter 201 Punkten, bei geführter Entfaltung und bei unsicherem Gleichanteil.

## Phase 6: Augendiagramm

- NRZ mit ±A und einem periodischen PRBS-Muster (7, 9, 11; LFSR x⁷+x⁶+1, x⁹+x⁵+1, x¹¹+x⁹+1).
- Das Signal entsteht durch Überlagerung der Pulsantwort p(t) = s(t) − s(t − UI). Sie wird abgeschnitten, wo sie unter 10⁻⁴ des Maximums fällt, und periodisch gefaltet; das ist der eingeschwungene Zustand.
- Kennwerte:
  - Augenhöhe: innere Öffnung, tiefste „1“ minus höchste „0“, am besten Abtastzeitpunkt (32 Phasen je UI). Bei Gleichstand gewinnt die Phase nächst der Pulsmitte.
  - Augenbreite: Anteil der Phasen mit offener Öffnung.
  - Peak-Distortion: 2A·(Hauptcursor − Σ|ISI|), der schlechteste Fall über alle Muster.
- Ohne Jitter, Rauschen, Entzerrung und Maske. Das ist keine Normbewertung.

## Rechen-Worker

- Netzwerk (alle Frequenzpunkte), Übersprechen der übernommenen Kanäle und Augendiagramm laufen in einem Web Worker. Er wird aus denselben Skriptblöcken gebaut (rf-core, td-core, connector-core), die Ergebnisse sind deshalb zeichengleich mit der Berechnung auf der Seite.
- Ein Datensatz wird einmal an den Worker geschickt; er behält die letzten drei.
- Je Bahn (aktuelle Datei, Vergleich) beendet ein neuer Auftrag den älteren an dessen nächster Pause (alle 40 ms).
- Ergebnisse kommen gebündelt als ein Puffer je Basis zurück, nicht als Tausende Einzelmatrizen.
- Startet der Worker nicht oder fällt er aus, rechnet die Seite wie bisher. `window.SPA_NO_WORKER = true` erzwingt das, `window.SPA_COMPUTE_STATS()` zeigt lokal, wo gerechnet wurde.
- Die Port-Tabelle im Connector-Tab legt ihre Auswahllisten (bis 64 × 65 Einträge) erst bei Benutzung oder im Leerlauf an. Die Kanalprüfung wird je Datei, Profil und Zuordnung zwischengespeichert.

Gemessen in Chrome bei 6-fach gedrosselter CPU, 48 Ports mit 10 Paaren (Übernehmen einer Zuordnung bis zur fertigen Übersprechen-Karte):

| Datei | Worker | Seite (vor dieser Änderung) |
|---|---|---|
| 201 Punkte | längste Blockade 160–240 ms, fertig nach 0,7–1,0 s | 180–270 ms, 0,7–0,9 s |
| 1005 Punkte (73 MB) | längste Blockade 192 ms, Summe 471 ms, fertig nach 0,8 s | 297 ms, Summe 774 ms, 1,4 s |

Bei wenigen Punkten bestimmt das Zeichnen der Seite (Layout, Paint) die Blockade, nicht die Rechnung; dort bringt der Worker kaum etwas. Sein Nutzen wächst mit der Punktzahl. Die verbleibende Blockade ist das Neuzeichnen des Connector-Tabs.

## Prüfungen

| Test | Inhalt |
|---|---|
| `tests/multiport.mjs` (30) | 3-Phasen-Drossel analytisch: Nullsystem R + jω(L+2M), Leitermoden R + jω(L−M), keine Konversion. Rücktransformation einer bekannten Modalmatrix, Export-Sperre. Port-Map, Polarität vertauscht, Paar auf falschen Kontakten, Verknüpfung über die Messung. Seitenfeld in Portnamen, Modell mit FEXT > NEXT. PSNEXT/PSFEXT unabhängig aus der Fixture-Matrix, Skew einer verlängerten Minusleitung gegen √(LC). |
| `tests/timedomain.mjs` (22) | Leitung 0,4 ns auf 41 log-Punkten (einfache Entfaltung scheitert, geführte nicht), Hochpass ohne Führung, RC-Sprung, Gauß-Flanke, TDR 75 Ω und Kurzschluss, Vorzeichen des Gleichanteils. Auge: idealer Kanal, Leitung, RC gegen Peak-Distortion und analytisch 2A·(1 − 2e^(−T/τ)) bei 800 GHz Bandbreite. PRBS-Vollständigkeit, Laufzeit. |
| `tests/pack.mjs` (11, mit `SPA_PACK`) | 21 Dateien des synthetischen Testpakets: Parser, vollständige Mixed-Mode-Matrix gegen NumPy (≤ 7·10⁻¹¹), Zuordnung USB-C/RJ45, alle Port-Maps und 53 Kanäle, Fan-out Typ A → C, 3-Phasen-CMC, Referenzlaufzeit. |
| `tests/e2e/worker.mjs` (10) | Worker wird benutzt; Übersprechen, Matrix, Kurvenwerte und Auge zeichengleich mit `SPA_NO_WORKER`; Blockade unter 1 s bei 6× gedrosselter CPU; nicht startbarer Worker → Seite rechnet, gleiche Ergebnisse. |
| `tests/e2e/phases.mjs` (40) | Browser: Port-Map laden, falsche Polarität, Übersprechen-Karte, Dreileitergruppen, Zeitbereich, TDR, Flanke, Auge, Neuladen, Englisch, Handy. |

## Hinweise zum Testpaket (2026-11-20)

- Bei N ≥ 3 Ports schreibt das Paket die Matrix spaltenweise (S11, S21, …). Touchstone 1.x erwartet für N ≥ 3 zeilenweise Reihenfolge (S11, S12, …). Weil alle Dateien reziprok sind (S = Sᵀ bis 10⁻¹⁰), ist das Ergebnis identisch.
- Aus demselben Grund (Reziprozität) kann das Paket keine Transpositionsfehler aufdecken, anders als es die QUICK_TESTS nahelegen. Dafür wäre eine nicht reziproke Datei nötig.
- Die Zeilenumbrüche halten sich nicht an „neue Zeile je Matrixzeile“. Die App liest die Daten tokenweise und ist davon nicht betroffen.
- In der synthetischen USB-C-Datei koppeln die Kontakte als Kette in Listenreihenfolge (A1…A12, B1…B12), nicht nach der Geometrie der Buchse. Die Nachbarkopplung passt deshalb nicht exakt zur Profilgeometrie; Namen und Durchgänge entscheiden.

## Grenzen

- Echte Messungen von USB-C-, RJ45- und HDMI-Steckverbindern und Messungen mit dichter, linearer Abtastung für TDR fehlen noch. Alle Prüfungen nutzen synthetische oder analytische Daten.
- Die Laufzeit bei dünner Abtastung beruht auf der Annahme einer glatten Laufzeit; das ist markiert.
- Für das Auge gibt es keinen Jitter, kein Rauschen, keine CTLE/DFE und keine Masken, weil Normmasken eine geklärte Quelle brauchen.
- Die 0/α/β-Basis ist für symmetrische Drei-Leiter-Systeme gedacht. Bei unsymmetrischen Systemen zeigt die Konversion, wie stark die Modi koppeln; eine Eigenmodenzerlegung ist das nicht.
- Gemessen wird die Reaktionsfähigkeit nur mit gedrosselter Desktop-CPU (6×), nicht auf einem echten Handy.
