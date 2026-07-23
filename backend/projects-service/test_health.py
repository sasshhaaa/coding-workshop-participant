"""Unit tests for project health, budget, timeline, and CRUD routing.

These cover the derived values the dashboard depends on. If the RAG signal
is wrong, the tool actively misleads people, so this is the logic most worth
proving correct.

Run from the repository root:
    pytest backend/projects-service/test_health.py -v
"""

import importlib.util
import json
import os
import sys
from datetime import date, timedelta

import pytest

# Every service has a module called "function", and Python caches modules by
# name — so load this one under a unique alias to avoid picking up a sibling.
_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "projects_function", os.path.join(_HERE, "function.py"))
function = importlib.util.module_from_spec(_spec)
sys.modules["projects_function"] = function
_spec.loader.exec_module(function)


def days_from_now(n):
    return date.today() + timedelta(days=n)


def project(**overrides):
    """A healthy, mid-flight project. Tests override one thing at a time."""
    base = {
        "status": "active",
        "start_date": days_from_now(-30),
        "due_date": days_from_now(60),
        "progress_pct": 50,
        "budget_planned": 10000,
        "budget_spent": 4000,
    }
    base.update(overrides)
    return base


ROW = {
    "id": 1, "team_id": 1, "name": "Customer portal",
    "description": "Rebuild", "status": "active",
    "start_date": days_from_now(-30), "due_date": days_from_now(60),
    "progress_pct": 50, "budget_planned": 10000, "budget_spent": 4000,
    "team_name": "Platform",
}


class FakeDB:
    """Stands in for the database so these tests need no live connection.

    Validation asks two different questions, so the fake has to tell them
    apart: 'does this team exist?' takes one parameter, while the duplicate
    name check takes two.
    """

    def __init__(self, existing_ids=(), taken_names=(), rows=()):
        self.existing_ids = set(existing_ids)
        self.taken_names = {(t, n.lower()) for t, n in taken_names}
        self.rows = [dict(r) for r in rows]
        self.queries = []

    def init_schema(self):
        """The handler creates tables on every call; here it's a no-op."""

    def query(self, sql, params=None, fetch="all"):
        self.queries.append((sql, params))
        text = " ".join(sql.split()).lower()

        if "create table" in text or "alter table" in text:
            return None

        if "insert into projects" in text:
            row = {**ROW, "id": 10, "team_id": params[0], "name": params[1]}
            self.rows.append(row)
            return row

        if "update projects" in text:
            target = str(params[-1])
            for r in self.rows:
                if str(r["id"]) == target:
                    r["name"] = params[1]
                    r["budget_spent"] = params[8]
                    return r
            return None

        if "delete from projects" in text:
            target = str(params[0])
            for r in list(self.rows):
                if str(r["id"]) == target:
                    self.rows.remove(r)
                    return {"id": r["id"]}
            return None

        if "from teams" in text and "join" not in text:
            return ({"id": params[0]}
                    if params and params[0] in self.existing_ids else None)

        if "from projects" in text:
            # Duplicate name check: (team_id, name)
            if params and len(params) == 2:
                key = (params[0], str(params[1]).lower())
                return {"id": 99} if key in self.taken_names else None

            if params and fetch == "one":
                target = str(params[0])
                matches = [r for r in self.rows if str(r["id"]) == target]
                return matches[0] if matches else None

            if params:
                target = str(params[0])
                return [r for r in self.rows if str(r["team_id"]) == target]

            return list(self.rows)

        return [] if fetch == "all" else None


@pytest.fixture
def db(monkeypatch):
    """Swap the real database module for the fake, per test."""
    fake = FakeDB(existing_ids={1, 2, 3})
    monkeypatch.setattr(function, "db", fake)
    return fake


@pytest.fixture
def handler_db(monkeypatch):
    fake = FakeDB(existing_ids={1, 2, 3}, rows=[ROW])
    monkeypatch.setattr(function, "db", fake)
    return fake


def call(method, path="/api/projects-service", body=None, record_id=None):
    event = {"httpMethod": method, "path": path}
    if body is not None:
        event["body"] = json.dumps(body)
    if record_id:
        event["pathParameters"] = {"id": str(record_id)}
    return function.handler(event)


