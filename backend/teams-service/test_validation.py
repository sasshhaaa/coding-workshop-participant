"""Unit tests for teams-service: validation, CRUD routing, and analytics.

Run from the repository root:
    pytest backend/teams-service/test_validation.py -v
"""

import importlib.util
import json
import os
import sys
from datetime import date
from decimal import Decimal

import pytest

# Every service has a module called "function", and Python caches modules by
# name — so importing normally means whichever test runs first wins and the
# rest silently get a sibling's code. Loading under a unique alias avoids it.
_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "teams_function", os.path.join(_HERE, "function.py"))
function = importlib.util.module_from_spec(_spec)
sys.modules["teams_function"] = function
_spec.loader.exec_module(function)


class FakeDB:
    """Stands in for the database so these tests need no live connection."""

    def __init__(self, existing_ids=()):
        self.existing_ids = set(existing_ids)
        self.queries = []

    def init_schema(self):
        """The handler creates tables on every call; here it's a no-op."""

    def query(self, sql, params=None, fetch="all"):
        self.queries.append((sql, params))
        if params and params[0] in self.existing_ids:
            return {"id": params[0]}
        return None


class RecordingDB(FakeDB):
    """Enough behaviour to drive the handler end to end.

    The handler runs real SQL strings, so the fake has to recognise them and
    return plausible rows rather than only answering existence checks.
    """

    def __init__(self, teams=(), existing_ids=()):
        super().__init__(existing_ids=existing_ids)
        self.teams = [dict(t) for t in teams]

    def query(self, sql, params=None, fetch="all"):
        self.queries.append((sql, params))
        text = " ".join(sql.split()).lower()

        if "create table" in text:
            return None

        if "insert into teams" in text:
            row = {
                "id": 10, "name": params[0], "location": params[1],
                "leader_id": params[2], "org_leader": params[3],
                "member_count": 0, "non_direct_count": 0,
                "non_direct_pct": 0, "leader_offsite": False,
                "leader_name": None, "leader_location": None,
                "leader_staff_type": None,
            }
            self.teams.append(row)
            return row

        if "update teams" in text:
            target = str(params[-1])
            for t in self.teams:
                if str(t["id"]) == target:
                    t["name"] = params[0]
                    t["location"] = params[1]
                    return t
            return None

        if "delete from teams" in text:
            target = str(params[0])
            for t in list(self.teams):
                if str(t["id"]) == target:
                    self.teams.remove(t)
                    return {"id": t["id"]}
            return None

        if "count(*) as c from individuals" in text:
            return {"c": 8}

        if "count(distinct location)" in text:
            return {"c": 3}

        if "from individuals" in text:
            if params and params[0] in self.existing_ids:
                return {"id": params[0]}
            return [] if fetch == "all" else None

        if "from achievements" in text:
            return []

        if "from teams" in text:
            if params:
                target = str(params[0])
                return [t for t in self.teams if str(t["id"]) == target]
            return list(self.teams)

        return [] if fetch == "all" else None


TEAM = {
    "id": 1, "name": "Platform", "location": "London",
    "leader_id": 1, "org_leader": "Anita Desai",
    "member_count": 4, "non_direct_count": 1, "non_direct_pct": 25.0,
    "leader_offsite": True, "leader_name": "Priya Raman",
    "leader_location": "Singapore", "leader_staff_type": "direct",
}


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB(existing_ids={1, 2, 3})
    monkeypatch.setattr(function, "db", fake)
    return fake


@pytest.fixture
def handler_db(monkeypatch):
    fake = RecordingDB(teams=[TEAM], existing_ids={1, 2, 3})
    monkeypatch.setattr(function, "db", fake)
    return fake


def call(method, path="/api/teams-service", body=None, record_id=None):
    event = {"httpMethod": method, "path": path}
    if body is not None:
        event["body"] = json.dumps(body)
    if record_id:
        event["pathParameters"] = {"id": str(record_id)}
    return function.handler(event)


