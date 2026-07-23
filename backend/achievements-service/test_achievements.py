"""Unit tests for achievements-service: validation, month handling, and CRUD.

Run from the repository root:
    pytest backend/achievements-service/test_achievements.py -v
"""

import importlib.util
import json
import os
import sys
from datetime import date

import pytest

# Every service has a module called "function", and Python caches modules by
# name — so load this one under a unique alias to avoid picking up a sibling.
_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "achievements_function", os.path.join(_HERE, "function.py"))
function = importlib.util.module_from_spec(_spec)
sys.modules["achievements_function"] = function
_spec.loader.exec_module(function)


ACHIEVEMENT = {
    "id": 1, "team_id": 1, "title": "Cut deploy time by half",
    "description": "Pipeline rebuild", "month": date(2026, 3, 1),
    "impact": "high", "team_name": "Platform",
}


class FakeDB:
    """Stands in for the database so these tests need no live connection."""

    def __init__(self, rows=(), team_ids=()):
        self.rows = [dict(r) for r in rows]
        self.team_ids = set(team_ids)
        self.queries = []

    def init_schema(self):
        """The handler creates tables on every call; here it's a no-op."""

    def query(self, sql, params=None, fetch="all"):
        self.queries.append((sql, params))
        text = " ".join(sql.split()).lower()

        if "create table" in text:
            return None

        if "insert into achievements" in text:
            row = {**ACHIEVEMENT, "id": 10, "team_id": params[0],
                   "title": params[1], "month": params[3], "impact": params[4]}
            self.rows.append(row)
            return row

        if "update achievements" in text:
            target = str(params[-1])
            for r in self.rows:
                if str(r["id"]) == target:
                    r["title"] = params[1]
                    r["impact"] = params[4]
                    return r
            return None

        if "delete from achievements" in text:
            target = str(params[0])
            for r in list(self.rows):
                if str(r["id"]) == target:
                    self.rows.remove(r)
                    return {"id": r["id"]}
            return None

        # Existence check on a team, used when validating team_id.
        if "from teams" in text:
            if params and params[0] in self.team_ids:
                return {"id": params[0]}
            return None

        if "from achievements" in text:
            if params:
                target = str(params[0])
                matches = [r for r in self.rows if str(r["id"]) == target]
                if fetch == "one":
                    return matches[0] if matches else None
                return matches
            return list(self.rows)

        return [] if fetch == "all" else None


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB(rows=[ACHIEVEMENT], team_ids={1, 2, 3})
    monkeypatch.setattr(function, "db", fake)
    return fake


def call(method, path="/api/achievements-service", body=None, record_id=None):
    event = {"httpMethod": method, "path": path}
    if body is not None:
        event["body"] = json.dumps(body)
    if record_id:
        event["pathParameters"] = {"id": str(record_id)}
    return function.handler(event)


def achievement(**overrides):
    base = {
        "team_id": 1, "title": "Shipped the new dashboard",
        "description": "Delivered ahead of schedule",
        "month": "2026-07", "impact": "medium",
    }
    base.update(overrides)
    return base


# ---------- month normalisation ----------

def test_a_year_month_becomes_the_first_of_that_month():
    """The form sends YYYY-MM; storing day 1 keeps months comparable."""
    assert function.normalise_month("2026-07") == date(2026, 7, 1)


def test_a_full_date_is_snapped_to_the_first_of_the_month():
    """Two achievements in the same month must land in the same bucket."""
    assert function.normalise_month("2026-07-23") == date(2026, 7, 1)


def test_a_timestamp_is_accepted():
    """Postgres returns timestamps when a row is read back."""
    assert function.normalise_month("2026-07-23T10:30:00") == date(2026, 7, 1)


def test_nonsense_months_are_rejected():
    assert function.normalise_month("not a month") is None
    assert function.normalise_month("") is None
    assert function.normalise_month(None) is None


def test_an_impossible_date_is_rejected():
    """There is no 31st of February."""
    assert function.normalise_month("2026-02-31") is None


# ---------- validation ----------

def test_title_is_required(db):
    errors = function.validate(achievement(title=""))
    assert "title is required" in errors


def test_whitespace_only_title_is_rejected(db):
    errors = function.validate(achievement(title="   "))
    assert "title is required" in errors


def test_team_id_is_required(db):
    errors = function.validate(achievement(team_id=None))
    assert "team_id is required" in errors


