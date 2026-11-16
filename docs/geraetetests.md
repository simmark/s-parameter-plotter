# Gerätetests von Hand

Die automatischen Tests laufen in Chrome für Desktop mit emuliertem Handy-Format und echten Touch-Ereignissen über das DevTools-Protokoll. Das ersetzt kein Gerät. Die folgenden Punkte sind **nicht automatisch geprüft** und müssen vor einer Freigabe an echten Geräten durchgegangen werden.

## Android (Chrome, installierte App)

| Nr. | Schritt | Erwartung |
|---|---|---|
| A1 | ZIP mit 100 Dateien über „ZIP importieren“ wählen | Fortschritt läuft, am Ende „100 Dateien dauerhaft gespeichert“ |
| A2 | Seite nach unten ziehen (Pull-to-Refresh) | Alle 100 Dateien, dieselbe Datei, derselbe Tab |
| A3 | App über die Übersicht schließen, neu öffnen | wie A2 |
| A4 | Handy neu starten, App öffnen | wie A2 |
| A5 | Ordnersymbol links oben | Schublade kommt von links |
| A6 | Zurück-Taste bzw. Zurück-Geste bei offener Schublade | Schublade schließt, App bleibt offen |
| A7 | Zurück-Geste vom linken Rand bei geschlossener Schublade | App verhält sich wie vorher (kein Leerlauf in der Historie) |
| A8 | In der Schublade senkrecht scrollen, dann nach links wischen | Scrollen scrollt, Wischen schließt |
| A9 | Über dem Diagramm senkrecht wischen | Seite scrollt, Marker und Frequenzbereich bleiben |
| A10 | Zwei Finger im Diagramm auseinanderziehen | Frequenzachse zoomt; die Seite zoomt nicht |
| A11 | „In Bibliothek“ → gesamtes ZIP | Ergebnis nennt 100 von 100 |
| A12 | Datei aus Dateimanager oder Mail teilen → S-Analyzer | Datei kommt zur Sitzung dazu, die anderen bleiben |
| A13 | „Ordner öffnen“ | Ordnerauswahl erscheint oder der Knopf meldet verständlich, dass der Browser das nicht kann |
| A14 | „Speicher & Sicherung“ → Funktionstest | bestanden |
| A15 | Sicherung exportieren, Websitedaten löschen, Sicherung importieren | Bibliothek und Sitzung wieder da |
| A16 | Wenig freier Speicher (Gerät fast voll), großes ZIP importieren | Verständliche Meldung, nichts als gespeichert gekennzeichnet, was nicht gespeichert ist |
| A17 | Update: alte Version installiert, neue wird veröffentlicht | „Neue Version verfügbar → Neu laden“, danach sind alle Dateien noch da |

## iPhone (Safari, „Zum Home-Bildschirm“)

| Nr. | Schritt | Erwartung |
|---|---|---|
| I1 | A1 bis A5, A8 bis A11 | wie Android |
| I2 | „Speicher & Sicherung“ ansehen | Zeile „Dateiablage“ nennt OPFS oder IndexedDB; Funktionstest bestanden |
| I3 | Wischen vom linken Rand bei offener Schublade | Schublade schließt oder Safari blättert zurück, die App bleibt benutzbar |
| I4 | ZIP mit komprimierten Einträgen | wird entpackt (braucht iOS 16.4 oder neuer) |
| I5 | App eine Woche nicht öffnen (nur Safari-Tab, nicht installiert) | Safari kann die Daten gelöscht haben; installierte App behält sie |
| I6 | Vollbild-Knopf | reduzierte Ansicht funktioniert; echtes Vollbild gibt es auf dem iPhone nicht |

## Desktop

| Nr. | Schritt | Erwartung |
|---|---|---|
| D1 | Firefox und Safari: ZIP importieren, F5 | Dateien bleiben |
| D2 | Firefox im privaten Fenster | Hinweis „kein dauerhafter Speicher“, Dateien trotzdem benutzbar |
| D3 | Zwei Tabs der App, in beiden importieren | Importe laufen nacheinander, beide Listen stimmen nach F5 |
| D4 | Ordner per Drag & Drop mit 500 Dateien | Fortschritt, alle gespeichert |
| D5 | Datei über „Öffnen mit“ der installierten App, Profil „In Datei speichern“ | Datei wird überschrieben, gespeicherte Kopie folgt |

## Nicht automatisch prüfbar

- Echte Speicherknappheit des Geräts (im Test nur nachgestellt).
- Verhalten, wenn der Browser Daten selbst bereinigt.
- Die Systemgeste „Zurück“ von Android und iOS (im Test nur die Historie).
- Teilen aus anderen Apps und „Öffnen mit“.
- Ordnerauswahl auf Mobilgeräten.
