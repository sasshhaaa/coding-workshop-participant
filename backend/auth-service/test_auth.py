"""Unit tests for password hashing, JWT handling, and auth endpoints.

Security logic fails silently — a broken hash comparison still returns a
boolean. These tests exist to prove the guarantees actually hold.

Run from the repository root:
    pytest backend/auth-service/test_auth.py -v
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
    "auth_function", os.path.join(_HERE, "function.py"))
function = importlib.util.module_from_spec(_spec)
sys.modules["auth_function"] = function
_spec.loader.exec_module(function)


class FakeDB:
    """Stands in for the database so these tests need no live connection."""

    def __init__(self, users=(), user_count=1):
        self.users = {u["email"].lower(): u for u in users}
        self.user_count = user_count

    def query(self, sql, params=None, fetch="all"):
        if "COUNT(*)" in sql:
            return {"c": self.user_count}
        if params:
            return self.users.get(str(params[0]).lower())
        return None


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB()
    monkeypatch.setattr(function, "db", fake)
    return fake


def user(**overrides):
    base = {"id": 1, "email": "sasha@acme.com", "name": "Sasha", "role": "admin"}
    base.update(overrides)
    return base


def signed_in(role="admin", user_id=1):
    return {"Authorization": f"Bearer {function.make_token(user(id=user_id, role=role))}"}


# ---------- password hashing ----------

def test_password_is_never_stored_in_plain_text():
    stored = function.hash_password("workshop123")
    assert "workshop123" not in stored


def test_correct_password_verifies():
    stored = function.hash_password("workshop123")
    assert function.verify_password("workshop123", stored) is True


def test_wrong_password_is_rejected():
    stored = function.hash_password("workshop123")
    assert function.verify_password("wrongpassword", stored) is False


def test_same_password_hashes_differently_each_time():
    """A per-user salt means identical passwords don't share a hash, so a
    leaked database can't be attacked with a single rainbow table."""
    first = function.hash_password("workshop123")
    second = function.hash_password("workshop123")
    assert first != second
    assert function.verify_password("workshop123", first)
    assert function.verify_password("workshop123", second)


def test_hash_records_its_own_parameters():
    """Storing the algorithm and round count means they can be raised later
    without invalidating existing passwords."""
    stored = function.hash_password("workshop123")
    algorithm, rounds, salt, digest = stored.split("$")
    assert algorithm == "pbkdf2"
    assert int(rounds) >= 100_000
    assert len(salt) == 32
    assert len(digest) == 64


def test_malformed_hash_is_rejected_rather_than_crashing():
    """A corrupted row must deny access, not raise."""
    assert function.verify_password("anything", "") is False
    assert function.verify_password("anything", None) is False
    assert function.verify_password("anything", "garbage") is False
    assert function.verify_password("anything", "pbkdf2$broken") is False


# ---------- tokens ----------

def test_token_round_trips():
    token = function.make_token(user())
    claims = function.read_token(token)
    assert claims["sub"] == 1
    assert claims["email"] == "sasha@acme.com"
    assert claims["role"] == "admin"


def test_token_never_contains_the_password_hash():
    """Payloads are base64, not encryption — anyone can read them."""
    token = function.make_token(user(password_hash="pbkdf2$secret"))
    assert "secret" not in token


def test_tampered_payload_is_rejected():
    """The whole point of the signature: escalating your own role must fail."""
    header, payload, signature = function.make_token(user(role="viewer")).split(".")

    claims = json.loads(function.unb64(payload))
    claims["role"] = "admin"
    forged = function.b64(json.dumps(claims).encode())

    assert function.read_token(f"{header}.{forged}.{signature}") is None


def test_token_signed_with_another_secret_is_rejected(monkeypatch):
    token = function.make_token(user())
    monkeypatch.setattr(function, "JWT_SECRET", "a-different-secret")
    assert function.read_token(token) is None


def test_expired_token_is_rejected(monkeypatch):
    monkeypatch.setattr(function, "TOKEN_HOURS", -1)
    token = function.make_token(user())
    assert function.read_token(token) is None


