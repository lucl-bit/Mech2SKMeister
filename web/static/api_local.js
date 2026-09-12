/* Ersetzt das Flask-Backend im Browser.
 *
 * Faengt fetch-Aufrufe auf /api/... ab und beantwortet sie lokal: Loeser aus
 * solver_truss.js / solver_frame.js, Aufgaben und Fixtures aus web/data/.
 * So bleibt der uebrige Frontend-Code (rund 6900 Zeilen) unveraendert - er
 * merkt nicht, dass kein Server mehr dahinter steht.
 *
 * MUSS vor allen anderen Skripten geladen werden.
 */
(function () {
  'use strict';

  const originalFetch = window.fetch ? window.fetch.bind(window) : null;
  const cache = new Map();

  /* Laeuft ein echtes Backend (lokal: python3 server.py), soll es zustaendig
   * bleiben - nur so kann die Fixture-Datenbank weiter bearbeitet werden.
   * Flask setzt dafuer window.__SK_BACKEND__ beim Ausliefern der Seite (siehe
   * index() in server.py). Auf GitHub Pages und jedem anderen statischen
   * Server fehlt der Marker, dann uebernimmt der Shim. */
  const backendAvailable = window.__SK_BACKEND__ === true;

  function dataUrl(name) {
    return new URL(`data/${name}`, document.baseURI).href;
  }

  async function loadData(name) {
    if (!cache.has(name)) {
      cache.set(name, originalFetch(dataUrl(name)).then((resp) => {
        if (!resp.ok) throw new Error(`${name}: HTTP ${resp.status}`);
        return resp.json();
      }));
    }
    return cache.get(name);
  }

  function jsonResponse(payload, status) {
    return new Response(JSON.stringify(payload), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const READ_ONLY_MESSAGE = 'Nur-Lese-Betrieb: Die Fachwerk-Datenbank kommt aus dem Repo. '
    + 'Zum Bearbeiten den lokalen Server starten (python3 server.py), Änderung dort machen '
    + 'und committen — die Seite zieht sie beim nächsten Deploy.';

  /* Waehlt aus den vorgenerierten Varianten. Gleicher Seed = gleiche Aufgabe,
   * wie beim Generator auf dem Server. */
  function pickVariant(variants, seed) {
    if (!variants || variants.length === 0) return null;
    const index = Number.isFinite(seed)
      ? Math.abs(Math.trunc(seed)) % variants.length
      : Math.floor(Math.random() * variants.length);
    return variants[index];
  }

  const routes = {
    'POST /api/solve-truss': async (body) => {
      try {
        const result = window.SKTruss.solveTruss({
          joints: body.joints, bars: body.bars,
          loads: body.loads || [], supports: body.supports,
        });
        return { ok: true, bar_forces: result.bar_forces, reactions: result.reactions };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    'POST /api/solve-frame': async (body) => {
      try {
        const result = window.SKFrame.solveFrame(
          body.joints, body.bars, body.supports,
          body.loads || [], new Set(body.welds || []), body.distributed_loads || [],
        );
        return { ok: true, bar_forces: result.bar_forces, reactions: result.reactions };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    'POST /api/challenge': async (body) => {
      const challenges = await loadData('challenges.json');
      const number = String(parseInt(body.challenge_number, 10) || 1);
      const variant = pickVariant(challenges[number], body.seed);
      if (!variant) throw new Error(`keine Aufgabe fuer Nummer ${number}`);
      return variant;
    },

    'POST /api/generate-truss': async (body) => {
      const trusses = await loadData('trusses.json');
      const fixture = pickVariant(trusses, body.seed);
      if (!fixture) return { ok: false, error: 'keine Fachwerke vorgeneriert' };
      return { ok: true, fixture };
    },

    'GET /api/fixtures': async () => {
      const fixtures = await loadData('fixtures.json');
      return { ok: true, fixtures };
    },

    // Das Passwort schuetzt im statischen Betrieb nichts mehr (der Code ist
    // oeffentlich einsehbar). Der Tab bleibt zum Ansehen offen, Schreibzugriffe
    // lehnen mit Erklaerung ab.
    'POST /api/fixtures/auth': async () => ({ ok: true, read_only: true }),
    'POST /api/fixtures': async () => ({ ok: false, error: READ_ONLY_MESSAGE }),

    'POST /api/save-progress': async (body) => {
      try {
        localStorage.setItem('mech2.progress', JSON.stringify(body));
      } catch (err) {
        // Privater Modus oder Speicher voll - Fortschritt ist kein Pflichtfeature
      }
      return { ok: true };
    },
  };

  function routeKey(method, pathname) {
    const apiIndex = pathname.indexOf('/api/');
    const apiPath = apiIndex >= 0 ? pathname.slice(apiIndex) : pathname;
    return `${method} ${apiPath}`;
  }

  window.fetch = async function patchedFetch(input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();

    let pathname = url;
    try {
      pathname = new URL(url, document.baseURI).pathname;
    } catch (err) { /* relative Pfade unveraendert pruefen */ }

    if (!pathname.includes('/api/')) return originalFetch(input, init);
    if (backendAvailable) return originalFetch(input, init);

    const key = routeKey(method, pathname);

    // DELETE /api/fixtures/<id> und POST auf eine Einzel-ID: beide sind
    // Schreibzugriffe und laufen in dieselbe Antwort.
    const isSingleFixtureWrite = key.startsWith('DELETE /api/fixtures/')
      || (key.startsWith('POST /api/fixtures/') && key !== 'POST /api/fixtures/auth');
    if (isSingleFixtureWrite) {
      return jsonResponse({ ok: false, error: READ_ONLY_MESSAGE });
    }

    const handler = routes[key];
    if (!handler) {
      return jsonResponse({ ok: false, error: `unbekannter Endpunkt: ${key}` }, 404);
    }

    let body = {};
    if (init && init.body) {
      try { body = JSON.parse(init.body); } catch (err) { body = {}; }
    }

    try {
      return jsonResponse(await handler(body));
    } catch (err) {
      return jsonResponse({ ok: false, error: err.message }, 500);
    }
  };
})();