def payload(**overrides):
    base = {
        "team_id": 1, "name": "Portal rebuild", "description": "",
        "status": "active", "start_date": "2026-01-01",
        "due_date": "2026-12-01", "progress_pct": 40,
        "budget_planned": 10000, "budget_spent": 3000,
    }
    base.update(overrides)
    return base


# ---------- RAG: the headline signal ----------

def test_healthy_project_is_green():
    assert function.rag_status(project()) == "green"


def test_overdue_project_is_red():
    assert function.rag_status(project(due_date=days_from_now(-1))) == "red"


def test_cancelled_project_is_red():
    assert function.rag_status(project(status="cancelled")) == "red"


def test_completed_project_is_complete_not_green():
    """Finished work shouldn't sit in the same bucket as work in flight."""
    assert function.rag_status(project(status="completed")) == "complete"


def test_completed_project_stays_complete_even_if_overdue():
    """Delivering late is still delivering — don't flag it as at risk."""
    result = function.rag_status(
        project(status="completed", due_date=days_from_now(-40)))
    assert result == "complete"


def test_on_hold_project_is_amber():
    assert function.rag_status(project(status="on_hold")) == "amber"


def test_project_due_within_the_warning_window_is_amber():
    assert function.rag_status(project(due_date=days_from_now(5))) == "amber"


def test_project_due_just_outside_the_window_is_green():
    """Boundary check: the window is 14 days, so day 15 should be clear."""
    result = function.rag_status(project(due_date=days_from_now(15)))
    assert result == "green"


def test_project_with_no_due_date_is_green():
    """No deadline means nothing to be late for."""
    assert function.rag_status(project(due_date=None)) == "green"


# ---------- RAG: the early warnings ----------

def test_project_far_behind_schedule_is_amber_before_the_deadline():
    """80% of the time gone, 20% of the work done — flag it now, not later."""
    result = function.rag_status(project(
        start_date=days_from_now(-80),
        due_date=days_from_now(20),
        progress_pct=20,
    ))
    assert result == "amber"


def test_project_slightly_behind_is_still_green():
    """A small gap is normal. Only a clear margin should raise a flag."""
    result = function.rag_status(project(
        start_date=days_from_now(-50),
        due_date=days_from_now(50),
        progress_pct=40,
    ))
    assert result == "green"


def test_overspent_project_is_red():
    result = function.rag_status(
        project(budget_planned=10000, budget_spent=12000))
    assert result == "red"


def test_burning_budget_ahead_of_progress_is_amber():
    """70% of the money for 20% of the work."""
    result = function.rag_status(project(
        progress_pct=20, budget_planned=10000, budget_spent=7000))
    assert result == "amber"


# ---------- elapsed time ----------

def test_elapsed_is_none_without_dates():
    assert function.elapsed_pct(project(start_date=None)) is None
    assert function.elapsed_pct(project(due_date=None)) is None


def test_elapsed_is_none_when_due_before_start():
    """Nonsense dates shouldn't produce a nonsense percentage."""
    result = function.elapsed_pct(project(
        start_date=days_from_now(10), due_date=days_from_now(5)))
    assert result is None


def test_elapsed_is_roughly_half_at_the_midpoint():
    result = function.elapsed_pct(project(
        start_date=days_from_now(-50), due_date=days_from_now(50)))
    assert 48 <= result <= 52


def test_elapsed_never_exceeds_one_hundred():
    """An overdue project is 100% elapsed, not 300%."""
    result = function.elapsed_pct(project(
        start_date=days_from_now(-300), due_date=days_from_now(-100)))
    assert result == 100


def test_elapsed_is_never_negative():
    """A project that hasn't started yet is at 0, not below it."""
    result = function.elapsed_pct(project(
        start_date=days_from_now(10), due_date=days_from_now(100)))
    assert result == 0


# ---------- budget ----------

def test_budget_pct_is_none_when_nothing_planned():
    """Dividing by a zero budget must not crash the endpoint."""
    assert function.budget_pct(project(budget_planned=0)) is None


def test_budget_pct_is_calculated_correctly():
    result = function.budget_pct(project(budget_planned=10000, budget_spent=2500))
    assert result == 25