def test_malformed_token_is_rejected():
    assert function.read_token("") is None
    assert function.read_token(None) is None
    assert function.read_token("not.a.token") is None
    assert function.read_token("onlyonepart") is None


# ---------- one-time codes ----------

def test_code_is_hashed_before_storage():
    """A leaked database shouldn't hand over live sign-in codes."""
    hashed = function.hash_code("483920")
    assert hashed != "483920"
    assert len(hashed) == 64


def test_code_hashing_is_deterministic():
    assert function.hash_code("483920") == function.hash_code("483920")


def test_different_codes_hash_differently():
    assert function.hash_code("111111") != function.hash_code("222222")


# ---------- registration validation ----------

def test_email_is_required(db):
    errors = function.validate_registration({"name": "Sasha", "password": "workshop123"})
    assert "email is required" in errors


def test_malformed_email_is_rejected(db):
    errors = function.validate_registration({
        "email": "not-an-email", "name": "Sasha", "password": "workshop123"})
    assert any("valid address" in e for e in errors)


def test_name_is_required(db):
    errors = function.validate_registration({
        "email": "a@b.com", "name": "", "password": "workshop123"})
    assert "name is required" in errors


def test_short_password_is_rejected(db):
    errors = function.validate_registration({
        "email": "a@b.com", "name": "Sasha", "password": "short"})
    assert any("8 characters" in e for e in errors)


def test_duplicate_email_is_rejected(monkeypatch):
    fake = FakeDB(users=[{"id": 1, "email": "sasha@acme.com"}])
    monkeypatch.setattr(function, "db", fake)

    errors = function.validate_registration({
        "email": "sasha@acme.com", "name": "Sasha", "password": "workshop123"})
    assert any("already exists" in e for e in errors)


def test_valid_registration_passes(db):
    errors = function.validate_registration({
        "email": "new@acme.com", "name": "New Person", "password": "workshop123"})
    assert errors == []


# ---------- login ----------

def test_login_with_unknown_email_gives_the_same_message_as_a_wrong_password(monkeypatch):
    """Different messages would let anyone enumerate which staff have accounts."""
    stored = function.hash_password("workshop123")
    fake = FakeDB(users=[{
        "id": 1, "email": "sasha@acme.com", "name": "Sasha",
        "role": "admin", "password_hash": stored,
    }])
    monkeypatch.setattr(function, "db", fake)
    monkeypatch.setattr(function, "ensure_schema", lambda: None)

    unknown = function.handler({
        "httpMethod": "POST", "path": "/api/auth-service/login",
        "body": json.dumps({"email": "nobody@acme.com", "password": "workshop123"}),
    })
    wrong = function.handler({
        "httpMethod": "POST", "path": "/api/auth-service/login",
        "body": json.dumps({"email": "sasha@acme.com", "password": "wrong"}),
    })

    assert unknown["statusCode"] == wrong["statusCode"] == 401
    assert unknown["body"] == wrong["body"]


def test_correct_login_returns_a_token(monkeypatch):
    stored = function.hash_password("workshop123")
    fake = FakeDB(users=[{
        "id": 1, "email": "sasha@acme.com", "name": "Sasha",
        "role": "admin", "password_hash": stored,
    }])
    monkeypatch.setattr(function, "db", fake)
    monkeypatch.setattr(function, "ensure_schema", lambda: None)

    result = function.handler({
        "httpMethod": "POST", "path": "/api/auth-service/login",
        "body": json.dumps({"email": "sasha@acme.com", "password": "workshop123"}),
    })

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert function.read_token(body["token"])["role"] == "admin"
    assert "password_hash" not in body["user"]


def test_login_without_credentials_returns_400(monkeypatch):
    monkeypatch.setattr(function, "db", FakeDB())
    monkeypatch.setattr(function, "ensure_schema", lambda: None)

    result = function.handler({
        "httpMethod": "POST", "path": "/api/auth-service/login",
        "body": json.dumps({"email": "", "password": ""}),
    })
    assert result["statusCode"] == 400


