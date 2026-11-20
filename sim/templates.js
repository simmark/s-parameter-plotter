'use strict';

// Vorlagen für den Simulator. Jede Vorlage ist eine Textnetzliste.
// Die Bauteilwerte der 10BASE-T1L-Beispiele stammen aus öffentlichen IEEE-Präsentationen
// und sind Startwerte zum Ersetzen, keine Referenzschaltung von Würth Elektronik.

const SIM_TEMPLATES = [
  {
    id: 't1l-we-con',
    name: '10BASE-T1L MDI · WE 74930000 + WE 744235251 (Drossel steckerseitig)',
    text: `.title 10BASE-T1L MDI WE-STST + WE-CNSW
* Übertrager WE-STST 74930000 und Gleichtaktdrossel WE-CNSW 744235251 als Messdaten von
* Würth Elektronik (sim/data/). Mittelanzapfung PHY-seitig über 100 nF an Masse,
* verbundene Mittelanzapfungen leitungsseitig über 75 Ohm + 1 nF an Masse (Bob-Smith).
.standard 10BASE-T1L
.sweep log 100k 20MHz 401

* PHY als Abschluss, je Leiter 50 Ohm gegen Masse
Rphy_p phy_p 0 50
Rphy_n phy_n 0 50

* T1: Knoten in der Reihenfolge der VNA-Ports der Datei
*   P1, P3 = Enden der PHY-Wicklung (Diff 1), P2 = deren Mittelanzapfung
*   P7, P4 = Enden der Leitungswicklung (Diff 2), P5 + P6 = verbundene Mitte
S_T1 phy_p ct phy_n sec_n mid mid sec_p ref=0 file=74930000.s7p
C1 ct 0 100n
R1 mid bs 75
C2 bs 0 1n

* L1: laut Messdaten liegen die Wicklungen zwischen P1–P2 und P3–P4
S_L1 sec_p mdi_p sec_n mdi_n ref=0 file=744235251.s4p

* Messports am MDI: 2 x 50 Ohm, als Paar 100 Ohm differentiell
P1 mdi_p 0 50
P2 mdi_n 0 50
.pair 1 2
`
  },
  {
    id: 't1l-we-phy',
    name: '10BASE-T1L MDI · WE 74930000 + WE 744235251 (Drossel PHY-seitig)',
    text: `.title 10BASE-T1L MDI Drossel PHY-seitig
* Gleiche Bauteile wie in der Vorlage davor, aber die Gleichtaktdrossel sitzt
* zwischen PHY und Übertrager. Zum Vergleich: dort „Als Vergleich merken“, dann diese laden.
.standard 10BASE-T1L
.sweep log 100k 20MHz 401

Rphy_p phy_p 0 50
Rphy_n phy_n 0 50
S_L1 phy_p x_p phy_n x_n ref=0 file=744235251.s4p
S_T1 x_p ct x_n mdi_n mid mid mdi_p ref=0 file=74930000.s7p
C1 ct 0 100n
R1 mid bs 75
C2 bs 0 1n

P1 mdi_p 0 50
P2 mdi_n 0 50
.pair 1 2
`
  },
  {
    id: 'we-cmc-thru',
    name: 'Bauteil · WE 744235251 Durchgang (Sdd21, Scc21)',
    text: `.title WE-CNSW 744235251 Durchgang
* Gleichtaktdrossel allein zwischen zwei Portpaaren: Gegentakt geht durch, Gleichtakt wird gesperrt.
.sweep log 300k 1G 401

S_L1 a_p b_p a_n b_n ref=0 file=744235251.s4p

P1 a_p 0 50
P2 a_n 0 50
P3 b_p 0 50
P4 b_n 0 50
.pair 1 2
.pair 3 4
`
  },
  {
    id: 't1l-mdi',
    name: '10BASE-T1L MDI · Koppel-C + Gleichtaktdrossel',
    text: `.title 10BASE-T1L MDI
* Beispielwerte nach der Messschaltung in graber_3dg_01_01202026 (IEEE 802.3dg):
* Leitungstreiber 2 x 50 Ohm, 2 x 235 nF, Gleichtaktdrossel 470 uH mit 300 nH Streuinduktivität,
* 2 x 100 pF gegen Masse (Schutzbeschaltung). Die Anordnung ist eine Annahme, bitte anpassen.
.standard 10BASE-T1L
.sweep log 100k 20MHz 401

* PHY als Abschluss, je Leiter 50 Ohm gegen Masse
Rphy_p phy_p 0 50
Rphy_n phy_n 0 50

* Koppelkondensatoren
C3 phy_p a_p 235n
C4 phy_n a_n 235n

* Gleichtaktdrossel L1 (steckerseitig). Streuinduktivität differentiell = 2·L·(1−k) = 300 nH
L1a a_p mdi_p 470u
L1b a_n mdi_n 470u
K1 L1a L1b 0.999681

* Kapazität der Schutzbeschaltung am Stecker
Cesd_p mdi_p 0 100p
Cesd_n mdi_n 0 100p

* Messports am MDI: 2 x 50 Ohm, als Paar 100 Ohm differentiell
P1 mdi_p 0 50
P2 mdi_n 0 50
.pair 1 2
`
  },
  {
    id: 't1l-mdi-unsym',
    name: '10BASE-T1L MDI · mit 10 pF Unsymmetrie',
    text: `.title 10BASE-T1L MDI unsymmetrisch
* Wie die Vorlage davor, aber mit 10 pF Unterschied in der Schutzbeschaltung.
* Erst eine Unsymmetrie erzeugt Modenwandlung (Scd11). Mit ideal gleichen Zweigen ist sie rechnerisch null.
.standard 10BASE-T1L
.sweep log 100k 20MHz 401

Rphy_p phy_p 0 50
Rphy_n phy_n 0 50
C3 phy_p a_p 235n
C4 phy_n a_n 235n
L1a a_p mdi_p 470u
L1b a_n mdi_n 470u
K1 L1a L1b 0.999681
Cesd_p mdi_p 0 100p
Cesd_n mdi_n 0 110p

P1 mdi_p 0 50
P2 mdi_n 0 50
.pair 1 2
`
  },
  {
    id: 't1l-pos-con',
    name: '10BASE-T1L · Lagevergleich A: Drossel steckerseitig',
    text: `.title 10BASE-T1L Drossel steckerseitig
* Lagevergleich A: PHY – Koppel-C – Schutzbeschaltung – Gleichtaktdrossel – Stecker.
* Reihenbauteile ohne Abzweig dazwischen sind vertauschbar. Die Lage der Drossel wirkt deshalb nur
* über das, was zwischen Drossel und Koppel-C gegen Masse hängt: hier die Schutzbeschaltung mit
* 10 pF Unsymmetrie. Bei A liegt sie vom Stecker aus gesehen hinter der Drossel.
* Ergebnis mit „Als Vergleich merken“ festhalten, dann Lagevergleich B laden.
.standard 10BASE-T1L
.sweep log 100k 20MHz 401

Rphy_p phy_p 0 50
Rphy_n phy_n 0 50
C3 phy_p a_p 235n
C4 phy_n a_n 235n
Cesd_p a_p 0 100p
Cesd_n a_n 0 110p
L1a a_p mdi_p 470u
L1b a_n mdi_n 470u
K1 L1a L1b 0.999681

P1 mdi_p 0 50
P2 mdi_n 0 50
.pair 1 2
`
  },
  {
    id: 't1l-pos-phy',
    name: '10BASE-T1L · Lagevergleich B: Drossel PHY-seitig',
    text: `.title 10BASE-T1L Drossel PHY-seitig
* Lagevergleich B: PHY – Gleichtaktdrossel – Schutzbeschaltung – Koppel-C – Stecker.
* Gleiche Bauteile wie bei A. Die unsymmetrische Schutzbeschaltung liegt jetzt vom Stecker
* aus gesehen vor der Drossel.
.standard 10BASE-T1L
.sweep log 100k 20MHz 401

Rphy_p phy_p 0 50
Rphy_n phy_n 0 50
L1a phy_p a_p 470u
L1b phy_n a_n 470u
K1 L1a L1b 0.999681
Cesd_p a_p 0 100p
Cesd_n a_n 0 110p
C3 a_p mdi_p 235n
C4 a_n mdi_n 235n

P1 mdi_p 0 50
P2 mdi_n 0 50
.pair 1 2
`
  },
  {
    id: 't1l-mdi-podl',
    name: '10BASE-T1L MDI · mit Speisedrossel (SPoE)',
    text: `.title 10BASE-T1L MDI mit Speisung
* Speisedrossel 2 x 39 uH gekoppelt, differentiell rund 156 uH
* (Werte aus Brychta_3dd_01_03082022, IEEE 802.3dd). Die Versorgung ist für Wechselgrößen Masse.
.standard 10BASE-T1L powered
.sweep log 100k 20MHz 401

Rphy_p phy_p 0 50
Rphy_n phy_n 0 50
C3 phy_p a_p 235n
C4 phy_n a_n 235n
L1a a_p mdi_p 470u
L1b a_n mdi_n 470u
K1 L1a L1b 0.999681

* Speisedrossel L2: Wicklungssinn so, dass sich die Flüsse im Gegentakt addieren
L2a mdi_p 0 39u
L2b 0 mdi_n 39u
K2 L2a L2b 0.99

Cesd_p mdi_p 0 100p
Cesd_n mdi_n 0 100p

P1 mdi_p 0 50
P2 mdi_n 0 50
.pair 1 2
`
  },
  {
    id: 'cmc-block',
    name: 'Touchstone-Block · CMC-Beispiel.s4p zwischen zwei Portpaaren',
    text: `.title CMC als Touchstone-Block
* Zeigt, wie eine Messdatei als Block eingebunden wird. „CMC-Beispiel.s4p“ ist die
* synthetische Beispieldatei des Analyzers (Ports: Eingang +, Ausgang +, Eingang −, Ausgang −).
* Eigene Dateien links laden und den Dateinamen hinter file= eintragen.
.sweep log 100k 100MHz 401

C3 in_p a_p 100n
C4 in_n a_n 100n
S1 a_p out_p a_n out_n ref=0 file=CMC-Beispiel.s4p

P1 in_p 0 50
P2 in_n 0 50
P3 out_p 0 50
P4 out_n 0 50
.pair 1 2
.pair 3 4
`
  },
  {
    id: 'rlc',
    name: 'Test · RLC-Tiefpass (Zweitor)',
    text: `.title RLC-Tiefpass
* Einfache Prüfschaltung für den Rechenkern
.sweep log 100k 100MHz 301

L1 in mid 1u rs=0.05
C1 mid 0 470p
L2 mid out 1u rs=0.05

P1 in 0 50
P2 out 0 50
`
  }
];

// Messdateien, die der Simulator bei Bedarf aus sim/data/ nachlädt (Namen klein geschrieben).
const SIM_LIBRARY = ['744235251.s4p', '74930000.s7p'];

if (typeof module === 'object' && module.exports) { module.exports = SIM_TEMPLATES; module.exports.LIBRARY = SIM_LIBRARY; }
