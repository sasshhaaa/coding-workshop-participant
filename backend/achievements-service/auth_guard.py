"""Shared authorisation for every backend service.

The auth service issues signed tokens; this module is how the other services
verify them. It lives in one place rather than being copied per service so
the permission table has a single definition — a role that can delete in one
service and not another would be a bug waiting to happen.

Locally, router.py puts this on the import path for each service. In AWS the
deploy script copies it into every Lambda bundle, because a Lambda zip cannot
import from a sibling directory.
"""

import base64
import hashlib
import hmac
import json
import os
from datetime import datetime, timezone

JWT_SECRET = os.getenv("JWT_SECRET", "dev-only-change-me")

# Set AUTH_ENFORCED=false to run the API without tokens during development.
ENFORCED = os.getenv("AUTH_ENFORCED", "true").lower() != "false"

# One table, used by every service. Read is intentionally open to any signed-in
# user: the tool exists so people can see the organisation.
PERMISSIONS = {
    "admin":       {"read": True, "create": True, "update": True, "delete": True},
    "manager":     {"read": True, "create": True, "update": True, "delete": True},
    "contributor": {"read": True, "create": True, "update": True, "delete": False},
    "viewer":      {"read": True, "create": False, "update": False, "delete": False},
}

METHOD_ACTIONS = {
    "GET": "read",
    "POST": "create",
    "PUT": "update",
    "PATCH": "update",
    "DELETE": "delete",
}


def _unb64(text):
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _b64(raw):
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def read_token(token):
    """Return the claims if the signature is valid and unexpired, else None.

    Deliberately mirrors auth-service so a token issued there is readable
    here without the services having to call each other.
    """
    try:
        header, payload, signature = token.split(".")
    except (ValueError, AttributeError):
        return None

    expected = hmac.new(
        JWT_SECRET.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
    if not hmac.compare_digest(_b64(expected), signature):
        return None

    try:
        claims = json.loads(_unb64(payload))
    except (ValueError, TypeError):
        return None

    if claims.get("exp", 0) < datetime.now(timezone.utc).timestamp():
        return None

    return claims


def caller(event):
    """Identify the signed-in user from the request, or None."""
    headers = event.get("headers") or {}
    raw = (headers.get("Authorization")
           or headers.get("authorization")
           or "")
    return read_token(raw.replace("Bearer ", "").strip())


def can(role, action):
    return PERMISSIONS.get(role, {}).get(action, False)


def check(event, method):
    """Authorise a request.

    Returns None when the caller may proceed, or a ready-to-return Lambda
    response when they may not. Services call this before doing any work, so
    an unauthorised request never reaches the database.
    """
    if not ENFORCED:
        return None

    claims = caller(event)
    if not claims:
        return _deny(401, "Sign in to continue")

    action = METHOD_ACTIONS.get(method.upper())
    if action is None:
        return _deny(405, f"Method {method} not allowed")

    role = claims.get("role", "viewer")
    if not can(role, action):
        return _deny(
            403,
            f"Your role ({role}) cannot {action} records. "
            "Contact an admin if you need access."
        )

    return None


def _deny(status, message):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps({"error": message}),
    }