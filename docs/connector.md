# Connector Studio (Phase 1)

Steckverbinder- und Magnetics-Profile, Portzuordnung mit ausgewiesener Unsicherheit und Übernahme in die Analyse.
Code: Block `connector-core` in `index.html` (ohne DOM, in Node testbar), Oberfläche: Tab **Connector** (Funktionen `cn…` im Hauptskript).
Tests: `tests/connector.mjs` (Kern, 47 Prüfungen), `tests/e2e/connector.mjs` (Browser, 47), `tests/e2e/i18n.mjs` (Englisch), `tests/real.data.mjs` (echte Daten, nicht im Repository).

## Datenmodell

| Begriff | Bedeutung | Beispiel |
|---|---|---|
| Kontakt | physischer Pin von Steckverbinder oder Bauteil | USB-C `A2`, RJ45 `3`, Übertrager `P1CT` |
| Knoten | ein elektrisches Ende eines Kontakts in der Messung | `A2@1` (Seite 1), `A2@2` (Seite 2); bei Bauteilen = Kontakt |
| Messport | eine Spalte der S-Matrix | P17 |
| Kanal | logischer Signalweg aus Kontakten | Lane TX1 von Seite 1 nach Seite 2; Übertragerkanal 1 primär → sekundär |
| Modalport | D- oder C-Mode eines Paares an einem Ende | entsteht in der Analyse aus den Paaren der Zuordnung |

Ein sichtbarer Kontakt ist also nie automatisch ein Messport: Erst die **Zuordnung** (Port → Knoten) verbindet beides. Angewendet erzeugt sie die bestehende Portkonfiguration der Analyse (Paare und Abschlüsse). Der RF-Kern bleibt unverändert, die Messdaten werden nie verändert.

## Profilformat (`simonlation.connector-profile`, Version 1)

```
{ schema, version, id, revision, status: 'validated',
  family, name, variant, gender: 'receptacle' | 'plug' | 'device', view,
  contacts: [{ id, label, normative, role, x, y, en? }],      // role: ground, power, config, sideband, usb2, superspeed, signal, tap
  pairs: [{ id, plus, minus, name, group, channel?, side?, en? }],
  nets: [{ id, contacts, note }],                               // mögliche interne Verbindungen, nie angenommen
  measurement: { kind: 'thru' | 'pins', sides?, sideNames?, note, en? },
  configurations: [{ id, name, pairs, note?, en? }],            // z. B. USB 3.2 Gen 2×2, 1000BASE-T
  symmetries: [{ id, name, map }],                              // Umbenennungen, die die Geometrie erhalten
  sources: [{ title, ref, note, en? }],
  en: { name, view, family, variant } }                          // englische Texte; Deutsch ist Quellsprache
```

`Connector.validateProfile` prüft Vollständigkeit (Quellen, Positionen, Paare, Konfigurationen) und ob jede Symmetrie eine Permutation der Kontakte ist. Nur geprüfte Profile werden angeboten.

| Profil | Messports | Quelle |
|---|---|---|
| `usb-c-receptacle-thru` | 48 (24 Kontakte × 2 Seiten) | USB Type-C Cable and Connector Specification R2.4 (Okt. 2024), 3.2.3; USB 3.2 Specification (Betriebsarten) |
| `rj45-8p8c-thru` | 16 (8 × 2) | IEEE 802.3, 40.8 (MDI, Tabelle 40-12), Klauseln 14 und 25 |
| `lan-magnetics-4p` / `-6p` / `-12p` | 4 / 6 / 12 | Messmodell-Vorlage (keine Norm); Topologie wird aus den Daten geprüft |

Normative Namen (SSTXp1, Dp1, BI_DA+) und informelle Kurznamen (TX1+, D+) stehen getrennt (`normative`, `label`).

## Port-Zuordnung (`simonlation.port-map`, Version 1)

`{ schema, version, profile: { id, revision }, ports, map: [Knoten | null], name, created }`. Beim Import werden unbekannte Knoten verworfen, fremde Schemata und unbekannte Profile abgelehnt. Vorlagen liegen im Speicher der App (Meta-Eintrag `connector-maps`, höchstens 50) oder als JSON-Datei.

## Automatische Zuordnung

Eingaben nur aus der Datei: Portnamen (`! Port[k] = …`) und die komplexe S-Matrix. Ausgabe: bewertete Kandidaten, je mit Kategorie, Einzelwerten und den aus den Daten gleichwertigen Alternativen.

**Durchgangsmessung (USB-C, RJ45)**

