"""Individuals service - CRUD with team reference validation."""

import json
import logging
from decimal import Decimal
from datetime import date, datetime

import postgres_service as db
import auth_guard

logger = logging.getLogger()
logger.setLevel(logging.INFO)

LEVELS = {"lead", "member", "junior"}
STAFF_TYPES = {"direct", "non-direct"}


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


def validate(data, record_id=None):
    errors = []
    if not str(data.get("name", "")).strip():
        errors.append("name is required")

    email = str(data.get("email", "")).strip()
    if not email:
        errors.append("email is required")
    elif "@" not in email:
        errors.append("email must be a valid address")
    else:
        clash = db.query(
            "SELECT id FROM individuals WHERE email = %s", (email,), "one")
        if clash and str(clash["id"]) != str(record_id or ""):
            errors.append(f"email {email} is already in use")

    if not str(data.get("location", "")).strip():
        errors.append("location is required")

    if data.get("level", "member") not in LEVELS:
        errors.append(f"level must be one of: {', '.join(sorted(LEVELS))}")

    if data.get("staff_type", "direct") not in STAFF_TYPES:
        errors.append(f"staff_type must be one of: {', '.join(sorted(STAFF_TYPES))}")

    team_id = data.get("team_id")
    if team_id:
        exists = db.query("SELECT id FROM teams WHERE id = %s", (team_id,), "one")
        if not exists:
            errors.append(f"team_id {team_id} does not exist")

    return errors


def handler(event=None, context=None):
    event = event or {}
    try:
        db.init_schema()

        method = (
            event.get("httpMethod")
            or event.get("requestContext", {}).get("http", {}).get("method")
            or "GET"
        ).upper()

        path = event.get("path") or event.get("rawPath") or ""
        segments = [p for p in path.split("/") if p]
        last = segments[-1] if segments else ""

        record_id = (event.get("pathParameters") or {}).get("id")
        if not record_id and last.isdigit():
            record_id = last

        params = event.get("queryStringParameters") or {}

        body = event.get("body")
        data = json.loads(body) if isinstance(body, str) and body else (body or {})

        # Authorise before touching the database, so an unauthorised request
        # never reaches it. The UI hides what a role can't do; this enforces it.
        denied = auth_guard.check(event, method)
        if denied:
            return denied

        if method == "GET" and record_id:
            row = db.query("""
                SELECT i.*, t.name AS team_name
                FROM individuals i LEFT JOIN teams t ON t.id = i.team_id
                WHERE i.id = %s
            """, (record_id,), "one")
            if not row:
                return respond(404, {"error": "Individual not found"})
            return respond(200, row)

        if method == "GET":
            filters, args = [], []
            if params.get("team_id"):
                filters.append("i.team_id = %s")
                args.append(params["team_id"])
            if params.get("staff_type"):
                filters.append("i.staff_type = %s")
                args.append(params["staff_type"])
            where = f"WHERE {' AND '.join(filters)}" if filters else ""
            rows = db.query(f"""
                SELECT i.*, t.name AS team_name
                FROM individuals i LEFT JOIN teams t ON t.id = i.team_id
                {where}
                ORDER BY CASE i.level
                    WHEN 'lead' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, i.name
            """, tuple(args))
            return respond(200, rows)

        if method == "POST":
            errors = validate(data)
            if errors:
                return respond(400, {"error": "Validation failed", "details": errors})
            row = db.query("""
                INSERT INTO individuals
                    (name, email, role, level, staff_type, location, team_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING *
            """, (
                data["name"].strip(), data["email"].strip(), data.get("role"),
                data.get("level", "member"), data.get("staff_type", "direct"),
                data["location"].strip(), data.get("team_id") or None,
            ), "one")
            return respond(201, row)

        if method == "PUT":
            if not record_id:
                return respond(400, {"error": "id is required"})
            errors = validate(data, record_id)
            if errors:
                return respond(400, {"error": "Validation failed", "details": errors})
            row = db.query("""
                UPDATE individuals SET name = %s, email = %s, role = %s,
                    level = %s, staff_type = %s, location = %s, team_id = %s
                WHERE id = %s RETURNING *
            """, (
                data["name"].strip(), data["email"].strip(), data.get("role"),
                data.get("level", "member"), data.get("staff_type", "direct"),
                data["location"].strip(), data.get("team_id") or None, record_id,
            ), "one")
            if not row:
                return respond(404, {"error": "Individual not found"})
            return respond(200, row)

        if method == "DELETE":
            if not record_id:
                return respond(400, {"error": "id is required"})
            db.query(
                "UPDATE teams SET leader_id = NULL WHERE leader_id = %s",
                (record_id,), fetch=None)
            row = db.query(
                "DELETE FROM individuals WHERE id = %s RETURNING id",
                (record_id,), "one")
            if not row:
                return respond(404, {"error": "Individual not found"})
            return respond(204, {})

        return respond(405, {"error": f"Method {method} not allowed"})

    except Exception as e:
        logger.error("Handler error: %s", str(e))
        return respond(500, {"error": "Internal server error", "message": str(e)})


if __name__ == "__main__":
    print(handler())