"""Projects service - CRUD handler."""

import json
import logging
from decimal import Decimal
from datetime import date, datetime

import postgres_service as db

logger = logging.getLogger()
logger.setLevel(logging.INFO)

VALID_STATUS = {"planning", "active", "on_hold", "completed", "cancelled"}


def encode(obj):
    """Make Decimal and date types JSON-serializable."""
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    raise TypeError(f"Not serializable: {type(obj)}")


def respond(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body, default=encode),
    }


def validate(data):
    """Return a list of validation error messages."""
    errors = []
    if not data.get("name", "").strip():
        errors.append("name is required")
    status = data.get("status", "planning")
    if status not in VALID_STATUS:
        errors.append(f"status must be one of: {', '.join(sorted(VALID_STATUS))}")
    if data.get("start_date") and data.get("due_date"):
        if str(data["start_date"]) > str(data["due_date"]):
            errors.append("due_date must be on or after start_date")
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

        path_params = event.get("pathParameters") or {}
        record_id = path_params.get("id")

        body = event.get("body")
        data = json.loads(body) if isinstance(body, str) and body else (body or {})

        if method == "GET" and record_id:
            row = db.query("SELECT * FROM projects WHERE id = %s", (record_id,), "one")
            if not row:
                return respond(404, {"error": "Project not found"})
            return respond(200, row)

        if method == "GET":
            rows = db.query("SELECT * FROM projects ORDER BY id")
            return respond(200, rows)

        if method == "POST":
            errors = validate(data)
            if errors:
                return respond(400, {"error": "Validation failed", "details": errors})
            row = db.query("""
                INSERT INTO projects
                    (name, department, status, start_date, due_date,
                     budget_planned, budget_spent)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING *
            """, (
                data["name"].strip(),
                data.get("department"),
                data.get("status", "planning"),
                data.get("start_date"),
                data.get("due_date"),
                data.get("budget_planned", 0),
                data.get("budget_spent", 0),
            ), "one")
            return respond(201, row)

        if method == "PUT":
            if not record_id:
                return respond(400, {"error": "id is required"})
            errors = validate(data)
            if errors:
                return respond(400, {"error": "Validation failed", "details": errors})
            row = db.query("""
                UPDATE projects SET
                    name = %s, department = %s, status = %s,
                    start_date = %s, due_date = %s,
                    budget_planned = %s, budget_spent = %s
                WHERE id = %s
                RETURNING *
            """, (
                data["name"].strip(),
                data.get("department"),
                data.get("status", "planning"),
                data.get("start_date"),
                data.get("due_date"),
                data.get("budget_planned", 0),
                data.get("budget_spent", 0),
                record_id,
            ), "one")
            if not row:
                return respond(404, {"error": "Project not found"})
            return respond(200, row)

        if method == "DELETE":
            if not record_id:
                return respond(400, {"error": "id is required"})
            row = db.query(
                "DELETE FROM projects WHERE id = %s RETURNING id", (record_id,), "one"
            )
            if not row:
                return respond(404, {"error": "Project not found"})
            return respond(204, {})

        return respond(405, {"error": f"Method {method} not allowed"})

    except Exception as e:
        logger.error("Handler error: %s", str(e))
        return respond(500, {"error": "Internal server error", "message": str(e)})


if __name__ == "__main__":
    print(handler())