def test_me_without_a_token_returns_401(monkeypatch):
    monkeypatch.setattr(function, "ensure_schema", lambda: None)
    result = function.handler({
        "httpMethod": "GET", "path": "/api/auth-service/me"})
    assert result["statusCode"] == 401


def test_me_returns_the_signed_in_user(monkeypatch):
    monkeypatch.setattr(function, "ensure_schema", lambda: None)
    result = function.handler({
        "httpMethod": "GET", "path": "/api/auth-service/me",
        "headers": signed_in("manager"),
    })
    assert result["statusCode"] == 200
    assert json.loads(result["body"])["role"] == "manager"


def test_listing_users_as_a_viewer_returns_403(monkeypatch):
    monkeypatch.setattr(function, "ensure_schema", lambda: None)
    result = function.handler({
        "httpMethod": "GET", "path": "/api/auth-service",
        "headers": signed_in("viewer"),
    })
    assert result["statusCode"] == 403


def test_public_never_leaks_the_password_hash():
    safe = function.public({
        "id": 1, "email": "a@b.com", "name": "A", "role": "admin",
        "password_hash": "pbkdf2$secret",
    })
    assert "password_hash" not in safe


# ---------- one-time code endpoints ----------
# Functional but not surfaced in the UI, since no email provider is
# configured. Tested because unexposed code still ships.

def test_requesting_a_code_for_an_unknown_address_looks_identical(monkeypatch):
    """Differing replies would let anyone enumerate which staff have accounts."""
    fake = FakeDB(users=[{
        "id": 1, "email": "sasha@acme.com", "name": "Sasha",
        "role": "admin", "password_hash": "x",
    }])
    monkeypatch.setattr(function, "db", fake)
    monkeypatch.setattr(function, "ensure_schema", lambda: None)

    known = function.handler({
        "httpMethod": "POST", "path": "/api/auth-service/request-code",
        "body": json.dumps({"email": "sasha@acme.com"}),
    })
    unknown = function.handler({
        "httpMethod": "POST", "path": "/api/auth-service/request-code",
        "body": json.dumps({"email": "nobody@acme.com"}),
    })

    assert known["statusCode"] == unknown["statusCode"] == 200
    assert known["body"] == unknown["body"]


def test_requesting_a_code_with_a_malformed_address_returns_400(monkeypatch):
    monkeypatch.setattr(function, "ensure_schema", lambda: None)
    result = function.handler({
        "httpMethod": "POST", "path": "/api/auth-service/request-code",
        "body": json.dumps({"email": "not-an-email"}),
    })
    assert result["statusCode"] == 400


def test_verifying_without_a_code_returns_400(monkeypatch):
    monkeypatch.setattr(function, "ensure_schema", lambda: None)
    result = function.handler({
        "httpMethod": "POST", "path": "/api/auth-service/verify-code",
        "body": json.dumps({"email": "sasha@acme.com"}),
    })
    assert result["statusCode"] == 400


def test_verifying_with_no_outstanding_code_returns_401(monkeypatch):
    """Nothing pending means nothing to verify against."""
    class NoCodesDB(FakeDB):
        def query(self, sql, params=None, fetch="all"):
            if "login_codes" in sql:
                return None
            return super().query(sql, params, fetch)

    monkeypatch.setattr(function, "db", NoCodesDB())
    monkeypatch.setattr(function, "ensure_schema", lambda: None)

    result = function.handler({
        "httpMethod": "POST", "path": "/api/auth-service/verify-code",
        "body": json.dumps({"email": "sasha@acme.com", "code": "123456"}),
    })
    assert result["statusCode"] == 401


def test_too_many_attempts_returns_429(monkeypatch):
    """Six digits is a million combinations — without a lockout that's
    brute-forceable in minutes."""
    class ExhaustedDB(FakeDB):
        def query(self, sql, params=None, fetch="all"):
            if "login_codes" in sql:
                return {"id": 1, "email": "sasha@acme.com",
                        "code_hash": "x", "attempts": 5, "used": False}
            return super().query(sql, params, fetch)

    monkeypatch.setattr(function, "db", ExhaustedDB())
    monkeypatch.setattr(function, "ensure_schema", lambda: None)

    result = function.handler({
        "httpMethod": "POST", "path": "/api/auth-service/verify-code",
        "body": json.dumps({"email": "sasha@acme.com", "code": "123456"}),
    })
    assert result["statusCode"] == 429


