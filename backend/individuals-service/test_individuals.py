"""Unit tests for individuals-service: validation and CRUD routing.

Run from the repository root:
    pytest backend/individuals-service/test_individuals.py -v
"""

import importlib.util
import json
import os
import sys

import pytest

# Every service has a module called "function", and Python caches modules by
# name — so load this one under a unique alias to avoid picking up a sibling.
_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "individuals_function", os.path.join(_HERE, "function.py"))
function = importlib.util.module_from_spec(_spec)
sys.modules["individuals_function"] = function
_spec.loader.exec_module(function)


PERSON = {
    "id": 1, "name": "Priya Raman", "email": "priya@acme.com",
    "role": "Engineering manager", "level": "lead", "staff_type": "direct",
    "location": "Singapore", "team_id": 1, "team_name": "Platform",
}


class FakeDB:
    """Stands in for the database so these tests need no live connection.

    Queries are matched on the SQL text, so the fake behaves differently for
    an existence check than for an insert or a listing. A missing row returns
    None, exactly as the real driver does — that's what the 404 checks read.
    """

    def __init__(self, people=(), team_ids=(), taken_emails=()):
        self.people = [dict(p) for p in people]
        self.team_ids = set(team_ids)
        self.taken_emails = {e.lower() for e in taken_emails}
        self.queries = []

    def init_schema(self):
        """The handler creates tables on every call; here it's a no-op."""

    def query(self, sql, params=None, fetch="all"):
        self.queries.append((sql, params))
        text = " ".join(sql.split()).lower()

        if "create table" in text:
            return None

        if "insert into individuals" in text:
            row = {**PERSON, "id": 10, "name": params[0], "email": params[1]}
            self.people.append(row)
            return row

        if "update individuals" in text:
            target = str(params[-1])
            for p in self.people:
                if str(p["id"]) == target:
                    p["name"] = params[0]
                    return p
            return None

        if "delete from individuals" in text:
            target = str(params[0])
            for p in list(self.people):
                if str(p["id"]) == target:
                    self.people.remove(p)
                    return {"id": p["id"]}
            return None

        # Existence check on a team, used when validating team_id.
        if "from teams" in text:
            if params and params[0] in self.team_ids:
                return {"id": params[0]}
            return None

        # Duplicate email check.
        if params and isinstance(params[0], str) and "@" in str(params[0]):
            email = str(params[0]).lower()
            return {"id": 99} if email in self.taken_emails else None

        if "from individuals" in text:
            if params:
                target = str(params[0])
                matches = [p for p in self.people if str(p["id"]) == target]
                if fetch == "one":
                    return matches[0] if matches else None
                return matches
            return list(self.people)

        return [] if fetch == "all" else None


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB(people=[PERSON], team_ids={1, 2, 3})
    monkeypatch.setattr(function, "db", fake)
    return fake


def call(method, path="/api/individuals-service", body=None, record_id=None):
    event = {"httpMethod": method, "path": path}
    if body is not None:
        event["body"] = json.dumps(body)
    if record_id:
        event["pathParameters"] = {"id": str(record_id)}
    return function.handler(event)


def person(**overrides):
    base = {
        "name": "Tom Okafor", "email": "tom@acme.com", "role": "Backend engineer",
        "level": "member", "staff_type": "direct", "location": "London",
        "team_id": 1,
    }
    base.update(overrides)
    return base


# ---------- required fields ----------

def test_name_is_required(db):
    errors = function.validate(person(name=""))
    assert any("name" in e.lower() for e in errors)


def test_email_is_required(db):
    errors = function.validate(person(email=""))
    assert any("email" in e.lower() for e in errors)


def test_location_is_required(db):
    errors = function.validate(person(location=""))
    assert any("location" in e.lower() for e in errors)


def test_valid_person_passes(db):
    assert function.validate(person()) == []


def test_whitespace_only_name_is_rejected(db):
    errors = function.validate(person(name="   "))
    assert any("name" in e.lower() for e in errors)


# ---------- references ----------

def test_unknown_team_is_rejected(db):
    errors = function.validate(person(team_id=999))
    assert any("999" in e for e in errors)


def test_existing_team_is_accepted(db):
    assert function.validate(person(team_id=2)) == []


# ---------- response shape ----------

def test_respond_is_lambda_shaped():
    result = function.respond(201, {"id": 1})
    assert result["statusCode"] == 201
    assert result["headers"]["Content-Type"] == "application/json"
    assert isinstance(result["body"], str)


def test_respond_uses_the_status_code_it_is_given():
    for status in (200, 201, 204, 400, 404, 500):
        assert function.respond(status, {})["statusCode"] == status


# ---------- read ----------

def test_list_returns_200(db):
    result = call("GET")
    assert result["statusCode"] == 200


def test_get_one_returns_200(db):
    result = call("GET", "/api/individuals-service/1", record_id=1)
    assert result["statusCode"] == 200


def test_get_missing_person_returns_404(db):
    result = call("GET", "/api/individuals-service/999", record_id=999)
    assert result["statusCode"] == 404


# ---------- create ----------

def test_create_returns_201(db):
    result = call("POST", body=person())
    assert result["statusCode"] == 201


def test_create_without_a_name_returns_400(db):
    result = call("POST", body=person(name=""))
    assert result["statusCode"] == 400


def test_create_error_names_the_failing_field(db):
    result = call("POST", body=person(name="", email=""))
    details = json.loads(result["body"])["details"]
    assert any("name" in d.lower() for d in details)


# ---------- update ----------

def test_update_returns_200(db):
    result = call("PUT", "/api/individuals-service/1",
                  body=person(name="Renamed"), record_id=1)
    assert result["statusCode"] == 200


def test_update_without_an_id_returns_400(db):
    result = call("PUT", body=person())
    assert result["statusCode"] == 400


def test_update_missing_person_returns_404(db):
    result = call("PUT", "/api/individuals-service/999",
                  body=person(), record_id=999)
    assert result["statusCode"] == 404


def test_update_still_validates(db):
    result = call("PUT", "/api/individuals-service/1",
                  body=person(name=""), record_id=1)
    assert result["statusCode"] == 400


# ---------- delete ----------

def test_delete_returns_204(db):
    result = call("DELETE", "/api/individuals-service/1", record_id=1)
    assert result["statusCode"] == 204


def test_delete_missing_person_returns_404(db):
    result = call("DELETE", "/api/individuals-service/999", record_id=999)
    assert result["statusCode"] == 404


def test_delete_without_an_id_returns_400(db):
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
    assert "error" in json.loads(result["body"])