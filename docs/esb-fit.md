# Vierpol-Fit im ESB-Editor (CMC und Übertrager)

Wie `RF.fitMulti` und seine Helfer arbeiten, und warum. Code: Block `rf-core` in `index.html`. Tests: `tests/rf.reference.mjs` (Abschnitte „Vierpol-Modelle“, „Optimierer“, „Kernglieder“), `tests/e2e/multi-editor.mjs`, `tests/e2e/core-sections.mjs`, Prüfung an echten Daten: `tests/real.data.mjs`.

## Was verglichen wird

- **CMC:** die Impedanzen der vier natürlichen Moden G, V, H, D (aus der Y-Matrix projiziert). Z CM und Z DM nach CISPR 17 eignen sich nicht, weil Cw und Cg darin exakt herausfallen.
- **Übertrager:** Z₁₁, Z₂₂ und Z₂₁ des differentiellen Zweitors und die Kurzschlussimpedanz Z_k = Z₁₁ − Z₁₂Z₂₁/Z₂₂ (nur sie legt Streuung und Wicklungswiderstände fest).

Jeder Punkt wird nach seiner **Auflösbarkeit** gewichtet: Eine Unsicherheit δ ≈ 3·10⁻³·|S| + 10⁻⁴ (etwa 0,03 dB, Annahme) ergibt einen relativen Fehler e der Impedanz (`RF.zError`). Das Gewicht ist 1/(1 + (e/5 %)²). Was die Messung nicht auflöst, lenkt den Fit nicht.

## Residuum

Drei Zeilen je Kurve und Punkt: ln|Z_Modell/Z_Mess|, √½·sin φ und √½·(1 − cos φ), mit φ als Phasendifferenz.

- Für kleine Abweichungen ist das Log-Betrag und Phase, also genau das, was in dB und Grad angezeigt wird.
- Die Phase als Sehne auf dem Einheitskreis hat **keinen Sprung bei ±180°**. Mit der gewickelten Phase entsteht zwischen einer verschobenen Modellresonanz und der gemessenen eine Kante in der Kostenfunktion, an der ein Gradientenverfahren hängen bleibt.
- Der Betragsanteil bleibt unbegrenzt, sodass eine weit entfernte Resonanz das Modell weiter zieht. Eine begrenzte Form (tanh) wurde geprüft und verworfen: Aus schlechten Starts fand sie nicht mehr zurück.
- Die Gewichtssumme ist auf zwei Größen je Kurve und Punkt normiert. Die Zahl der Zeilen verschiebt also nicht das Verhältnis von Daten zu Bindung.

## Kosten

Datenterm + physikalische Vorgaben (C_g, Summe C_wa + C_wx) + **lose Bindung** jedes freien Parameters an einen Mittelpunkt (2·10⁻⁴ je ln²). Die Bindung hält Parameter fest, die die Messung nicht bestimmt. Gemeldet wird `cost` ohne Bindung, also Daten plus Vorgaben. Damit sind Fits mit unterschiedlich vielen Parametern vergleichbar.

## Optimierer (`method`)

| Verfahren | Ablauf | Einsatz |
|---|---|---|
| `robust` (Standard) | Levenberg-Marquardt vom Start, voller Simplex vom Start, LM ab dem Simplex-Ergebnis; das Beste gewinnt | „Optimieren“ |
| `hybrid` | LM, kurzer Simplex ab dort, LM | Startwerte, die schon nahe liegen (Kernglieder 2 und 3) |
| `lm`, `nm` | nur eines der beiden | Vergleich, Tests |

LM konvergiert in wenigen Dutzend Auswertungen, bleibt aber im Tal, in dem es startet: Eine scharfe Resonanz neben der gemessenen ist so ein Tal. Der Simplex sucht breiter, konvergiert aber langsam und ungenau. Die Kombination ist in allen Testfällen mindestens so gut wie das bessere Einzelverfahren.

**Proximale Nachiteration:** Die Bindung zieht auch gut bestimmte Werte etwas zum Start. Bei sauberen Daten lag R_Fe so 8 % daneben, obwohl die Messung es auf ±0,4 % festlegt. Nach dem Fit wird die Bindung deshalb auf das letzte Ergebnis neu zentriert und LM erneut gestartet, bis zu viermal. Bestimmte Werte laufen so ins echte Optimum (synthetisch jetzt < 0,01 %). Unbestimmte bleiben stehen, weil ihre Richtung flach ist.

Lange Fits laufen in einem **Web Worker** (`rfJob`), der aus dem `rf-core`-Quelltext gebaut wird. Die Seite bleibt bedienbar, das Editorfeld trägt währenddessen `data-busy`. Ohne Worker läuft die Rechnung wie früher auf der Seite.

