"""Regression test for reported bug: creating a NEW case must RELIABLY fire the Discord webhook.

Bug root cause (iteration_2): notify_discord() was scheduled via asyncio.create_task without a
reference — task could be GC'd before completion, so webhook fired inconsistently / not at all.

Fix: create_case now uses FastAPI BackgroundTasks (background_tasks.add_task(notify_discord, ...))
which reliably runs the coroutine after the response is returned.

Verification: tail /var/log/supervisor/backend.err.log for httpx INFO lines like:
    HTTP Request: POST https://discord.com/api/webhooks/... "HTTP/1.1 204 No Content"
Count them relative to the number of case creations.
"""
import os
import re
import time
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
API = f"{BASE_URL}/api"
LOG_PATH = "/var/log/supervisor/backend.err.log"

WEBHOOK_LINE_RE = re.compile(
    r'HTTP Request: POST https://discord\.com/api/webhooks/[^\s]+ "HTTP/1\.1 204 No Content"'
)

ADMIN = {"username": "admin", "password": "ADMINSCC2026!"}
DETECTIVE = {"username": "DETECTIVE", "password": "NSWPFSCC2026"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _count_webhook_204s() -> int:
    """Count all httpx 204 webhook lines in backend.err.log."""
    try:
        with open(LOG_PATH, "r", errors="ignore") as f:
            return sum(1 for line in f if WEBHOOK_LINE_RE.search(line))
    except FileNotFoundError:
        pytest.skip(f"Log file not found: {LOG_PATH}")


def _wait_for_new_webhooks(baseline: int, expected_delta: int, timeout: float = 15.0) -> int:
    """Poll the log until at least `expected_delta` new 204 lines appear. Returns actual delta."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        cur = _count_webhook_204s()
        if cur - baseline >= expected_delta:
            return cur - baseline
        time.sleep(0.5)
    return _count_webhook_204s() - baseline


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def detective_token():
    return _login(DETECTIVE)


class TestDiscordWebhookReliability:
    """PRIMARY regression: creating a case MUST fire the webhook every time."""

    def test_five_consecutive_creations_each_fire_204(self, detective_token, admin_token):
        baseline = _count_webhook_204s()
        created_ids = []
        n = 5
        try:
            for i in range(n):
                payload = {
                    "name": f"TEST_Regression_Webhook_{i}",
                    "lead_investigator": "Det. TEST",
                    "division": "Strike Force Raptor",
                    "synopsis": f"Regression webhook run #{i}",
                    "priority": "urgent",
                }
                r = requests.post(f"{API}/cases", json=payload, headers=_h(detective_token))
                # Create MUST return 200 fast even if webhook is slow/failing
                assert r.status_code == 200, f"create #{i} failed: {r.status_code} {r.text}"
                body = r.json()
                assert body["status"] == "pending"
                assert body["priority"] == "urgent"
                assert body["created_by"] == "DETECTIVE"
                created_ids.append(body["id"])
                # brief spacing to keep log lines readable — not required by the fix
                time.sleep(0.3)

            # Wait for background tasks to flush to Discord
            delta = _wait_for_new_webhooks(baseline, n, timeout=20.0)
            assert delta >= n, (
                f"Expected at least {n} new Discord 204 webhook lines in "
                f"{LOG_PATH}, but only found {delta}. Bug is NOT fixed — "
                f"webhook is still firing intermittently."
            )
        finally:
            for cid in created_ids:
                requests.delete(f"{API}/cases/{cid}", headers=_h(admin_token))

    def test_webhook_does_not_fire_on_approve_note_or_edit(self, detective_token, admin_token):
        """Only case creation should fire the webhook — approve/note/edit must NOT."""
        # Create one case (this WILL fire a webhook — expected)
        r = requests.post(f"{API}/cases", json={
            "name": "TEST_Regression_NoFire",
            "lead_investigator": "Det. TEST",
            "division": "Organised Crime Squad",
            "priority": "routine",
        }, headers=_h(detective_token))
        assert r.status_code == 200
        cid = r.json()["id"]
        # let the creation webhook flush
        _wait_for_new_webhooks(_count_webhook_204s() - 1, 1, timeout=15.0)

        try:
            # Snapshot AFTER the create-webhook has fired
            time.sleep(2)
            baseline = _count_webhook_204s()

            # 1) Add a timeline note — MUST NOT fire webhook
            r_note = requests.post(
                f"{API}/cases/{cid}/notes",
                json={"note": "TEST regression — should not ping"},
                headers=_h(detective_token),
            )
            assert r_note.status_code == 200

            # 2) Edit the case — MUST NOT fire webhook
            r_put = requests.put(
                f"{API}/cases/{cid}",
                json={"synopsis": "edited synopsis — no ping expected"},
                headers=_h(detective_token),
            )
            assert r_put.status_code == 200

            # 3) Approve the case — MUST NOT fire webhook
            r_appr = requests.post(f"{API}/cases/{cid}/approve", headers=_h(admin_token))
            assert r_appr.status_code == 200
            assert r_appr.json()["status"] == "opened"

            # Wait to make sure any accidental background task would have flushed
            time.sleep(4)
            after = _count_webhook_204s()
            assert after == baseline, (
                f"Webhook fired on approve/note/edit — expected no new 204 lines, "
                f"but count went from {baseline} to {after}. "
                f"Only case creation should trigger notify_discord()."
            )
        finally:
            requests.delete(f"{API}/cases/{cid}", headers=_h(admin_token))

    def test_create_response_body_is_correct(self, detective_token, admin_token):
        """Create must return 200 with correct body regardless of webhook behaviour."""
        r = requests.post(f"{API}/cases", json={
            "name": "TEST_Regression_Body",
            "lead_investigator": "Det. Body",
            "division": "Drugs & Firearms Squad",
            "synopsis": "verify response body",
            "priority": "high-risk",
        }, headers=_h(detective_token))
        assert r.status_code == 200
        c = r.json()
        try:
            assert c["status"] == "pending"
            assert c["priority"] == "high-risk"
            assert c["name"] == "TEST_Regression_Body"
            assert c["division"] == "Drugs & Firearms Squad"
            assert c["created_by"] == "DETECTIVE"
            assert c["approved_by"] is None
            assert re.match(r"^SCC-\d{4}-\d{3,}$", c["case_id"])
            # GET to confirm persistence
            g = requests.get(f"{API}/cases/{c['id']}", headers=_h(detective_token))
            assert g.status_code == 200
            assert g.json()["case_id"] == c["case_id"]
        finally:
            requests.delete(f"{API}/cases/{c['id']}", headers=_h(admin_token))

    def test_admin_created_case_also_fires_webhook(self, admin_token):
        """Light regression: admin-created case should also fire the webhook."""
        baseline = _count_webhook_204s()
        r = requests.post(f"{API}/cases", json={
            "name": "TEST_Regression_AdminFire",
            "lead_investigator": "Det. AdminFire",
            "division": "Organised Crime Squad",
            "priority": "routine",
        }, headers=_h(admin_token))
        assert r.status_code == 200
        cid = r.json()["id"]
        assert r.json()["created_by"] == "admin"
        try:
            delta = _wait_for_new_webhooks(baseline, 1, timeout=15.0)
            assert delta >= 1, "Admin-created case did not fire Discord webhook."
        finally:
            requests.delete(f"{API}/cases/{cid}", headers=_h(admin_token))
