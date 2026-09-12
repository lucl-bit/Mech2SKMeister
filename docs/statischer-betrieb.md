# Statischer Betrieb auf GitHub Pages

Die App läuft ohne Server. Ausgeliefert wird nur `web/`; Aufgaben, Fixtures und
Löser stecken als statische Dateien beziehungsweise als JavaScript darin. Damit
kostet das Hosting nichts und es gibt keine Kaltstarts.

**Live:** https://lucl-bit.github.io/Mech2SKMeister/

## Wie das Backend ersetzt wird

`web/static/api_local.js` fängt `fetch`-Aufrufe auf `/api/...` ab und beantwortet
sie im Browser. Der übrige Frontend-Code ist unverändert — er merkt nicht, dass
kein Flask dahinter steht.

| Endpunkt | vorher (Flask) | jetzt (statisch) |
|---|---|---|
| `POST /api/solve-truss` | `mechanics/truss_solver.py` | `web/static/solver_truss.js` |
| `POST /api/solve-frame` | `_solve_frame_builder` in `server.py` (numpy) | `web/static/solver_frame.js` |
| `POST /api/challenge` | `diagram_challenges.py` zur Laufzeit | `web/data/challenges.json`, vorgeneriert |
| `POST /api/generate-truss` | `truss_generator.py` zur Laufzeit | `web/data/trusses.json`, vorgeneriert |
| `GET /api/fixtures` | `data/exam_fixtures.json` vom Server | `web/data/fixtures.json` |
| `POST/DELETE /api/fixtures…` | schrieb auf Platte | lehnt ab, Hinweis auf lokale Pflege |
| `POST /api/save-progress` | schrieb JSON auf Platte | `localStorage` |

Läuft lokal `python3 server.py`, bleibt Flask zuständig — nur so lässt sich die
Fixture-Datenbank bearbeiten. Erkannt wird das über `window.__SK_BACKEND__`:
Flask setzt den Marker beim Ausliefern von `index.html` (siehe `index()` in
`server.py`), auf Pages fehlt er und der Shim übernimmt.

## Neue Prüfungsaufgabe aufnehmen

```bash
python3 server.py                      # lokal, Port 5001
# Einstellungen-Tab: Aufgabe anlegen oder korrigieren
python3 tools/build_static.py          # web/data/* und golden.json neu bauen
git add web/data tests_static/golden.json schnittkraft_trainer/data/exam_fixtures.json
git commit -m "Neue Prüfungsaufgabe"
git push                               # Actions deployt nach Pages
```

`tools/build_static.py` muss nach **jeder** Änderung an Fixtures, Generatoren
oder Lösern laufen. Der CI-Job schlägt sonst fehl: er baut die Daten selbst neu
und vergleicht sie mit den eingecheckten.

## Physik prüfen

Die Python-Löser bleiben die Referenz. `tools/build_static.py` schreibt ihre
Ergebnisse für alle Prüfungsaufgaben, 60 generierte Fachwerke und einige
Sonderfälle nach `tests_static/golden.json`; der Node-Test vergleicht die
JS-Portierung dagegen (Toleranz 1e-9 relativ).

```bash
python3 -m unittest discover -s schnittkraft_trainer/tests -t .   # 46 Tests
node --test tests_static/solver.test.js                           # 84 Tests
python3 tools/check_golden.py                                     # golden.json aktuell?
```

Alles drei läuft auch im CI, vor jedem Deploy.

`golden.json` wird mit Toleranz geprüft, nicht bit-exakt: numpy nutzt je
Plattform ein anderes BLAS (Apple Accelerate auf dem Mac, OpenBLAS auf den
Actions-Runnern), `np.linalg.solve` weicht dadurch in der letzten Stelle ab.
Die vorgenerierten Daten unter `web/data/` sind dagegen streng deterministisch
und werden bit-genau verglichen.

## Grenzen

- **Kein Speichern auf dem Server.** Auf Render war das ebenfalls flüchtig: Bei
  jedem Spin-down verschwanden Änderungen an der Fixture-Datenbank.
- **Das Passwort im Einstellungen-Tab schützt nichts mehr.** Auf einer statischen
  Seite ist jeder Code öffentlich. Der Tab bleibt zum Ansehen offen,
  Schreibzugriffe lehnen ab. `SETTINGS_PASSWORD` gilt weiter für den lokalen
  Server — den Default in `server.py` bei Bedarf per Umgebungsvariable
  überschreiben.
- **Aufgaben sind endlich:** 40 Varianten je Aufgabennummer (800 insgesamt).
  Mehr über `python3 tools/build_static.py --seeds 100`.
- **Keine npm-Pakete.** Das Repo liegt unter `~/Desktop` und damit in der
  iCloud-Synchronisation; ein `npm install` hier hat den Mac schon zweimal
  eingefroren. Die Tests laufen deshalb mit `node --test` ohne Abhängigkeiten.
