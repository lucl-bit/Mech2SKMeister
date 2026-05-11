# Schnittkraft Trainer – CLAUDE.md

## Was ist das Projekt?

Ein Lernspiel für Technische Mechanik / Baustatik. Studenten trainieren N-, Q- und M-Verläufe sowie Fachwerke. Ziel: so schnell wie möglich als **Webapp im Browser** lauffähig machen.

## Projektpfad

```
/Users/lucaskoll/Documents/New project/schnittkraft_trainer/
```

## Technologie (aktueller Stand)

- **Sprache:** Python 3.11/3.13 + HTML/JS (Canvas)
- **Backend:** Flask (server.py), Port 5001
- **Frontend:** Vanilla JS + HTML5 Canvas (kein Framework)
- **Mechanik-Kern:** `mechanics/` – reine Python-Logik, kein GUI-Code
- **Starten (Webapp):** `cd "/Users/lucaskoll/Documents/New project" && python3 server.py` → http://localhost:5001
- **Starten (alte Tkinter-GUI):** `python3 -m schnittkraft_trainer.app --gui`
- **Tests:** `python3 -m unittest discover schnittkraft_trainer/tests`

## Ordnerstruktur

```
schnittkraft_trainer/
├── app.py                  # Einstiegspunkt (CLI-Argumente)
├── model/                  # Datenklassen: Balken, Lager, Last
├── mechanics/              # Statik-Rechnung (kein GUI-Code)
│   ├── solver.py           # Auflagerreaktionen
│   ├── internal_forces.py  # N, Q, M an Schnittstellen
│   ├── truss_solver.py     # Fachwerk-Stabkräfte
│   └── sign_convention.py  # Vorzeichenkonvention
├── game/                   # Spiellogik: Aufgaben, Scoring, Feedback
│   ├── tasks.py
│   ├── scoring.py
│   ├── feedback.py
│   ├── diagram_challenges.py
│   └── console_game.py
├── gui/                    # Tkinter-GUI (wird durch Web ersetzt)
│   ├── main_window.py      # Startmenü, Frame-Verwaltung
│   ├── diagram_game.py     # Verlauf-Spiel
│   ├── truss_builder.py    # Fachwerk-Builder
│   ├── canvas.py
│   └── theme.py
├── data/
│   ├── tasks/              # Aufgaben als JSON
│   ├── sign_conventions/   # default.json, alternative.json, uni.json
│   └── progress/           # Spielstand (JSON)
└── tests/
```

## Spielmodi

1. **Verlauf-Spiel** – zufällige Balkenaufgaben, Spieler wählt den richtigen N/Q/M-Verlauf
2. **Fachwerk-Builder** – Knoten/Stäbe/Lager/Lasten setzen, Stabkräfte berechnen

## Webapp-Struktur (neu, Stand Mai 2026)

```
New project/
├── server.py              # Flask-Server, Port 5001
└── web/
    ├── index.html         # Single-Page-App, 3 Views: Menü / Spiel / Builder
    └── static/
        ├── style.css
        ├── app.js         # View-Routing
        ├── diagram_game.js  # Verlauf-Spiel (Canvas-Zeichnung + API-Calls)
        └── truss_builder.js # Fachwerk-Builder (Canvas + Solver-API)
```

## Scoring-System (Verlauf-Spiel)

- +100 Punkte für richtige Antwort
- -100 Punkte für falsche Antwort
- Anzeige oben rechts als Gesamtpunktzahl
- Konvention immer "uni" (kein Wechsel mehr)

## Challenge-Varianten

- Levels 1–10: Balken (N/Q/M), mit und ohne horizontale Kraft (force_x)
- Levels 11–20: Fachwerke (Normalkraft)
- Levels 21+: Rahmen (N/Q/M)
- Falschantworten enthalten **immer die vorzeichengedrehte** richtige Antwort

## Bekannte N-Formen (neu)

- `n_left_positive` / `n_left_negative`: N konstant links der Last, null rechts (Einfeldträger mit fx)
- `constant_positive` / `constant_negative`: N konstant gesamt (Kragträger mit fx)

## Wichtige Konventionen

- `mechanics/` und `model/` dürfen **keinen** GUI-Code enthalten – sauber trennbar
- Vorzeichenkonvention ist austauschbar (JSON-Dateien in `data/sign_conventions/`)
- Positive Stabkraft N = Zug, negative = Druck
- Im idealen Fachwerk: Q = 0, M = 0 in den Stäben

## Fortschritt wird gespeichert in

- `data/progress/gui_progress.json`
- `data/progress/console_progress.json`
