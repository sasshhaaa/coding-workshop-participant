"""Auth service - registration, password login, email OTP, and JWT issuing."""

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import postgres_service as db

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# In production these come from the environment, never from source.
JWT_SECRET = os.getenv("JWT_SECRET", "dev-only-change-me")

# A designated address that always registers as an admin. Without it, a fresh
# deployment's admin is whoever happens to register first — which is fine
# locally but leaves a cloud environment with no way back if someone else
# gets there first.
BOOTSTRAP_ADMIN_EMAIL = os.getenv("BOOTSTRAP_ADMIN_EMAIL", "").strip().lower()

TOKEN_HOURS = 8
OTP_MINUTES = 10
PBKDF2_ROUNDS = 120_000

ROLES = ("admin", "manager", "contributor", "viewer")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def encode(obj):
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    raise TypeError(f"Not serializable: {type(obj)}")


def respond(status, body):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body, default=encode),
    }


def ensure_schema():
    db.query("""
        CREATE TABLE IF NOT EXISTS users (
            id            SERIAL PRIMARY KEY,
            email         VARCHAR(200) NOT NULL UNIQUE,
            name          VARCHAR(150) NOT NULL,
            password_hash TEXT,
            role          VARCHAR(20) NOT NULL DEFAULT 'viewer',
            created_at    TIMESTAMP DEFAULT NOW()
        )
    """, fetch=None)

    db.query("""
        CREATE TABLE IF NOT EXISTS login_codes (
            id         SERIAL PRIMARY KEY,
            email      VARCHAR(200) NOT NULL,
            code_hash  TEXT NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            used       BOOLEAN NOT NULL DEFAULT FALSE,
            attempts   INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW()
        )
    """, fetch=None)


# ---------- password hashing ----------