# ---------- required fields ----------

def test_name_is_required(db):
    errors = function.validate({"name": "", "location": "London"})
    assert "name is required" in errors


def test_whitespace_only_name_is_rejected(db):
    """A name of spaces should fail the same way an empty one does."""
    errors = function.validate({"name": "   ", "location": "London"})
    assert "name is required" in errors


def test_location_is_required(db):
    errors = function.validate({"name": "Platform", "location": ""})
    assert "location is required" in errors


def test_valid_team_passes(db):
    errors = function.validate({"name": "Platform", "location": "London"})
    assert errors == []


def test_missing_fields_are_reported_together(db):
    """Both problems come back at once, not one at a time."""
    errors = function.validate({})
    assert "name is required" in errors
    assert "location is required" in errors
    assert len(errors) == 2


# ---------- references to other entities ----------

def test_existing_leader_is_accepted(db):
    errors = function.validate({
        "name": "Platform", "location": "London", "leader_id": 1})
    assert errors == []


def test_unknown_leader_is_rejected(db):
    errors = function.validate({
        "name": "Platform", "location": "London", "leader_id": 999})
    assert any("999" in e for e in errors)


def test_no_leader_is_allowed(db):
    """A team may exist before anyone leads it."""
    errors = function.validate({
        "name": "Platform", "location": "London", "leader_id": None})
    assert errors == []
    assert db.queries == [], "should not query the database for a null leader"


# ---------- response shape ----------

def test_respond_returns_lambda_shape():
    result = function.respond(201, {"id": 1})
    assert result["statusCode"] == 201
    assert result["headers"]["Content-Type"] == "application/json"
    assert isinstance(result["body"], str), "body must be a JSON string"


def test_respond_serialises_dates():
    """Postgres returns date objects; JSON has no date type."""
    result = function.respond(200, {"created_at": date(2026, 7, 23)})
    assert "2026-07-23" in result["body"]


def test_respond_serialises_decimals():
    """Numeric columns come back as Decimal, which json can't encode."""
    result = function.respond(200, {"pct": Decimal("25.0")})
    assert "25.0" in result["body"]


def test_respond_uses_the_status_code_it_is_given():
    for status in (200, 201, 204, 400, 404, 500):
        assert function.respond(status, {})["statusCode"] == status


def test_encode_rejects_types_it_cannot_handle():
    with pytest.raises(TypeError):
        function.encode(object())


# ---------- read ----------

def test_list_returns_200(handler_db):
    result = call("GET")
    assert result["statusCode"] == 200
    assert isinstance(json.loads(result["body"]), list)


def test_get_one_returns_the_team_with_members_and_achievements(handler_db):
    result = call("GET", "/api/teams-service/1", record_id=1)
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["name"] == "Platform"
    assert "members" in body
    assert "achievements" in body


def test_get_missing_team_returns_404(handler_db):
    result = call("GET", "/api/teams-service/999", record_id=999)
    assert result["statusCode"] == 404


# ---------- analytics: the seven business questions ----------

def test_analytics_returns_every_headline_metric(handler_db):
    result = call("GET", "/api/teams-service/analytics")
    assert result["statusCode"] == 200

    body = json.loads(result["body"])
    for key in (
        "total_teams", "total_people", "locations",
        "reporting_to_org_leader", "leader_not_colocated",
        "leader_non_direct", "non_direct_over_20pct", "teams",
    ):
        assert key in body, f"analytics is missing {key}"


def test_analytics_counts_a_team_over_the_threshold(handler_db):
    """Platform is at 25%, which is above the 20% limit."""
    body = json.loads(call("GET", "/api/teams-service/analytics")["body"])
    assert body["non_direct_over_20pct"] == 1


def test_analytics_counts_an_offsite_leader(handler_db):
    """Priya leads a London team from Singapore."""
    body = json.loads(call("GET", "/api/teams-service/analytics")["body"])
    assert body["leader_not_colocated"] == 1