def test_a_wrong_code_is_rejected_and_counted(monkeypatch):
    updates = []

    class CodeDB(FakeDB):
        def query(self, sql, params=None, fetch="all"):
            if "UPDATE login_codes" in sql:
                updates.append(params)
                return None
            if "login_codes" in sql:
                return {"id": 1, "email": "sasha@acme.com",
                        "code_hash": function.hash_code("483920"),
                        "attempts": 0, "used": False}
            return super().query(sql, params, fetch)

    monkeypatch.setattr(function, "db", CodeDB())
    monkeypatch.setattr(function, "ensure_schema", lambda: None)

    result = function.handler({
        "httpMethod": "POST", "path": "/api/auth-service/verify-code",
        "body": json.dumps({"email": "sasha@acme.com", "code": "000000"}),
    })

    assert result["statusCode"] == 401
    assert updates, "a failed attempt should be recorded"


def test_the_right_code_signs_the_user_in(monkeypatch):
    class CodeDB(FakeDB):
        def query(self, sql, params=None, fetch="all"):
            if "UPDATE login_codes" in sql:
                return None
            if "login_codes" in sql:
                return {"id": 1, "email": "sasha@acme.com",
                        "code_hash": function.hash_code("483920"),
                        "attempts": 0, "used": False}
            return super().query(sql, params, fetch)

    fake = CodeDB(users=[{
        "id": 1, "email": "sasha@acme.com", "name": "Sasha",
        "role": "admin", "password_hash": "x",
    }])
    monkeypatch.setattr(function, "db", fake)
    monkeypatch.setattr(function, "ensure_schema", lambda: None)

    result = function.handler({
        "httpMethod": "POST", "path": "/api/auth-service/verify-code",
        "body": json.dumps({"email": "sasha@acme.com", "code": "483920"}),
    })

    assert result["statusCode"] == 200
    assert function.read_token(json.loads(result["body"])["token"])


# ---------- registration endpoint ----------

def test_the_first_account_becomes_an_admin(monkeypatch):
    """Someone has to be able to manage the system on day one."""
    created = {}

    class EmptyDB(FakeDB):
        def query(self, sql, params=None, fetch="all"):
            if "COUNT(*)" in sql:
                return {"c": 0}
            if "INSERT INTO users" in sql:
                created["role"] = params[3]
                return {"id": 1, "email": params[0], "name": params[1],
                        "role": params[3]}
            return super().query(sql, params, fetch)

    monkeypatch.setattr(function, "db", EmptyDB())
    monkeypatch.setattr(function, "ensure_schema", lambda: None)

    function.handler({
        "httpMethod": "POST", "path": "/api/auth-service/register",
        "body": json.dumps({"email": "first@acme.com", "name": "First",
                            "password": "workshop123"}),
    })
    assert created["role"] == "admin"


def test_a_self_chosen_role_is_ignored(monkeypatch):
    """Honouring the submitted role would be privilege escalation — anyone
    could register themselves as an admin."""
    created = {}

    class PopulatedDB(FakeDB):
        def query(self, sql, params=None, fetch="all"):
            if "COUNT(*)" in sql:
                return {"c": 5}
            if "INSERT INTO users" in sql:
                created["role"] = params[3]
                return {"id": 6, "email": params[0], "name": params[1],
                        "role": params[3]}
            return super().query(sql, params, fetch)

    monkeypatch.setattr(function, "db", PopulatedDB())
    monkeypatch.setattr(function, "ensure_schema", lambda: None)

    function.handler({
        "httpMethod": "POST", "path": "/api/auth-service/register",
        "body": json.dumps({"email": "sneaky@acme.com", "name": "Sneaky",
                            "password": "workshop123", "role": "admin"}),
    })
    assert created["role"] == "viewer"