def test_budget_pct_can_exceed_one_hundred():
    """Overspend should be visible, not clipped."""
    result = function.budget_pct(project(budget_planned=1000, budget_spent=1500))
    assert result == 150


def test_to_money_handles_junk():
    assert function.to_money(None) == 0.0
    assert function.to_money("") == 0.0
    assert function.to_money("not a number") == 0.0
    assert function.to_money("1500.5") == 1500.5


# ---------- decorate: what the API actually returns ----------

def test_decorate_adds_every_derived_field():
    row = function.decorate([dict(ROW)])[0]
    for key in ("rag", "elapsed_pct", "budget_pct",
                "budget_remaining", "over_budget", "overdue"):
        assert key in row, f"decorate is missing {key}"


def test_decorate_reports_money_left():
    row = function.decorate([{**ROW, "budget_planned": 10000,
                              "budget_spent": 4000}])[0]
    assert row["budget_remaining"] == 6000
    assert row["over_budget"] is False


def test_decorate_flags_an_overspend():
    row = function.decorate([{**ROW, "budget_planned": 1000,
                              "budget_spent": 1500}])[0]
    assert row["over_budget"] is True
    assert row["budget_remaining"] == -500


def test_decorate_does_not_flag_a_zero_budget_as_overspent():
    """No budget set is not the same as having overspent."""
    row = function.decorate([{**ROW, "budget_planned": 0,
                              "budget_spent": 0}])[0]
    assert row["over_budget"] is False


def test_a_completed_project_is_not_marked_overdue():
    row = function.decorate([{**ROW, "status": "completed",
                              "due_date": days_from_now(-30)}])[0]
    assert row["overdue"] is False


# ---------- validation ----------

def test_name_is_required(db):
    errors = function.validate({"name": "", "team_id": 1})
    assert "name is required" in errors


def test_team_id_is_required(db):
    errors = function.validate({"name": "Portal"})
    assert "team_id is required" in errors


def test_unknown_team_is_rejected(db):
    errors = function.validate({"name": "Portal", "team_id": 999})
    assert any("999" in e for e in errors)


def test_invalid_status_is_rejected(db):
    errors = function.validate({
        "name": "Portal", "team_id": 1, "status": "nonsense"})
    assert any("status" in e for e in errors)


def test_every_documented_status_is_accepted(db):
    for status in ("planning", "active", "on_hold", "completed", "cancelled"):
        errors = function.validate({
            "name": "Portal", "team_id": 1, "status": status})
        assert errors == [], status


def test_due_date_before_start_date_is_rejected(db):
    errors = function.validate({
        "name": "Portal", "team_id": 1,
        "start_date": "2026-06-01", "due_date": "2026-05-01",
    })
    assert any("due date" in e.lower() for e in errors)


def test_same_start_and_due_date_is_allowed(db):
    """A one-day project is unusual, not invalid."""
    errors = function.validate({
        "name": "Portal", "team_id": 1,
        "start_date": "2026-06-01", "due_date": "2026-06-01",
    })
    assert errors == []


def test_progress_above_one_hundred_is_rejected(db):
    errors = function.validate({
        "name": "Portal", "team_id": 1, "progress_pct": 150})
    assert any("progress" in e for e in errors)


def test_negative_progress_is_rejected(db):
    errors = function.validate({
        "name": "Portal", "team_id": 1, "progress_pct": -10})
    assert any("progress" in e for e in errors)


def test_negative_budget_is_rejected(db):
    errors = function.validate({
        "name": "Portal", "team_id": 1, "budget_spent": -50})
    assert any("budget spent" in e for e in errors)


def test_valid_project_passes(db):
    errors = function.validate({
        "name": "Portal", "team_id": 1, "status": "active",
        "start_date": "2026-01-01", "due_date": "2026-12-01",
        "progress_pct": 40, "budget_planned": 10000, "budget_spent": 3000,
    })
    assert errors == []


def test_duplicate_project_name_on_the_same_team_is_rejected(monkeypatch):
    """Two projects called 'Portal' on one team would be ambiguous."""
    fake = FakeDB(existing_ids={1}, taken_names={(1, "Portal")})
    monkeypatch.setattr(function, "db", fake)

    errors = function.validate({"name": "Portal", "team_id": 1})
    assert any("already has a project" in e for e in errors)