def test_unknown_team_is_rejected(db):
    errors = function.validate(achievement(team_id=999))
    assert any("999" in e for e in errors)


def test_month_is_required(db):
    errors = function.validate(achievement(month=""))
    assert any("month" in e for e in errors)


def test_a_malformed_month_is_rejected(db):
    errors = function.validate(achievement(month="July 2026"))
    assert any("month" in e for e in errors)


def test_an_unknown_impact_is_rejected(db):
    errors = function.validate(achievement(impact="enormous"))
    assert any("impact" in e for e in errors)


def test_every_documented_impact_is_accepted(db):
    for impact in ("low", "medium", "high"):
        assert function.validate(achievement(impact=impact)) == [], impact


def test_impact_defaults_to_medium_when_absent(db):
    data = achievement()
    del data["impact"]
    assert function.validate(data) == []


def test_valid_achievement_passes(db):
    assert function.validate(achievement()) == []


def test_all_problems_are_reported_at_once(db):
    errors = function.validate({})
    assert len(errors) >= 3


# ---------- response shape ----------

def test_respond_is_lambda_shaped():
    result = function.respond(201, {"id": 1})
    assert result["statusCode"] == 201
    assert result["headers"]["Content-Type"] == "application/json"
    assert isinstance(result["body"], str)


def test_respond_serialises_dates():
    """Postgres returns date objects; JSON has no date type."""
    result = function.respond(200, {"month": date(2026, 3, 1)})
    assert "2026-03-01" in result["body"]


# ---------- read ----------

def test_list_returns_200(db):
    result = call("GET")
    assert result["statusCode"] == 200


def test_get_one_returns_200(db):
    result = call("GET", "/api/achievements-service/1", record_id=1)
    assert result["statusCode"] == 200


def test_get_missing_achievement_returns_404(db):
    result = call("GET", "/api/achievements-service/999", record_id=999)
    assert result["statusCode"] == 404


def test_listing_can_be_filtered_by_team(db):
    result = function.handler({
        "httpMethod": "GET", "path": "/api/achievements-service",
        "queryStringParameters": {"team_id": "1"},
    })
    assert result["statusCode"] == 200
    assert any("team_id" in str(q[0]).lower() for q in db.queries)


def test_listing_can_be_filtered_by_impact(db):
    result = function.handler({
        "httpMethod": "GET", "path": "/api/achievements-service",
        "queryStringParameters": {"impact": "high"},
    })
    assert result["statusCode"] == 200


# ---------- create ----------

def test_create_returns_201(db):
    result = call("POST", body=achievement())
    assert result["statusCode"] == 201


def test_create_without_a_title_returns_400(db):
    result = call("POST", body=achievement(title=""))
    assert result["statusCode"] == 400


def test_create_error_lists_what_failed(db):
    result = call("POST", body={})
    details = json.loads(result["body"])["details"]
    assert "title is required" in details


def test_create_stores_the_month_as_a_date(db):
    """The form sends a string; the column is a DATE."""
    call("POST", body=achievement(month="2026-07"))
    insert = [q for q in db.queries if "INSERT" in q[0]][-1]
    assert insert[1][3] == date(2026, 7, 1)


# ---------- update ----------

def test_update_returns_200(db):
    result = call("PUT", "/api/achievements-service/1",
                  body=achievement(title="Renamed"), record_id=1)
    assert result["statusCode"] == 200


def test_update_without_an_id_returns_400(db):
    result = call("PUT", body=achievement())
    assert result["statusCode"] == 400


def test_update_missing_achievement_returns_404(db):
    result = call("PUT", "/api/achievements-service/999",
                  body=achievement(), record_id=999)
    assert result["statusCode"] == 404


def test_update_still_validates(db):
    result = call("PUT", "/api/achievements-service/1",
                  body=achievement(title=""), record_id=1)
    assert result["statusCode"] == 400


# ---------- delete ----------

def test_delete_returns_204(db):
    result = call("DELETE", "/api/achievements-service/1", record_id=1)
    assert result["statusCode"] == 204


def test_delete_missing_achievement_returns_404(db):
    result = call("DELETE", "/api/achievements-service/999", record_id=999)
    assert result["statusCode"] == 404


def test_delete_without_an_id_returns_400(db):
    result = call("DELETE")
    assert result["statusCode"] == 400


# ---------- failure handling ----------

def test_unsupported_method_is_rejected(db):
    result = call("PATCH")
    assert result["statusCode"] in (404, 405)


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
    assert "error" in json.loads(result["body"])