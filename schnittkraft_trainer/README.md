# Schnittkraft Trainer

Ein lokales Lernspiel für Technische Mechanik und Baustatik.

## Aktueller Stand

Dieser Minimalstand enthält noch keine GUI. Er kann einfache statisch bestimmte
Balken mit zwei Lagern und vertikalen Punktlasten berechnen.

Vorhanden sind:

- Berechnung von `Ay` und `By`
- Berechnung von `N`, `Q/V` und `M` an einer Schnittstelle
- frei austauschbare Vorzeichenkonvention
- Aufgaben als JSON
- Konventionen als JSON
- einfacher Konsolen-Spielmodus mit Punkten und Feedback

## Warum die Dateien so aufgebaut sind

`model/` enthält Datenklassen. Dort steht, was ein Balken, ein Lager oder eine
Last ist. Diese Dateien rechnen nicht selbst.

`mechanics/` enthält die Statik-Rechnung. Diese Module kennen keine GUI und kein
Spielmenü. Dadurch können wir sie später in PySide6 genauso verwenden wie im
Konsolenmodus.

`game/` verbindet Aufgaben, Bewertung und Feedback. Hier entsteht nach und nach
die Lernspiel-Logik.

`data/` enthält gespeicherte Aufgaben, Konventionen und Fortschritt.

`tests/` prüft den Rechenkern und die JSON-Speicherung.

## Tests ausführen

Im Projektordner:

```bash
cd "/Users/lucaskoll/Documents/New project"
python3 -m unittest discover schnittkraft_trainer/tests
```

## Spiel ausprobieren

Grafische Oberfläche mit Startmenü:

```bash
cd "/Users/lucaskoll/Documents/New project"
python3 -m schnittkraft_trainer.app --gui
```

Im Menü gibt es aktuell:

- Verlauf-Spiel: N-, Q- und M-Verläufe auswählen
- Fachwerk bauen: Knoten, Stäbe, Lager und Lasten auf einem Raster setzen

Im Verlauf-Spiel:

- Aufgaben 1 bis 10 sind einfache Balken/Kragträger
- Aufgaben 11 bis 20 sind Fachwerke mit Normalkraftvorzeichen
- ab Aufgabe 21 kommen Rahmen-/Balkensysteme
- die Rahmenaufgaben fragen gemischt nach `N`, `Q` und `M`
- positive und negative Bereiche werden mit `+` und `-` markiert

Im Fachwerk-Builder:

- `Knoten`: ins Raster klicken
- `Stab`: zwei vorhandene Knoten nacheinander anklicken
- `Festlager` / `Loslager`: auf einen Knoten klicken
- `Einspannung`: auf einen Knoten klicken; im aktuellen Fachwerkmodell sperrt sie x/y wie ein festes Knotenlager
- `Freies Ende`: auf einen Knoten klicken
- `Last ziehen`: an einem vorhandenen Knoten starten und in Lastrichtung ziehen
- `System prüfen`: einfaches Zählkriterium `m + r = 2j`
- `Berechnen`: Stabkräfte und Auflagerreaktionen berechnen
- `M` / `Q` / `N`: Beanspruchungsanzeige umschalten

Bei der Fachwerkberechnung gilt:

- `x` positiv nach rechts
- `y` positiv nach unten
- positive Stabkraft `N` bedeutet Zug
- negative Stabkraft `N` bedeutet Druck
- im idealen gelenkigen Fachwerk sind `Q = 0` und `M = 0` in den Stäben
- Einspannmomente werden erst im späteren Rahmen-/Balkenmodus gerechnet

Kragträger-Sonderfall im Builder:

- genau ein Stab
- ein Ende als `Einspannung`
- anderes Ende als `Freies Ende`
- Last am freien Ende
- dann werden `N`, `Q` und `M` als Balkenverläufe berechnet

Konsolenmodus:

```bash
cd "/Users/lucaskoll/Documents/New project"
python3 -m schnittkraft_trainer.app
```

Alternative Vorzeichenkonvention ausprobieren:

```bash
python3 -m schnittkraft_trainer.app --convention alternative
```

Uni-Konvention aus der Tabelle ausprobieren:

```bash
python3 -m schnittkraft_trainer.app --convention uni
```

Die bisherigen Punkte werden hier gespeichert:

```text
schnittkraft_trainer/data/progress/console_progress.json
```

Der GUI-Fortschritt wird hier gespeichert:

```text
schnittkraft_trainer/data/progress/gui_progress.json
```

## Beispielwerte

Für die erste Aufgabe:

- `Ay = 5`
- `By = 5`
- `Q/V = 5`
- `M = 5`

Für die zweite Aufgabe:

- `Ay = 5`
- `By = 5`
- `Q/V = -5`
- `M = 5`