def test_registration_returns_400_when_invalid(monkeypatch):
    monkeypatch.setattr(function, "db", FakeDB())
    monkeypatch.setattr(function, "ensure_schema", lambda: None)

    result = function.handler({
        "httpMethod": "POST", "path": "/api/auth-service/register",
        "body": json.dumps({"email": "", "name": "", "password": ""}),
    })
    assert result["statusCode"] == 400


# ---------- role management ----------

def test_changing_a_role_without_a_token_returns_401(monkeypatch):
    monkeypatch.setattr(function, "ensure_schema", lambda: None)
    result = function.handler({
        "httpMethod": "PUT", "path": "/api/auth-service/2",
        "pathParameters": {"id": "2"},
        "body": json.dumps({"role": "manager"}),
    })
    assert result["statusCode"] == 401


def test_changing_a_role_as_a_viewer_returns_403(monkeypatch):
    monkeypatch.setattr(function, "ensure_schema", lambda: None)
    result = function.handler({
        "httpMethod": "PUT", "path": "/api/auth-service/2",
        "pathParameters": {"id": "2"},
        "headers": signed_in("viewer"),
        "body": json.dumps({"role": "admin"}),
    })
    assert result["statusCode"] == 403


def test_an_unknown_role_is_rejected(monkeypatch):
    monkeypatch.setattr(function, "db", FakeDB())
    monkeypatch.setattr(function, "ensure_schema", lambda: None)

    result = function.handler({
        "httpMethod": "PUT", "path": "/api/auth-service/2",
        "pathParameters": {"id": "2"},
        "headers": signed_in("admin"),
        "body": json.dumps({"role": "superuser"}),
    })
    assert result["statusCode"] == 400


def test_the_last_admin_cannot_demote_themselves(monkeypatch):
    """Otherwise nobody could ever manage users again without database access."""
    class OneAdminDB(FakeDB):
        def query(self, sql, params=None, fetch="all"):
            if "COUNT(*)" in sql:
                return {"c": 1}
            return super().query(sql, params, fetch)

    monkeypatch.setattr(function, "db", OneAdminDB())
    monkeypatch.setattr(function, "ensure_schema", lambda: None)

    result = function.handler({
        "httpMethod": "PUT", "path": "/api/auth-service/1",
        "pathParameters": {"id": "1"},
        "headers": signed_in("admin", user_id=1),
        "body": json.dumps({"role": "viewer"}),
    })
    assert result["statusCode"] == 400
    assert "only admin" in json.loads(result["body"])["error"].lower()


def test_an_admin_can_promote_someone(monkeypatch):
    class RoleDB(FakeDB):
        def query(self, sql, params=None, fetch="all"):
            if "COUNT(*)" in sql:
                return {"c": 3}
            if "UPDATE users" in sql:
                return {"id": params[1], "email": "b@acme.com",
                        "name": "B", "role": params[0]}
            return super().query(sql, params, fetch)

    monkeypatch.setattr(function, "db", RoleDB())
    monkeypatch.setattr(function, "ensure_schema", lambda: None)

    result = function.handler({
        "httpMethod": "PUT", "path": "/api/auth-service/2",
        "pathParameters": {"id": "2"},
        "headers": signed_in("admin", user_id=1),
        "body": json.dumps({"role": "manager"}),
    })
    assert result["statusCode"] == 200
    assert json.loads(result["body"])["role"] == "manager"


# ---------- routing and failure ----------

def test_an_unknown_action_returns_404(monkeypatch):
    monkeypatch.setattr(function, "ensure_schema", lambda: None)
    result = function.handler({
        "httpMethod": "POST", "path": "/api/auth-service/nonsense",
        "body": json.dumps({}),
    })
    assert result["statusCode"] == 404


def test_a_failure_returns_500_not_a_stack_trace(monkeypatch):
    def broken():
        raise RuntimeError("connection lost")

    monkeypatch.setattr(function, "ensure_schema", broken)
    result = function.handler({
        "httpMethod": "GET", "path": "/api/auth-service/me"})
    assert result["statusCode"] == 500