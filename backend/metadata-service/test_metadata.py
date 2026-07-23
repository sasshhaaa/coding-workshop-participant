"""Unit tests for metadata-service: polymorphic references and uniqueness.

Metadata attaches to either a team or an individual, so the interesting
cases are around getting the entity type right and stopping the same key
being set twice on one record.

Run from the repository root:
    pytest backend/metadata-service/test_metadata.py -v
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
    "metadata_function", os.path.join(_HERE, "function.py"))
function = importlib.util.module_from_spec(_spec)
sys.modules["metadata_function"] = function
_spec.loader.exec_module(function)


ENTRY = {
    "id": 1, "entity_type": "team", "entity_id": 1,
    "key": "cost_centre", "value": "CC-4471",
}


class FakeDB:
    """Stands in for the database so these tests need no live connection.

    The uniqueness check queries with three parameters, the existence check
    with one — so the fake tells them apart by length.
    """

    def __init__(self, rows=(), team_ids=(), individual_ids=(), taken=()):
        self.rows = [dict(r) for r in rows]
        self.team_ids = set(team_ids)
        self.individual_ids = set(individual_ids)
        # taken: {(entity_type, entity_id, key)}
        self.taken = set(taken)
        self.queries = []

    def init_schema(self):
        """The handler creates tables on every call; here it's a no-op."""

    def query(self, sql, params=None, fetch="all"):
        self.queries.append((sql, params))
        text = " ".join(sql.split()).lower()

        if "create table" in text:
            return None

        if "insert into metadata" in text:
            row = {"id": 10, "entity_type": params[0], "entity_id": params[1],
                   "key": params[2], "value": params[3]}
            self.rows.append(row)
            return row

        if "update metadata" in text:
            target = str(params[-1])
            for r in self.rows:
                if str(r["id"]) == target:
                    r.update({"entity_type": params[0], "entity_id": params[1],
                              "key": params[2], "value": params[3]})
                    return r
            return None

        if "delete from metadata" in text:
            target = str(params[0])
            for r in list(self.rows):
                if str(r["id"]) == target:
                    self.rows.remove(r)
                    return {"id": r["id"]}
            return None

        # Uniqueness check: (entity_type, entity_id, key)
        if params and len(params) == 3:
            return {"id": 99} if tuple(params) in self.taken else None

        if "from teams" in text:
            return ({"id": params[0]}
                    if params and params[0] in self.team_ids else None)

        if "from individuals" in text:
            return ({"id": params[0]}
                    if params and params[0] in self.individual_ids else None)

        if "from metadata" in text:
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
    fake = FakeDB(rows=[ENTRY], team_ids={1, 2, 3}, individual_ids={1, 2})
    monkeypatch.setattr(function, "db", fake)
    return fake


def call(method, path="/api/metadata-service", body=None, record_id=None):
    event = {"httpMethod": method, "path": path}
    if body is not None:
        event["body"] = json.dumps(body)
    if record_id:
        event["pathParameters"] = {"id": str(record_id)}
    return function.handler(event)


def entry(**overrides):
    base = {
        "entity_type": "team", "entity_id": 1,
        "key": "tech_stack", "value": "Python, K8s",
    }
    base.update(overrides)
    return base


# ---------- entity type ----------

def test_a_team_attribute_is_accepted(db):
    assert function.validate(entry(entity_type="team", entity_id=1)) == []


def test_an_individual_attribute_is_accepted(db):
    assert function.validate(
        entry(entity_type="individual", entity_id=1)) == []


def test_an_unknown_entity_type_is_rejected(db):
    errors = function.validate(entry(entity_type="department"))
    assert any("entity_type" in e for e in errors)


def test_entity_type_is_case_insensitive(db):
    """The API shouldn't care whether the caller sends 'Team' or 'team'."""
    assert function.validate(entry(entity_type="TEAM")) == []


def test_a_missing_entity_type_is_rejected(db):
    errors = function.validate(entry(entity_type=""))
    assert any("entity_type" in e for e in errors)


# ---------- references ----------

def test_entity_id_is_required(db):
    errors = function.validate(entry(entity_id=None))
    assert "entity_id is required" in errors


def test_an_unknown_team_is_rejected(db):
    errors = function.validate(entry(entity_type="team", entity_id=999))
    assert any("999" in e for e in errors)


def test_an_unknown_individual_is_rejected(db):
    errors = function.validate(entry(entity_type="individual", entity_id=999))
    assert any("999" in e for e in errors)


def test_the_right_table_is_checked_for_each_entity_type(db):
    """An id valid for a team may not be valid for a person, so the check
    has to look in the table the entity_type names."""
    fake = FakeDB(team_ids={5}, individual_ids={7})
    function.db = fake

    assert function.validate(entry(entity_type="team", entity_id=5)) == []
    assert function.validate(entry(entity_type="individual", entity_id=7)) == []
    assert function.validate(entry(entity_type="team", entity_id=7)) != []


