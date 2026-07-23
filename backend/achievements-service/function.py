"""Achievements service - CRUD for monthly team achievements."""

import json
import logging
from decimal import Decimal
from datetime import date, datetime

import postgres_service as db

logger = logging.getLogger()
logger.setLevel(logging.INFO)

IMPACTS = ("low", "medium", "high")


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


def query_params(event):
    params = event.get("queryStringParameters") or {}
    if params:
        return params
    path = event.get("path") or ""
    raw = path.split("?", 1)[1] if "?" in path else ""
    out = {}
    for pair in raw.split("&"):
        if "=" in pair:
            k, v = pair.split("=", 1)
            out[k] = v
    return out


def normalise_month(value):
    """Accept YYYY-MM or YYYY-MM-DD; always store the first of the month."""
    text = str(value or "").strip()
    if not text:
        return None
    if len(text) == 7:
        text = f"{text}-01"
    try:
        return datetime.strptime(text[:10], "%Y-%m-%d").date().replace(day=1)
    except ValueError:
        return None


def validate(data):
    errors = []

    if not str(data.get("title", "")).strip():
        errors.append("title is required")

    team_id = data.get("team_id")
    if not team_id:
        errors.append("team_id is required")
    else:
        exists = db.query("SELECT id FROM teams WHERE id = %s", (team_id,), "one")
        if not exists:
            errors.append(f"team_id {team_id} does not exist")

    if normalise_month(data.get("month")) is None:
        errors.append("month is required in YYYY-MM format")

    impact = str(data.get("impact", "medium")).lower()
    if impact not in IMPACTS:
        errors.append(f"impact must be one of: {', '.join(IMPACTS)}")

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
        segments = [p for p in path.split("?")[0].split("/") if p]
        last = segments[-1] if segments else ""

        record_id = (event.get("pathParameters") or {}).get("id")
        if not record_id and last.isdigit():
            record_id = last

        body = event.get("body")
        data = json.loads(body) if isinstance(body, str) and body else (body or {})

        if method == "GET" and record_id:
            row = db.query("""
                SELECT a.*, t.name AS team_name
                FROM achievements a JOIN teams t ON t.id = a.team_id
                WHERE a.id = %s
            """, (record_id,), "one")
            if not row:
                return respond(404, {"error": "Achievement not found"})
            return respond(200, row)

        if method == "GET":
            params = query_params(event)
            clauses, values = [], []
            if params.get("team_id"):
                clauses.append("a.team_id = %s")
                values.append(params["team_id"])
            if params.get("impact"):
                clauses.append("a.impact = %s")
                values.append(params["impact"].lower())
            where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
            rows = db.query(f"""
                SELECT a.*, t.name AS team_name
                FROM achievements a JOIN teams t ON t.id = a.team_id
                {where}
                ORDER BY a.month DESC, a.created_at DESC
            """, tuple(values))
            return respond(200, rows)

        if method == "POST":
            errors = validate(data)
            if errors:
                return respond(400, {"error": "Validation failed", "details": errors})
            row = db.query("""
                INSERT INTO achievements (team_id, title, description, month, impact)
                VALUES (%s, %s, %s, %s, %s) RETURNING *
            """, (
                data["team_id"], data["title"].strip(),
                (data.get("description") or "").strip() or None,
                normalise_month(data["month"]),
                str(data.get("impact", "medium")).lower(),
            ), "one")
            return respond(201, row)

        if method == "PUT":
            if not record_id:
                return respond(400, {"error": "id is required"})
            errors = validate(data)
            if errors:
                return respond(400, {"error": "Validation failed", "details": errors})
            row = db.query("""
                UPDATE achievements
                SET team_id = %s, title = %s, description = %s, month = %s, impact = %s
                WHERE id = %s RETURNING *
            """, (
                data["team_id"], data["title"].strip(),
                (data.get("description") or "").strip() or None,
                normalise_month(data["month"]),
                str(data.get("impact", "medium")).lower(),
                record_id,
            ), "one")
            if not row:
                return respond(404, {"error": "Achievement not found"})
            return respond(200, row)

        if method == "DELETE":
            if not record_id:
                return respond(400, {"error": "id is required"})
            row = db.query(
                "DELETE FROM achievements WHERE id = %s RETURNING id",
                (record_id,), "one")
            if not row:
                return respond(404, {"error": "Achievement not found"})
            return respond(204, {})

        return respond(405, {"error": f"Method {method} not allowed"})

    except Exception as e:
        logger.error("Handler error: %s", str(e))
        return respond(500, {"error": "Internal server error", "message": str(e)})


if __name__ == "__main__":
    print(handler())