def hash_password(password):
    """PBKDF2-HMAC-SHA256 with a per-user random salt."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ROUNDS)
    return f"pbkdf2${PBKDF2_ROUNDS}${salt.hex()}${digest.hex()}"


def verify_password(password, stored):
    if not stored or not stored.startswith("pbkdf2$"):
        return False
    try:
        _, rounds, salt_hex, digest_hex = stored.split("$")
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt_hex), int(rounds))
        # Constant-time compare so timing can't leak the hash.
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


# ---------- JWT ----------

def b64(raw):
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def unb64(text):
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def make_token(user):
    header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    expires = datetime.now(timezone.utc) + timedelta(hours=TOKEN_HOURS)
    payload = b64(json.dumps({
        "sub": user["id"],
        "email": user["email"],
        "name": user["name"],
        "role": user["role"],
        "exp": int(expires.timestamp()),
    }).encode())
    signature = hmac.new(
        JWT_SECRET.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
    return f"{header}.{payload}.{b64(signature)}"


def read_token(token):
    """Return the payload if the signature is valid and unexpired, else None."""
    try:
        header, payload, signature = token.split(".")
    except (ValueError, AttributeError):
        return None

    expected = hmac.new(
        JWT_SECRET.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
    if not hmac.compare_digest(b64(expected), signature):
        return None

    data = json.loads(unb64(payload))
    if data.get("exp", 0) < datetime.now(timezone.utc).timestamp():
        return None
    return data


# ---------- OTP ----------
# These endpoints are functional but not exposed in the UI, because no email
# provider is configured. Codes are written to the server log instead.

def hash_code(code):
    return hashlib.sha256(f"{JWT_SECRET}{code}".encode()).hexdigest()


def send_code(email, code):
    """Development delivery: the code is printed to the server log.

    Swap this for SES or SendGrid in production. The rest of the flow is
    unchanged because delivery is isolated to this one function.
    """
    print(f"\n=== LOGIN CODE for {email}: {code} (valid {OTP_MINUTES} min) ===\n")


# ---------- validation ----------

def validate_registration(data):
    errors = []

    email = str(data.get("email", "")).strip().lower()
    if not email:
        errors.append("email is required")
    elif not EMAIL_RE.match(email):
        errors.append("email must be a valid address")

    if not str(data.get("name", "")).strip():
        errors.append("name is required")

    password = str(data.get("password", ""))
    if not password:
        errors.append("password is required")
    elif len(password) < 8:
        errors.append("password must be at least 8 characters")

    if email and not errors:
        taken = db.query(
            "SELECT id FROM users WHERE LOWER(email) = %s", (email,), "one")
        if taken:
            errors.append("an account with that email already exists")

    return errors


def role_for(email):
    """Decide a new account's role.

    The submitted role is deliberately ignored — honouring it would let anyone
    register themselves as an admin. Only two things grant admin: being the
    very first account, or matching the address designated in the environment.
    """
    email = str(email).strip().lower()

    if BOOTSTRAP_ADMIN_EMAIL and email == BOOTSTRAP_ADMIN_EMAIL:
        return "admin"

    existing = db.query("SELECT COUNT(*) AS c FROM users", None, "one")["c"]
    return "admin" if existing == 0 else "viewer"


def public(user):
    return {
        "id": user["id"],
        "email": user["email"],
        "name": user["name"],
        "role": user["role"],
    }


def caller(event):
    """Identify the signed-in user from the Authorization header, if any."""
    headers = event.get("headers") or {}
    raw = headers.get("Authorization") or headers.get("authorization") or ""
    return read_token(raw.replace("Bearer ", "").strip())


# ---------- handler ----------

def handler(event=None, context=None):
    event = event or {}
    try:
        ensure_schema()

        method = (
            event.get("httpMethod")
            or event.get("requestContext", {}).get("http", {}).get("method")
            or "GET"
        ).upper()

        path = event.get("path") or event.get("rawPath") or ""
        segments = [p for p in path.split("?")[0].split("/") if p]
        action = segments[-1] if segments else ""

        body = event.get("body")
        data = json.loads(body) if isinstance(body, str) and body else (body or {})

        record_id = (event.get("pathParameters") or {}).get("id")

        # --- who am I? ---
        if method == "GET" and action == "me":
            claims = caller(event)
            if not claims:
                return respond(401, {"error": "Invalid or expired session"})
            return respond(200, {
                "id": claims["sub"], "email": claims["email"],
                "name": claims["name"], "role": claims["role"],
            })

        # --- register ---
        if method == "POST" and action == "register":
            errors = validate_registration(data)
            if errors:
                return respond(400, {"error": "Validation failed", "details": errors})

            user = db.query("""
                INSERT INTO users (email, name, password_hash, role)
                VALUES (%s, %s, %s, %s) RETURNING *
            """, (
                data["email"].strip().lower(),
                data["name"].strip(),
                hash_password(data["password"]),
                role_for(data["email"]),
            ), "one")
            return respond(201, {"token": make_token(user), "user": public(user)})

        # --- password login ---
        if method == "POST" and action == "login":
            email = str(data.get("email", "")).strip().lower()
            password = str(data.get("password", ""))
            if not email or not password:
                return respond(400, {"error": "Email and password are required"})

            user = db.query(
                "SELECT * FROM users WHERE LOWER(email) = %s", (email,), "one")

            # Same message either way, so the response can't be used to
            # discover which email addresses have accounts.
            if not user or not verify_password(password, user["password_hash"]):
                return respond(401, {"error": "Email or password is incorrect"})

            return respond(200, {"token": make_token(user), "user": public(user)})

        # --- request a one-time code ---
        if method == "POST" and action == "request-code":
            email = str(data.get("email", "")).strip().lower()
            if not EMAIL_RE.match(email):
                return respond(400, {"error": "Enter a valid email address"})

            user = db.query(
                "SELECT * FROM users WHERE LOWER(email) = %s", (email,), "one")

            if user:
                code = f"{secrets.randbelow(1_000_000):06d}"
                db.query("""
                    INSERT INTO login_codes (email, code_hash, expires_at)
                    VALUES (%s, %s, NOW() + INTERVAL '%s minutes')
                """, (email, hash_code(code), OTP_MINUTES), fetch=None)
                send_code(email, code)

            # Always the same reply, whether or not the account exists.
            return respond(200, {
                "message": f"If that address has an account, a code is on its way. "
                           f"It expires in {OTP_MINUTES} minutes."
            })

        # --- verify a one-time code ---
        if method == "POST" and action == "verify-code":
            email = str(data.get("email", "")).strip().lower()
            code = str(data.get("code", "")).strip()
            if not email or not code:
                return respond(400, {"error": "Email and code are required"})

            record = db.query("""
                SELECT * FROM login_codes
                WHERE email = %s AND used = FALSE AND expires_at > NOW()
                ORDER BY created_at DESC LIMIT 1
            """, (email,), "one")

            if not record:
                return respond(401, {"error": "That code has expired. Request a new one."})

            if record["attempts"] >= 5:
                return respond(429, {"error": "Too many attempts. Request a new code."})

            if not hmac.compare_digest(hash_code(code), record["code_hash"]):
                db.query(
                    "UPDATE login_codes SET attempts = attempts + 1 WHERE id = %s",
                    (record["id"],), fetch=None)
                return respond(401, {"error": "That code is not correct"})

            db.query("UPDATE login_codes SET used = TRUE WHERE id = %s",
                     (record["id"],), fetch=None)

            user = db.query(
                "SELECT * FROM users WHERE LOWER(email) = %s", (email,), "one")
            if not user:
                return respond(401, {"error": "No account for that address"})

            return respond(200, {"token": make_token(user), "user": public(user)})

        # --- change a user's role (admin only) ---
        if method == "PUT" and record_id:
            claims = caller(event)
            if not claims:
                return respond(401, {"error": "Sign in required"})
            if claims["role"] != "admin":
                return respond(403, {"error": "Only admins can change roles"})

            role = str(data.get("role", "")).lower()
            if role not in ROLES:
                return respond(400, {
                    "error": "Validation failed",
                    "details": [f"role must be one of: {', '.join(ROLES)}"],
                })

            # Don't let the last admin demote themselves out of the system.
            if str(claims["sub"]) == str(record_id) and role != "admin":
                admins = db.query(
                    "SELECT COUNT(*) AS c FROM users WHERE role = 'admin'",
                    None, "one")["c"]
                if admins <= 1:
                    return respond(400, {
                        "error": "You are the only admin. Promote someone else first."
                    })

            user = db.query(
                "UPDATE users SET role = %s WHERE id = %s RETURNING *",
                (role, record_id), "one")
            if not user:
                return respond(404, {"error": "User not found"})
            return respond(200, public(user))

        # --- list users (admin only) ---
        if method == "GET":
            claims = caller(event)
            if not claims:
                return respond(401, {"error": "Sign in required"})
            if claims["role"] != "admin":
                return respond(403, {"error": "Only admins can view users"})
            rows = db.query(
                "SELECT id, email, name, role, created_at FROM users ORDER BY name")
            return respond(200, rows)

        return respond(404, {"error": f"Unknown auth action: {action}"})

    except Exception as e:
        logger.error("Handler error: %s", str(e))
        return respond(500, {"error": "Internal server error", "message": str(e)})


if __name__ == "__main__":
    print(handler())