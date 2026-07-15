# Vorzeichen-Audit — Mech2 Beanspruchungsmeister

Stand: 2026-07-15 (Branch `redesign`). Geprüft gegen **ETH Mechanik II (Prof. D. Mohr, D-BAUG/D-MAVT)**, belegt anhand `schnittkraft_trainer/exams/FS 2025.pdf`.

## 1. Die maßgebliche Kurs-Konvention

Aus der Prüfung FS 2025 (insb. **Frage D3**, Seite 12: „Verlauf der Biegemomentenbeanspruchung M_z(x) … um die eingezeichnete globale z-Achse"; Teil B/C mit Achsenkreuzen `x →, y ↓, z ⊗`):

| Größe | Kurs-Konvention | Konsequenz |
|---|---|---|
| Koordinaten | x rechts, y **unten**, z **in** die Ebene (rechtshändig) | identisch mit Canvas-Koordinaten |
| N | positiv = **Zug** (B2: „N>0 für Zugkraft") | universell |
| Q | in +y am positiven Schnittufer ⇔ „am linken Schnittufer nach **oben** positiv" | Einfeldträger mit Last ↓: Q links **+** |
| M_z | Moment **um die +z-Achse** | durchhängender Balken: M_z **negativ** ⇒ effektiv „**hogging positiv**" |
| Diagramme | Funktionsgraph, Ordinate nach oben; ⊕/⊖-Badges (D3) | positives M_z wird **oberhalb** der Stabachse gezeichnet |

**`uni.json` (tension / up / hogging) ist damit korrekt** — die Vermutung, dort sei etwas faul, hat sich nicht bestätigt. Der ältere Test `test_json_storage.test_uni_convention_matches_table_for_midspan_load_left_cut` (M = −5 bei Mittellast) passt zur Prüfung.

## 2. Gefundene Inkonsistenzen und Fixes

### 2.1 Zeichnen-Modus & Builder zeigten M in FEM-Konvention (FIX)
Der Frame-FEM-Solver (`server.py:_solve_frame_builder`) liefert M in **Element-Konvention** „M+ = Zug auf der +lokal-y-Seite" (sagging+). Numerisch belegt (siehe `tests/test_sign_regression.py`):
- Einfeldträger L=4, q=1↓: `Q_start=+2`, M_Feldmitte(FEM) = **+2** — Kurs: **−2**.
- Kragträger L=4, P=5↓: `M_start(FEM) = −20` — Kurs: **+20**.

Q und N sind in beiden Konventionen identisch; **nur M flippt**: `M_kurs = −M_fem`.

Fixes:
- `truss_builder.js:_solveFrame`: M_start/M_end werden beim Einlesen negiert.
- `frame_challenge.js:_computeSolution`: M- und M_mid-Signaturen negiert.
- `frame_challenge.js:_solutionsOf`: die handgeschriebenen Fixture-Fallback-Lösungen (`frame_fixtures.js`, in alter Element-Konvention notiert) werden beim Verwenden im M-Verlauf geflippt. Die **gezeichnete Geometrie ändert sich dadurch nicht** (doppelter Flip mit 2.2), nur die +/−-Labels stimmen jetzt mit dem Kurs überein.

### 2.2 Plot-Seite an Prüfungs-Ordinate angepasst (FIX)
Bisher wurden positive Verlaufswerte auf der **+lokal-y-Seite** (CCW-Normale, bei horizontalem Stab: unterhalb) gezeichnet. Die Prüfung zeichnet als Funktionsgraph mit Ordinate entgegen y (D3). Fix: Normale in `frame_challenge.js:_barAxes` und `truss_builder.js` (`_drawMemberResponse`, `_drawLinearResponse`) auf `(uy, −ux)` gedreht → positive Werte liegen auf der **−lokal-y-Seite**, wie im Kurs.

Netto-Effekt: **M-Bilder unverändert** (Flip × Flip), Labels kurs-korrekt; **Q/N-Bilder gespiegelt** auf die Prüfungsseite, Labels unverändert.

### 2.3 Client-Kragträger-Sonderfall entfernt (FIX)
`truss_builder.js:_solveCantilever` lieferte das Reaktionsmoment mit **umgekehrtem Vorzeichen** gegenüber dem FEM (`mz=+20` statt `−20`, Kommentar „CCW-Reaktion" war im y↓-System falsch herum). Der Sonderfall (inkl. `_cantileverCase`, Fallback-Zeichnern) wurde gelöscht; `_isFrame()` routet jetzt **jede Struktur mit Einspannung** über `/api/solve-frame`, den der Regressionstest absichert.

## 3. Weitere geprüfte Punkte (kein Fehler)

- **Zwei Backend-Koordinatenwelten**: Das Balken-Quiz (`model/structure.py`, `mechanics/solver.py`) rechnet mit **y↑** (`force_y = −P` für Last ↓, Reaktion aufwärts +); Fachwerk/Rahmen-Templates und der Builder rechnen mit **y↓** (`fy = +P` für Last ↓). Beide sind je in sich konsistent; die uni-Konvertierung (`sign_convention.py`) erzeugt die Kurs-Vorzeichen. Dokumentiert, nicht geändert.
- **Truss-Solver** (`mechanics/truss_solver.py`): Zug+ korrekt (3-Stab-Referenz: Diagonalen −25/3, Untergurt +20/3). Vorzeichen sind spiegelungsinvariant — y↓-Geometrie unproblematisch.
- **Quiz-Zeichnung** (`diagram_game.js`): positive Formen oben mit ⊕ — entspricht D3 (Funktionsgraph, Ordinate ↑). Mittellast-Träger → `moment_triangle_negative` (unten, ⊖) = Kurs-Bild ✓.
- **Z-Lasten** (`⊗`/`⊙`): werden planar als `fy` behandelt, `into → +fy` (nach unten). Didaktischer 2D-Stellvertreter, konsistent in Builder und Fixtures.
- **Streckenlast** `q=+1` = in +lokal-y (bei horizontalem Stab: nach unten) — konsistent zwischen Fixtures und FEM (`server.py:196`).
- **Totes Backend-Feature**: `generate_frame_challenge` (Level ≥ 21, handkodierte `sign_library`) ist vom Web-UI aus **unerreichbar** (Modi nutzen Level 1–20). Nicht verifiziert, nicht geändert.

## 4. Regressionstests

`schnittkraft_trainer/tests/test_sign_regression.py` pinnt fest:
1. `uni.json` = tension/up/hogging.
2. FEM-Basiswerte für Einfeldträger (Q=±2, M_mid,fem=+2) und Kragträger (M_start,fem=−20, mz=−20) — Grundlage der Frontend-Umrechnung `M_kurs = −M_fem`.
3. Truss-Vorzeichen am 3-Stab-Dreieck.
4. Quiz-Formen: Mittellast → `moment_triangle_negative` / `shear_positive_then_negative`; Kragträger → `moment_cantilever_positive`.

Ausführen: `python3 -m unittest discover schnittkraft_trainer/tests` (27 Tests, grün am 2026-07-15).
