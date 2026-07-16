#!/usr/bin/env node
// Einmalige Migration: alle Fixtures aus web/static/frame_fixtures.js
// (Teil B + Teil C, auch die bisher nicht selektierten) nach
// schnittkraft_trainer/data/exam_fixtures.json.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'web/static/frame_fixtures.js'), 'utf8');

globalThis.window = {};
// eval ist hier bewusst: einmalige Migration einer eigenen, vertrauenswürdigen
// Repo-Datei (keine Fremd-/Nutzereingabe). FRAME_FIXTURES/PART_C_FIXTURES sind
// const im Datei-Scope — per Anhang exportieren.
eval(src + '\nglobalThis.__ALL_FIXTURES__ = [...PART_C_FIXTURES, ...FRAME_FIXTURES];');

const all = globalThis.__ALL_FIXTURES__;
const ids = new Set(all.map((f) => f.id));
if (ids.size !== all.length) throw new Error('Doppelte Fixture-IDs!');

const out = join(root, 'schnittkraft_trainer/data/exam_fixtures.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(all, null, 2) + '\n');
console.log(`${all.length} Fixtures nach ${out} geschrieben.`);