## Bestimmtheit und automatisches Festhalten

- `RF.multiSpread`: Aus der Jacobi-Matrix J (nach ln p) ergibt (JᵀWJ)⁻¹, wie weit sich ein Parameter bewegen kann, während die übrigen ausgleichen. Der Maßstab ist die Reststreuung, mindestens 1 %. Das ist ein Richtwert, kein Vertrauensintervall: Nachbarpunkte sind nicht unabhängig, und der Modellfehler ist systematisch. Stufen: gut ≤ ±10 %, schwach ≤ ±100 %, sonst nicht bestimmt.
- `RF.fitMultiHeld`: Erst ein freier Fit. Dann geht der jeweils am schlechtesten bestimmte Parameter auf seinen Startwert zurück und wird festgehalten, die übrigen werden neu beurteilt; danach wird neu optimiert.
- **Gegenprobe:** Wird der Fit mit festgehaltenen Werten um mehr als 5 % + 0,002 dB schlechter, gilt der freie Fit. Die Werte werden dann als „schwach bestimmt, aber nötig“ gemeldet.
- Werte, die der Fit unter ein Zehntel des Startwerts drückt, gelten als „klein“, nicht als unbestimmt.

## Kernglieder der CMC

Jedes Glied 2M ∥ R ist eine Debye-Relaxation der komplexen Kerninduktivität: Z_Kern/(j2ω) = Σ M_k/(1 + jωτ_k) mit τ_k = 2M_k/R_k.

- **Freistellen aus der Messung** (`RF.coreRelaxation`): Z_Kern = 2/(y_H − jωC_H) − 2/(y_D − jωC_D). Genutzt werden nur Punkte, an denen H aufgelöst ist und die Kapazität noch nicht dominiert.
- **Verteilung der Relaxationszeiten:** nichtnegative kleinste Quadrate auf einem τ-Raster (48 Punkte, eine Dekade über das Band hinaus). Benachbarte belegte Rasterpunkte bilden Gruppen.
- **Startwerte** (`RF.cmcCoreStart`): die stärksten Gruppen. Gibt es weniger Gruppen als Glieder, wird die größte geteilt (τ ×3 und ÷3); gibt es mehr, werden die schwächsten in das nächstgelegene Glied gelegt. Glied 1 ist das größte.
- **Anzahl prüfen** (`RF.cmcSectionOrder`): 1, 2 und 3 Glieder werden gefittet. Ein weiteres Glied zählt nur, wenn es die Kosten um mindestens 10 % senkt und eigenständig bleibt: τ mindestens Faktor 2 von jedem anderen entfernt, mindestens 1 % der Induktivität. Sonst teilt der Fit nur eine Relaxation auf.

**Befund an der WE-CMB 744823601:** Die Messung trägt **ein** Kernglied. Zwei oder drei Glieder fallen auf dieselbe Zeitkonstante zusammen (1,124 dB bei jeder Anzahl). Auch eine verbreiterte Relaxation (Cole-Cole) läuft auf α = 1 zurück. Ein resonantes Glied (Kapazität parallel zum Kern) bringt im vollen Modell nichts, weil das Kapazitätsnetz Ct, Cw, Cx, Cg es schon abbildet.

Der verbleibende Gleichtaktfehler (−2,8 dB bei 0,4–1 MHz, +2,4 dB bei 10 MHz) liegt dort, wo |Z_H| mit 5–6 kΩ gegen 50 Ω nur schwach aufgelöst ist (Gewicht 0,2–0,35). Er ist zum großen Teil eine Grenze der Messung, kein fehlendes Modellelement.

## R_σ und R_w

- **R_σ** parallel zu Lσ beschreibt die Verluste im Gegentaktpfad. An der WE-CMB senkt es den Gegentaktfehler von 2,3 auf 0,23 dB.
- **R_w** ist der gesamte Serienwiderstand, den die Messung zeigt. An der WE-CMB sind das ~0,5 Ω bei R_DC ≤ 13 mΩ laut Datenblatt; der Rest stammt aus der Messanordnung. Für ein Bauteilmodell den Datenblattwert eintragen und festhalten.

## Offene Punkte

- Übertrager-Fit auf den natürlichen Moden des Vierpols statt auf Z₁₁, Z₂₂, Z₂₁ und Z_k. Die Aufteilung C_p/Cwa/Cwx ist an der WE-LAN 7490140122B nicht bestimmt.
- Kernglieder gibt es nur bei der CMC, nicht beim Übertrager (L_m ∥ R_Fe).
- δ = 0,03 dB ist eine Annahme. Eine Angabe der Messunsicherheit pro Datei würde die Gewichte belastbarer machen.