# ---------- keys ----------

def test_key_is_required(db):
    errors = function.validate(entry(key=""))
    assert "key is required" in errors


def test_whitespace_only_key_is_rejected(db):
    errors = function.validate(entry(key="   "))
    assert "key is required" in errors


def test_an_overlong_key_is_rejected(db):
    errors = function.validate(entry(key="x" * 101))
    assert any("100 characters" in e for e in errors)


def test_a_key_at_the_limit_is_accepted(db):
    """Boundary check: 100 is allowed, 101 is not."""
    assert function.validate(entry(key="x" * 100)) == []


def test_an_empty_value_is_allowed(db):
    """Some attributes are flags — the key alone carries the meaning."""
    assert function.validate(entry(value="")) == []


# ---------- uniqueness ----------

def test_the_same_key_twice_on_one_record_is_rejected(monkeypatch):
    """A team can't have two different cost centres."""
    fake = FakeDB(team_ids={1}, taken={("team", 1, "cost_centre")})
    monkeypatch.setattr(function, "db", fake)

    errors = function.validate(entry(key="cost_centre"))
    assert any("already set" in e for e in errors)


def test_the_same_key_on_a_different_record_is_allowed(monkeypatch):
    """Every team may have its own cost centre."""
    fake = FakeDB(team_ids={1, 2}, taken={("team", 1, "cost_centre")})
    monkeypatch.setattr(function, "db", fake)

    assert function.validate(
        entry(entity_id=2, key="cost_centre")) == []


def test_the_same_key_on_a_different_entity_type_is_allowed(monkeypatch):
    """A person's cost centre is distinct from their team's."""
    fake = FakeDB(team_ids={1}, individual_ids={1},
                  taken={("team", 1, "cost_centre")})
    monkeypatch.setattr(function, "db", fake)

    assert function.validate(
        entry(entity_type="individual", key="cost_centre")) == []


def test_editing_a_record_does_not_clash_with_itself(monkeypatch):
    """Saving an entry unchanged must not report its own key as a duplicate."""
    fake = FakeDB(team_ids={1}, taken={("team", 1, "cost_centre")})
    monkeypatch.setattr(function, "db", fake)

    errors = function.validate(entry(key="cost_centre"), record_id=99)
    assert errors == []


# ---------- response shape ----------

def test_respond_is_lambda_shaped():
    result = function.respond(201, {"id": 1})
    assert result["statusCode"] == 201
    assert result["headers"]["Content-Type"] == "application/json"
    assert isinstance(result["body"], str)


# ---------- read ----------

def test_list_returns_200(db):
    assert call("GET")["statusCode"] == 200


def test_get_one_returns_200(db):
    result = call("GET", "/api/metadata-service/1", record_id=1)
    assert result["statusCode"] == 200


def test_get_missing_entry_returns_404(db):
    result = call("GET", "/api/metadata-service/999", record_id=999)
    assert result["statusCode"] == 404


def test_listing_can_be_filtered_by_entity(db):
    """The team page asks only for its own attributes."""
    result = function.handler({
        "httpMethod": "GET", "path": "/api/metadata-service",
        "queryStringParameters": {"entity_type": "team", "entity_id": "1"},
    })
    assert result["statusCode"] == 200


# ---------- create ----------

def test_create_returns_201(db):
    result = call("POST", body=entry())
    assert result["statusCode"] == 201


def test_create_without_a_key_returns_400(db):
    result = call("POST", body=entry(key=""))
    assert result["statusCode"] == 400


def test_create_error_lists_what_failed(db):
    result = call("POST", body={})
    details = json.loads(result["body"])["details"]
    assert any("key" in d for d in details)


def test_create_lowercases_the_entity_type(db):
    """Stored consistently so filtering by entity_type always matches."""
    call("POST", body=entry(entity_type="TEAM"))
    insert = [q for q in db.queries if "INSERT" in q[0]][-1]
    assert insert[1][0] == "team"


# ---------- update ----------

def test_update_returns_200(db):
    result = call("PUT", "/api/metadata-service/1",
                  body=entry(value="CC-9999"), record_id=1)
    assert result["statusCode"] == 200


def test_update_without_an_id_returns_400(db):
    result = call("PUT", body=entry())
    assert result["statusCode"] == 400


def test_update_missing_entry_returns_404(db):
    result = call("PUT", "/api/metadata-service/999",
                  body=entry(), record_id=999)
    assert result["statusCode"] == 404


# ---------- delete ----------

def test_delete_returns_204(db):
    result = call("DELETE", "/api/metadata-service/1", record_id=1)
    assert result["statusCode"] == 204


def test_delete_missing_entry_returns_404(db):
    result = call("DELETE", "/api/metadata-service/999", record_id=999)
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