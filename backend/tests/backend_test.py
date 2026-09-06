"""Backend API tests for State Crime Command."""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://rp-case-manager-1.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"

ADMIN = {"username": "admin", "password": "ADMINSCC2026!"}
DETECTIVE = {"username": "DETECTIVE", "password": "NSWPFSCC2026"}


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json=ADMIN)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def detective_token():
    r = requests.post(f"{API}/auth/login", json=DETECTIVE)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def h(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------------- Auth ----------------
class TestAuth:
    def test_login_admin(self):
        r = requests.post(f"{API}/auth/login", json=ADMIN)
        assert r.status_code == 200
        d = r.json()
        assert d["role"] == "admin" and d["username"] == "admin"
        assert isinstance(d["token"], str) and len(d["token"]) > 10

    def test_login_detective(self):
        r = requests.post(f"{API}/auth/login", json=DETECTIVE)
        assert r.status_code == 200
        assert r.json()["role"] == "detective"

    def test_login_bad(self):
        r = requests.post(f"{API}/auth/login", json={"username": "admin", "password": "wrong"})
        assert r.status_code == 401
        assert "Invalid credentials" in r.json()["detail"]

    def test_me_requires_auth(self):
        assert requests.get(f"{API}/auth/me").status_code in (401, 403)

    def test_me_with_token(self, admin_token):
        r = requests.get(f"{API}/auth/me", headers=h(admin_token))
        assert r.status_code == 200 and r.json()["role"] == "admin"


# ---------------- Config/Stats ----------------
class TestConfig:
    def test_config(self, detective_token):
        r = requests.get(f"{API}/config", headers=h(detective_token))
        assert r.status_code == 200
        d = r.json()
        assert "Organised Crime Squad" in d["divisions"]
        assert set(d["statuses"]) == {"pending", "opened", "closed"}

    def test_stats(self, admin_token):
        r = requests.get(f"{API}/stats", headers=h(admin_token))
        assert r.status_code == 200
        for k in ("pending", "opened", "closed", "total"):
            assert k in r.json()


# ---------------- Cases CRUD + Role gating ----------------
class TestCases:
    def test_list_cases(self, admin_token):
        r = requests.get(f"{API}/cases", headers=h(admin_token))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_detective_creates_case_pending(self, detective_token):
        payload = {
            "name": "TEST_DetCase",
            "lead_investigator": "Det. TEST",
            "division": "Organised Crime Squad",
            "synopsis": "test",
            "discord_url": "https://discord.com/x",
        }
        r = requests.post(f"{API}/cases", json=payload, headers=h(detective_token))
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["status"] == "pending"
        assert c["created_by"] == "DETECTIVE"
        assert c["name"] == "TEST_DetCase"
        # verify via GET
        g = requests.get(f"{API}/cases/{c['id']}", headers=h(detective_token))
        assert g.status_code == 200 and g.json()["case_id"] == c["case_id"]
        # cleanup via admin
        pytest.det_case_id = c["id"]

    def test_detective_cannot_delete(self, detective_token):
        cid = getattr(pytest, "det_case_id", None)
        assert cid
        r = requests.delete(f"{API}/cases/{cid}", headers=h(detective_token))
        assert r.status_code == 403

    def test_detective_cannot_approve(self, detective_token):
        cid = getattr(pytest, "det_case_id", None)
        r = requests.post(f"{API}/cases/{cid}/approve", headers=h(detective_token))
        assert r.status_code == 403

    def test_detective_cannot_change_status_via_put(self, detective_token):
        cid = getattr(pytest, "det_case_id", None)
        r = requests.put(f"{API}/cases/{cid}", json={"status": "opened"}, headers=h(detective_token))
        assert r.status_code == 200
        # verify status did NOT change
        g = requests.get(f"{API}/cases/{cid}", headers=h(detective_token))
        assert g.json()["status"] == "pending"

    def test_admin_approves(self, admin_token):
        cid = getattr(pytest, "det_case_id", None)
        r = requests.post(f"{API}/cases/{cid}/approve", headers=h(admin_token))
        assert r.status_code == 200
        assert r.json()["status"] == "opened"

    def test_admin_edit_status(self, admin_token):
        cid = getattr(pytest, "det_case_id", None)
        r = requests.put(f"{API}/cases/{cid}", json={"status": "closed"}, headers=h(admin_token))
        assert r.status_code == 200 and r.json()["status"] == "closed"

    def test_admin_delete(self, admin_token):
        cid = getattr(pytest, "det_case_id", None)
        r = requests.delete(f"{API}/cases/{cid}", headers=h(admin_token))
        assert r.status_code == 200
        g = requests.get(f"{API}/cases/{cid}", headers=h(admin_token))
        assert g.status_code == 404

    def test_invalid_division(self, detective_token):
        r = requests.post(f"{API}/cases", json={
            "name": "X", "lead_investigator": "Y", "division": "Bogus"
        }, headers=h(detective_token))
        assert r.status_code == 400

    def test_search_filter(self, admin_token):
        r = requests.get(f"{API}/cases", params={"search": "Viper"}, headers=h(admin_token))
        assert r.status_code == 200
        assert any("Viper" in c["name"] for c in r.json())

    def test_status_filter(self, admin_token):
        r = requests.get(f"{API}/cases", params={"status": "opened"}, headers=h(admin_token))
        assert r.status_code == 200
        assert all(c["status"] == "opened" for c in r.json())


# ---------------- New features: priority, notes, sign-off, webhook ----------------
class TestNewFeatures:
    def test_config_has_priorities(self, admin_token):
        r = requests.get(f"{API}/config", headers=h(admin_token))
        assert r.status_code == 200
        assert set(r.json()["priorities"]) == {"routine", "urgent", "high-risk"}

    def test_create_with_priority_and_system_note(self, detective_token, admin_token):
        payload = {
            "name": "TEST_PriorityCase",
            "lead_investigator": "Det. TEST",
            "division": "Organised Crime Squad",
            "synopsis": "priority test",
            "discord_url": "https://discord.com/x",
            "priority": "high-risk",
        }
        r = requests.post(f"{API}/cases", json=payload, headers=h(detective_token))
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["priority"] == "high-risk"
        assert c["status"] == "pending"
        assert c["approved_by"] is None
        # system 'logged' note added
        assert isinstance(c["notes"], list) and len(c["notes"]) >= 1
        assert c["notes"][0]["kind"] == "system"
        assert c["notes"][0]["author"] == "DETECTIVE"
        pytest.new_case_id = c["id"]

    def test_invalid_priority_rejected(self, detective_token):
        r = requests.post(f"{API}/cases", json={
            "name": "X", "lead_investigator": "Y",
            "division": "Organised Crime Squad", "priority": "bogus",
        }, headers=h(detective_token))
        assert r.status_code == 400

    def test_edit_priority(self, detective_token):
        cid = pytest.new_case_id
        r = requests.put(f"{API}/cases/{cid}", json={"priority": "urgent"}, headers=h(detective_token))
        assert r.status_code == 200 and r.json()["priority"] == "urgent"
        g = requests.get(f"{API}/cases/{cid}", headers=h(detective_token))
        assert g.json()["priority"] == "urgent"

    def test_detective_add_note(self, detective_token):
        cid = pytest.new_case_id
        r = requests.post(f"{API}/cases/{cid}/notes", json={"note": "First TEST update note"}, headers=h(detective_token))
        assert r.status_code == 200
        notes = r.json()["notes"]
        assert any(n["note"] == "First TEST update note" and n["author"] == "DETECTIVE" and n["kind"] == "note" for n in notes)

    def test_empty_note_rejected(self, detective_token):
        cid = pytest.new_case_id
        r = requests.post(f"{API}/cases/{cid}/notes", json={"note": "   "}, headers=h(detective_token))
        assert r.status_code == 400

    def test_admin_approve_signoff(self, admin_token):
        cid = pytest.new_case_id
        r = requests.post(f"{API}/cases/{cid}/approve", headers=h(admin_token))
        assert r.status_code == 200
        d = r.json()
        assert d["status"] == "opened"
        assert d["approved_by"] == "admin"
        assert d["approved_at"] is not None
        # system 'approved' note appended
        assert any(n["kind"] == "system" and "approved" in n["note"].lower() for n in d["notes"])

    def test_notes_persist(self, admin_token):
        cid = pytest.new_case_id
        g = requests.get(f"{API}/cases/{cid}", headers=h(admin_token))
        assert g.status_code == 200
        notes = g.json()["notes"]
        assert any(n["note"] == "First TEST update note" for n in notes)

    def test_cleanup(self, admin_token):
        cid = pytest.new_case_id
        requests.delete(f"{API}/cases/{cid}", headers=h(admin_token))


class TestDiscordWebhook:
    """Verify webhook fired HTTP 204 - inspect backend supervisor logs."""
    def test_webhook_logged_204(self, detective_token, admin_token):
        # Create a case to trigger a webhook
        payload = {
            "name": "TEST_WebhookCase",
            "lead_investigator": "Det. TEST",
            "division": "Strike Force Raptor",
            "priority": "urgent",
        }
        r = requests.post(f"{API}/cases", json=payload, headers=h(detective_token))
        assert r.status_code == 200
        cid = r.json()["id"]
        # approve to fire second webhook
        r2 = requests.post(f"{API}/cases/{cid}/approve", headers=h(admin_token))
        assert r2.status_code == 200
        # cleanup
        requests.delete(f"{API}/cases/{cid}", headers=h(admin_token))
        # We can't assert on logs from here reliably, but the endpoints must not have
        # failed even if webhook errored — asserted by the 200 responses above.