1. **Portnamen:** Kontakt-IDs (`A2`, `B11`) oder eindeutige Signalnamen plus Seitenangabe (`_S1`, `near`, `in` …).
2. **Durchgänge:** mittleres |S_ij| im unteren Fünftel des Frequenzbands (log). Gegenseitig beste Partner bilden einen Leiter; eindeutig, wenn |S| > 0,5 und mindestens doppelt so groß wie der nächste Kandidat.
3. **Orientierung:** Ob zwei Leiterenden auf derselben Seite liegen, folgt aus der Kopplung: Nahenden koppeln anders als Fernenden. Für Nachbarleiter u, v wird *same* = |S(a_u,a_v)| + |S(b_u,b_v)| mit *cross* = |S(a_u,b_v)| + |S(b_u,a_v)| verglichen; ein maximaler Spannbaum über |ln(same/cross)| legt die relative Orientierung fest.
4. **Konventionen** als Hypothesen: Ports 1–24 Seite 1 in Kontaktreihenfolge (A1…A12, B1…B12), 25–48 Seite 2; abwechselnd; Seite 2 umgekehrt.
5. **Datengetriebene Platzierung:** Die Leiter werden so auf Kontakte gelegt, dass Σ Kopplung × Nachbarschaft maximal wird (simuliertes Abkühlen, deterministische Neustarts). Die Nachbarschaft (1/d², d < 2,2 Teilungen) ist nur ein Rangmaß, keine Messgröße.
6. **Bewertung:** Durchgänge (Anteil der Kontakte, deren zwei Seiten ein eindeutiger Leiter sind; leere Kontakte zählen als unbestätigt), Nachbarkopplung (Korrelation r), Seiten (Anteil konsistenter Nah/Fern-Paare), Portnamen. Portnamen werden zusätzlich gegen das erreichbare Optimum der Platzierung geprüft: Liegen sie messbar darunter (> 0,3 %), gelten sie als widersprüchlich.
7. **Symmetrien:** Jede Profilsymmetrie und der Seitentausch werden auf den Kandidaten angewendet. Bleiben alle Werte gleich, ist die Alternative **aus der S-Matrix nicht unterscheidbar** und wird so angezeigt.

| Kategorie | Bedingung |
|---|---|
| Eindeutig zugeordnet | alle Ports benannt, Namen stimmen mit allen Durchgängen, Nachbarkopplung und Seiten überein und liegen nicht unter dem Optimum |
| Wahrscheinlich zugeordnet | Konvention oder Namen, durch ≥ 90 % Durchgänge, r > 0,3 und > 90 % Seiten gestützt; Orientierung/Seiten folgen aus Konvention, nicht aus der Messung |
| Mehrere mögliche Zuordnungen | nur die Messdaten tragen die Zuordnung; symmetrische Bilder sind gleichwertig |
| Nicht zuverlässig bestimmbar | weniger als 90 % Durchgänge oder Widerspruch zur Messung |

Eine unsichere Zuordnung wird nie als sicher übernommen. Nicht bestätigte Kontakte werden namentlich genannt.

**Magnetics (Pins, kein Seitenmodell)**

1. **Galvanische Gruppen:** Innerhalb einer Wicklung steigt |S_ij| zu tiefen Frequenzen (die Wicklung wird zum Kurzschluss), über die Isolation fällt es (∝ ω). Paare mit |S| > 0,3 und einer Steigung d ln|S| / d ln f < 0,25 in den untersten Punkten gehören zusammen.
2. **Mittelanzapfung:** in einer Dreiergruppe der Anschluss mit der stärksten Verbindung zu beiden anderen.
3. **Kanäle:** Primär- und Sekundärgruppe werden über die stärkste Differenzübertragung in Bandmitte gepaart.
4. **Polarität:** Die Sekundärseite wird so benannt, dass Re SDD21 > 0 ist (Punktkonvention aus der Messung). Welche Seite „primär“ heißt und welcher Primäranschluss „+“ ist, folgt aus der Portreihenfolge; Kategorie daher höchstens „wahrscheinlich“, außer alle Namen bestätigen es.

An der WE-LAN 7490140122B (echte Messung, nicht im Repository) ergibt das ohne Herstellerkopf: Anzapfungen Pin 2/11, gleichsinnig Pin 1 ↔ Pin 12, identisch mit Datenblatt und Herstellerkopf.

## Übernahme und Auswertung

- Gewählte Paare werden Mixed-Mode-Paare, je Seite ein Paar. Übrige Ports: angepasst (Bezugsimpedanz), offen oder aktiv; Mittelanzapfungen getrennt wählbar (Standard offen).
- **Kanäle:** SDD21, SDD11, SCD21 je Kanal am Marker 1, Knopf „Kurven“ öffnet SDD21/SDD11/SDD22/SCD21.
- **Matrix:** |S| aller D-Moden (optional auch C) bei wählbarer Frequenz. Bezeichnungen aus der Zuordnung, nicht aus Portnummern: gleicher Kanal von Ende zu Ende = IL; zwischen Kanälen am selben Ende = NEXT, am anderen Ende = FEXT; D↔C = Konversion. Klick öffnet die Kurve.
- Keine Grenzwerte und keine Konformitätsaussage: Dafür fehlen Normversion, Messbedingungen und Definition.

## Grenzen (Stand Phase 1)

- Durchgangsmodell nur für Messungen mit einem Port je Kontakt und Seite. Abgeschlossene oder gebrückte Kontakte (z. B. GND intern verbunden) werden nicht automatisch erkannt; sie erscheinen als unbestätigt.
- Aus der S-Matrix allein ist die Steckorientierung (A↔B), die Spiegelung und der Seitentausch eines symmetrischen Steckverbinders grundsätzlich nicht bestimmbar. Die App zeigt das an; Namen in der Datei oder eine Vorlage lösen es auf.
- Die Platzierung nutzt eine schematische Geometrie. Bei Steckverbindern, deren Kopplung stark von der Geometrie abweicht (Schirmbleche), kann sie danebenliegen; die Kategorie bleibt dann „mehrere mögliche“.
- Skew, Gruppenlaufzeit je Lane, Power-Sum-Crosstalk und Zeitbereich sind noch nicht im Connector-Tab (Phase 2/5).
- Drag & Drop von Ports auf Pins ist als Klick-Auswahl umgesetzt (Kontakt wählen → Port zuweisen, auch per Tastatur); echtes Ziehen fehlt.