def test_same_name_on_a_different_team_is_allowed(monkeypatch):
    """Two teams may each run their own 'Migration' project."""
    fake = FakeDB(existing_ids={1, 2}, taken_names={(1, "Portal")})
    monkeypatch.setattr(function, "db", fake)

    errors = function.validate({"name": "Portal", "team_id": 2})
    assert errors == []


def test_editing_a_project_does_not_clash_with_its_own_name(monkeypatch):
    """Saving unchanged must not report the project's own name as a duplicate."""
    fake = FakeDB(existing_ids={1}, taken_names={(1, "Portal")})
    monkeypatch.setattr(function, "db", fake)

    errors = function.validate({"name": "Portal", "team_id": 1}, record_id=99)
    assert errors == []


# ---------- date parsing ----------

def test_parse_date_accepts_iso():
    assert function.parse_date("2026-07-23") == date(2026, 7, 23)


def test_parse_date_accepts_a_timestamp():
    """Postgres returns timestamps; only the date part matters here."""
    assert function.parse_date("2026-07-23T10:30:00") == date(2026, 7, 23)


def test_parse_date_rejects_nonsense():
    assert function.parse_date("not a date") is None
    assert function.parse_date("") is None
    assert function.parse_date(None) is None


# ---------- read ----------

def test_list_returns_200(handler_db):
    result = call("GET")
    assert result["statusCode"] == 200


def test_listed_projects_carry_their_derived_fields(handler_db):
    body = json.loads(call("GET")["body"])
    assert body and "rag" in body[0]


def test_get_one_returns_200(handler_db):
    result = call("GET", "/api/projects-service/1", record_id=1)
    assert result["statusCode"] == 200


def test_get_missing_project_returns_404(handler_db):
    result = call("GET", "/api/projects-service/999", record_id=999)
    assert result["statusCode"] == 404


def test_listing_can_be_filtered_by_team(handler_db):
    result = function.handler({
        "httpMethod": "GET", "path": "/api/projects-service",
        "queryStringParameters": {"team_id": "1"},
    })
    assert result["statusCode"] == 200


# ---------- create ----------

def test_create_returns_201(handler_db):
    result = call("POST", body=payload())
    assert result["statusCode"] == 201


def test_create_without_a_name_returns_400(handler_db):
    result = call("POST", body=payload(name=""))
    assert result["statusCode"] == 400


def test_create_error_lists_what_failed(handler_db):
    result = call("POST", body={})
    details = json.loads(result["body"])["details"]
    assert "name is required" in details


# ---------- update ----------

def test_update_returns_200(handler_db):
    result = call("PUT", "/api/projects-service/1",
                  body=payload(name="Renamed"), record_id=1)
    assert result["statusCode"] == 200


def test_update_without_an_id_returns_400(handler_db):
    result = call("PUT", body=payload())
    assert result["statusCode"] == 400


def test_update_missing_project_returns_404(handler_db):
    result = call("PUT", "/api/projects-service/999",
                  body=payload(), record_id=999)
    assert result["statusCode"] == 404


def test_update_still_validates(handler_db):
    result = call("PUT", "/api/projects-service/1",
                  body=payload(name=""), record_id=1)
    assert result["statusCode"] == 400


# ---------- delete ----------

def test_delete_returns_204(handler_db):
    result = call("DELETE", "/api/projects-service/1", record_id=1)
    assert result["statusCode"] == 204


def test_delete_missing_project_returns_404(handler_db):
    result = call("DELETE", "/api/projects-service/999", record_id=999)
    assert result["statusCode"] == 404


def test_delete_without_an_id_returns_400(handler_db):
    result = call("DELETE")
    assert result["statusCode"] == 400


# ---------- failure handling ----------

def test_database_failure_returns_500(monkeypatch):
    """A crash must return a clean error rather than leaking internals."""
    class BrokenDB:
        def init_schema(self):
            pass

        def query(self, *args, **kwargs):
            raise RuntimeError("connection lost")

    monkeypatch.setattr(function, "db", BrokenDB())
    result = call("GET")
    assert result["statusCode"] == 500