def test_analytics_counts_teams_reporting_to_an_org_leader(handler_db):
    body = json.loads(call("GET", "/api/teams-service/analytics")["body"])
    assert body["reporting_to_org_leader"] == 1


def test_a_team_exactly_on_the_threshold_is_not_flagged(monkeypatch):
    """20% is the limit, so 20% itself is acceptable — only above counts."""
    fake = RecordingDB(
        teams=[{**TEAM, "non_direct_pct": 20.0}], existing_ids={1})
    monkeypatch.setattr(function, "db", fake)

    body = json.loads(call("GET", "/api/teams-service/analytics")["body"])
    assert body["non_direct_over_20pct"] == 0


def test_a_team_with_no_members_does_not_break_analytics(monkeypatch):
    """An empty team must not divide by zero."""
    fake = RecordingDB(teams=[{
        **TEAM, "member_count": 0, "non_direct_count": 0,
        "non_direct_pct": None, "leader_offsite": False,
        "leader_staff_type": None, "org_leader": None,
    }], existing_ids={1})
    monkeypatch.setattr(function, "db", fake)

    result = call("GET", "/api/teams-service/analytics")
    assert result["statusCode"] == 200
    assert json.loads(result["body"])["non_direct_over_20pct"] == 0


# ---------- create ----------

def test_create_returns_201(handler_db):
    result = call("POST", body={"name": "Data", "location": "Chennai"})
    assert result["statusCode"] == 201


def test_create_without_a_name_returns_400(handler_db):
    result = call("POST", body={"name": "", "location": "Chennai"})
    assert result["statusCode"] == 400


def test_create_error_lists_what_failed(handler_db):
    """The caller should be told what to fix, not just that it failed."""
    result = call("POST", body={})
    details = json.loads(result["body"])["details"]
    assert "name is required" in details
    assert "location is required" in details


def test_create_trims_surrounding_whitespace(handler_db):
    call("POST", body={"name": "  Data  ", "location": "  Chennai  "})
    insert = [q for q in handler_db.queries if "INSERT" in q[0]][-1]
    assert insert[1][0] == "Data"
    assert insert[1][1] == "Chennai"


# ---------- update ----------

def test_update_returns_200(handler_db):
    result = call("PUT", "/api/teams-service/1",
                  body={"name": "Renamed", "location": "London"}, record_id=1)
    assert result["statusCode"] == 200
    assert json.loads(result["body"])["name"] == "Renamed"


def test_update_without_an_id_returns_400(handler_db):
    result = call("PUT", body={"name": "Renamed", "location": "London"})
    assert result["statusCode"] == 400


def test_update_missing_team_returns_404(handler_db):
    result = call("PUT", "/api/teams-service/999",
                  body={"name": "Ghost", "location": "Nowhere"}, record_id=999)
    assert result["statusCode"] == 404


def test_update_still_validates(handler_db):
    result = call("PUT", "/api/teams-service/1",
                  body={"name": "", "location": "London"}, record_id=1)
    assert result["statusCode"] == 400


# ---------- delete ----------

def test_delete_returns_204(handler_db):
    result = call("DELETE", "/api/teams-service/1", record_id=1)
    assert result["statusCode"] == 204


def test_delete_missing_team_returns_404(handler_db):
    result = call("DELETE", "/api/teams-service/999", record_id=999)
    assert result["statusCode"] == 404


def test_delete_without_an_id_returns_400(handler_db):
    result = call("DELETE")
    assert result["statusCode"] == 400


# ---------- failure handling ----------

def test_database_failure_returns_500_not_a_stack_trace(monkeypatch):
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


def test_an_id_in_the_path_is_used_when_no_path_parameter_is_given(handler_db):
    """API Gateway supplies pathParameters; the local router may not."""
    result = function.handler({
        "httpMethod": "GET", "path": "/api/teams-service/1"})
    assert result["statusCode"] == 200