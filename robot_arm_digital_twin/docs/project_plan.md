# Projektplan: Robot Arm Digital Twin

## Ziel

Ein MATLAB-Projekt, das wie ein kleiner industrieller Digital Twin wirkt:
Robotermodell, inverse Kinematik, Pick-and-Place-Trajektorie,
Kollisionspruefung, Visualisierung und spaeter Regelung/Simscape.

## Minimal benoetigt

- MATLAB
- Robotics System Toolbox
- Grundwissen: Matrizen, Rotation/Transformation, Gelenkwinkel, einfache Regelung

## Optional fuer die starke CV-Version

- Simulink fuer PID- oder Stateflow-Ablaufsteuerung
- Simscape Multibody fuer CAD-/Mehrkoerpermodell
- Model Predictive Control Toolbox fuer MPC
- Ein CAD-Tool oder URDF-Modell fuer einen realistischeren Roboter

## Milestones

1. Basismodell in MATLAB ausfuehren.
2. Pick-and-place-Wegpunkte anpassen.
3. Collision-Check sauber dokumentieren.
4. Joint-Profile und Clearance-Plots exportieren.
5. Inverse Dynamics ergaenzen: benoetigte Gelenkmomente.
6. Simulink-PID-Regelung pro Gelenk bauen.
7. Simscape Multibody/CAD-Modell importieren.
8. README mit Bildern, GIF und technischen Ergebnissen fertig machen.

## CV-Satz

Developed a MATLAB-based robot arm digital twin for a pick-and-place task,
including rigid-body modeling, inverse kinematics, smooth joint-space
trajectory generation, collision checking, and simulation result analysis.
