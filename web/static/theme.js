'use strict';

// Zentrale Farbpalette — einzige Quelle für Canvas-Zeichnungen.
// Muss vor allen anderen Modul-Skripten geladen werden (index.html).
// Die CSS-Seite spiegelt dieselben Werte als Custom Properties (style.css).
window.THEME = {
  // Papier & Tusche
  paper: '#FBFDFF',
  text:  '#16222F',
  muted: '#5B6A7D',
  border: '#CCD8E3',

  // Zeichenraster (Millimeterpapier)
  gridMinor: '#E2EBF4',
  gridMajor: '#CBDCEC',

  // Modus-Akzente
  blue:   '#2F6FED',  // The Basics
  purple: '#7C5CE0',  // Fachwerk Profi / Q
  orange: '#D98634',  // Speed Run / Druck
  teal:   '#11A8B5',  // Inertia Lab
  green:  '#2E9D62',  // Builder / N / Zug
  red:    '#D9534F',  // M / Fehler / Lasten

  // Struktur-Elemente
  beam: '#243447',
  load: '#D9534F',
  hoverHalo: 'rgba(47,111,237,0.18)',

  // Inertia Lab Teilflächen
  partFills: ['#2F6FED', '#7C5CE0', '#2E9D62', '#D98634', '#11A8B5', '#D9534F'],
};
