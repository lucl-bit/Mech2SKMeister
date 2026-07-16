import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import server


VALID_FIXTURE = {
    "id": "test-fixture",
    "title": "Testdreieck",
    "bbox": {"w": 2, "h": 1},
    "nodes": {"A": {"x": 0, "y": 1}, "B": {"x": 2, "y": 1}, "C": {"x": 1, "y": 0}},
    "bars": [
        {"id": "AB", "from": "A", "to": "B"},
        {"id": "BC", "from": "B", "to": "C"},
        {"id": "CA", "from": "C", "to": "A"},
    ],
    "supports": {"A": "pin", "B": "roller"},
    "loads": [{"kind": "point", "node": "C", "fx": 0, "fy": 1, "label": "F"}],
}

PW_HEADER = {"X-Settings-Password": server.SETTINGS_PASSWORD}


class FixturesApiTest(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self._orig_path = server.FIXTURES_PATH
        server.FIXTURES_PATH = Path(self._tmpdir.name) / "exam_fixtures.json"
        server._AUTH_FAILS.clear()
        self.client = server.app.test_client()

    def tearDown(self):
        server.FIXTURES_PATH = self._orig_path
        server._AUTH_FAILS.clear()
        self._tmpdir.cleanup()

    def _post_fixture(self, fixture, headers=PW_HEADER):
        return self.client.post(
            "/api/fixtures",
            data=json.dumps({"fixture": fixture}),
            content_type="application/json",
            headers=headers,
        )

    def test_get_without_store(self):
        resp = self.client.get("/api/fixtures")
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.get_json()["ok"])

    def test_auth(self):
        ok = self.client.post("/api/fixtures/auth", json={"password": "lucas1234"})
        self.assertTrue(ok.get_json()["ok"])
        bad = self.client.post("/api/fixtures/auth", json={"password": "falsch"})
        self.assertFalse(bad.get_json()["ok"])

    def test_post_wrong_password(self):
        resp = self._post_fixture(VALID_FIXTURE, headers={"X-Settings-Password": "falsch"})
        self.assertEqual(resp.status_code, 403)
        self.assertFalse(server.FIXTURES_PATH.exists())

    def test_post_invalid_fixture(self):
        resp = self._post_fixture({"id": "x"})
        self.assertEqual(resp.status_code, 400)

    def test_post_creates_store_and_get_returns_it(self):
        resp = self._post_fixture(VALID_FIXTURE)
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.get_json()["ok"])
        data = self.client.get("/api/fixtures").get_json()
        self.assertTrue(data["ok"])
        self.assertEqual(len(data["fixtures"]), 1)
        self.assertEqual(data["fixtures"][0]["id"], "test-fixture")

    def test_upsert_replaces_existing(self):
        self._post_fixture(VALID_FIXTURE)
        changed = dict(VALID_FIXTURE, title="Geändert")
        self._post_fixture(changed)
        data = self.client.get("/api/fixtures").get_json()
        self.assertEqual(len(data["fixtures"]), 1)
        self.assertEqual(data["fixtures"][0]["title"], "Geändert")

    def test_delete(self):
        self._post_fixture(VALID_FIXTURE)
        resp = self.client.delete("/api/fixtures/test-fixture", headers=PW_HEADER)
        self.assertEqual(resp.status_code, 200)
        data = self.client.get("/api/fixtures").get_json()
        self.assertEqual(data["fixtures"], [])

    def test_delete_unknown_returns_404(self):
        self._post_fixture(VALID_FIXTURE)
        resp = self.client.delete("/api/fixtures/gibt-es-nicht", headers=PW_HEADER)
        self.assertEqual(resp.status_code, 404)

    def test_corrupt_store_is_never_overwritten(self):
        server.FIXTURES_PATH.write_text("{kaputt", encoding="utf-8")
        get = self.client.get("/api/fixtures")
        self.assertFalse(get.get_json()["ok"])
        post = self._post_fixture(VALID_FIXTURE)
        self.assertEqual(post.status_code, 500)
        delete = self.client.delete("/api/fixtures/x", headers=PW_HEADER)
        self.assertEqual(delete.status_code, 500)
        # Datei-Inhalt unangetastet
        self.assertEqual(server.FIXTURES_PATH.read_text(encoding="utf-8"), "{kaputt")

    def test_auth_rate_limit(self):
        for _ in range(server._AUTH_MAX_FAILS):
            self.client.post("/api/fixtures/auth", json={"password": "falsch"})
        blocked = self.client.post("/api/fixtures/auth", json={"password": "lucas1234"})
        self.assertEqual(blocked.status_code, 429)
        # Auch Schreib-Endpoints sind für die IP gesperrt
        resp = self._post_fixture(VALID_FIXTURE)
        self.assertEqual(resp.status_code, 403)

    def test_delete_wrong_password(self):
        self._post_fixture(VALID_FIXTURE)
        resp = self.client.delete("/api/fixtures/test-fixture", headers={"X-Settings-Password": "nope"})
        self.assertEqual(resp.status_code, 403)


if __name__ == "__main__":
    unittest.main()
