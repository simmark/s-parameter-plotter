# Speicher: Sitzung, Bibliothek, Import

Stand: Version 8. Der Speicherkern steht in `index.html` im Block `<script id="store-core">` (`Zip` und `Store`). Er greift nicht auf die Oberfläche zu und lässt sich deshalb später unverändert in einer Desktop-Hülle (z. B. Electron) verwenden.

## Entscheidung

| Was | Wo | Warum |
|---|---|---|
| Dateiinhalte | OPFS, Ordner `inhalt/`, eine Datei je SHA-256 | Große Dateien ohne Umweg über IndexedDB; `createWritable()` schreibt in eine Auslagerungsdatei und ersetzt erst bei `close()`, ein abgebrochener Schreibvorgang hinterlässt also keine halbe Datei |
| Dateiinhalte ohne OPFS | IndexedDB, Tabelle `blobs` | Ersatz für Browser ohne OPFS oder ohne `createWritable()` |
| Metadaten | IndexedDB `s-parameter-analyzer` Version 2: `entries`, `imports`, `libraries`, `meta` | Transaktionen: mehrere Einträge werden gemeinsam oder gar nicht geschrieben |
| Kleine Einstellungen | `localStorage` (Sprache, Design, Vorlagen, Kurvenwahl) | Unverändert aus den Vorversionen |

Ein Eintrag (`entries`) verweist über den Hash auf seinen Inhalt. Sitzung (`scope: 'session'`) und Bibliotheken (`scope: 'library'`, `libId`) nutzen dieselbe Ablage. Eine Datei, die in Sitzung und Bibliothek liegt, belegt den Platz nur einmal. Ein Inhalt wird erst gelöscht, wenn kein Eintrag mehr auf ihn zeigt.

## Import in sieben Schritten

1. **Vorbereiten:** Importsatz mit Zustand `pending` anlegen, freien Speicher schätzen.
2. **Archiv prüfen:** Inhaltsverzeichnis lesen, Pfade prüfen, Grenzen anwenden.
3. **Lesen und validieren:** je Datei entpacken, CRC vergleichen, Größe prüfen.
4. **Inhalt schreiben:** nach SHA-256 in die Ablage.
5. **Prüfen:** jede Datei zurücklesen, Länge und Hash vergleichen.
6. **Konflikte klären:** gleicher Ort, anderer Inhalt → Überspringen, Ersetzen oder Umbenennen.
7. **Abschluss:** eine einzige IndexedDB-Transaktion schreibt alle Einträge und setzt den Importsatz auf `committed`.

Vor Schritt 7 ist nichts sichtbar. Endet die App vorher, findet der nächste Start einen Importsatz im Zustand `pending`, meldet ihn und entfernt die Inhalte, auf die kein Eintrag zeigt. Importe laufen nacheinander (Web Lock `spa-store`), auch über mehrere Tabs.

## Grenzen

- 100 MiB je Datei, 2 GiB entpackt je Archiv, 20 000 Einträge je Archiv, 1000 Dateien je Sitzung.
- ZIP-Kompression: gespeichert und Deflate. Andere Verfahren und verschlüsselte Einträge werden je Datei gemeldet.
- Mehrteilige Archive werden abgelehnt.
- Die Sicherung ist ein ZIP ohne Kompression und ohne ZIP64, also höchstens 4 GiB.

## Was der Browser nicht garantiert

Browserspeicher gehört dem Browser. Er geht verloren, wenn der Anwender Browser- oder Websitedaten löscht, die App deinstalliert, im privaten Modus arbeitet oder der Browser bei Platzmangel aufräumt. Persistente Speicherung (`navigator.storage.persist()`) senkt das letzte Risiko; ob sie gewährt ist, steht unter „Speicher & Sicherung“. Die App fordert sie beim Übernehmen in die Bibliothek an. Safari löscht Daten von Websites, die sieben Tage nicht besucht wurden, sofern die App nicht zum Home-Bildschirm hinzugefügt ist. Gegen all das hilft nur die Sicherung außerhalb des Browsers.

## Migration von Version 1

- IndexedDB-Tabelle `files` („Zuletzt geöffnet“, höchstens 6 Dateien) → Sitzung, samt gespeicherter Portzuordnung. Die alte Tabelle bleibt unverändert stehen.
- OPFS-Ordner `bibliothek/<Ordner>/<Datei>` → Bibliothek „Bibliothek“. Der alte Ordner wird erst entfernt, nachdem jede Datei im neuen Speicher geprüft ist.
- Beides läuft einmal beim ersten Start und wird bei einem Fehler beim nächsten Start wiederholt.

Die Datenbank trägt jetzt Version 2. Eine ältere App-Fassung kann sie nicht mehr öffnen; ein Zurückrollen auf Version 7 zeigt die Dateien deshalb nicht an, löscht sie aber auch nicht.
