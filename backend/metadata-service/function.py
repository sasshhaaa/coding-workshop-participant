"""Metadata service - key/value attributes attached to teams or individuals."""

import json
import logging
from decimal import Decimal
from datetime import date, datetime

import postgres_service as db

logger = logging.getLogger()
logger.setLevel(logging.INFO)

ENTITY_TABLES = {"team": "teams", "individual": "individuals"}


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


def validate(data, record_id=None):
    errors = []

    entity_type = str(data.get("entity_type", "")).strip().lower()
    if entity_type not in ENTITY_TABLES:
        errors.append("entity_type must be either 'team' or 'individual'")

    entity_id = data.get("entity_id")
    if not entity_id:
        errors.append("entity_id is required")
    elif entity_type in ENTITY_TABLES:
        table = ENTITY_TABLES[entity_type]
        exists = db.query(
            f"SELECT id FROM {table} WHERE id = %s", (entity_id,), "one")
        if not exists:
            errors.append(f"{entity_type} {entity_id} does not exist")

    key = str(data.get("key", "")).strip()
    if not key:
        errors.append("key is required")
    elif len(key) > 100:
        errors.append("key must be 100 characters or fewer")

    # Check the UNIQUE (entity_type, entity_id, key) constraint up front so the
    # caller gets a readable message instead of a raw database error.
    if not errors:
        clash = db.query("""
            SELECT id FROM metadata
            WHERE entity_type = %s AND entity_id = %s AND key = %s
        """, (entity_type, entity_id, key), "one")
        if clash and str(clash["id"]) != str(record_id or ""):
            errors.append(f"'{key}' is already set on this {entity_type}")

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
            row = db.query(
                "SELECT * FROM metadata WHERE id = %s", (record_id,), "one")
            if not row:
                return respond(404, {"error": "Metadata entry not found"})
            return respond(200, row)

        if method == "GET":
            params = query_params(event)
            clauses, values = [], []
            if params.get("entity_type"):
                clauses.append("entity_type = %s")
                values.append(params["entity_type"].lower())
            if params.get("entity_id"):
                clauses.append("entity_id = %s")
                values.append(params["entity_id"])
            if params.get("key"):
                clauses.append("key = %s")
                values.append(params["key"])
            where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
            rows = db.query(
                f"SELECT * FROM metadata {where} ORDER BY key", tuple(values))
            return respond(200, rows)

        if method == "POST":
            errors = validate(data)
            if errors:
                return respond(400, {"error": "Validation failed", "details": errors})
            row = db.query("""
                INSERT INTO metadata (entity_type, entity_id, key, value)
                VALUES (%s, %s, %s, %s) RETURNING *
            """, (
                data["entity_type"].lower(), data["entity_id"],
                data["key"].strip(),
                (data.get("value") or "").strip() or None,
            ), "one")
            return respond(201, row)

        if method == "PUT":
            if not record_id:
                return respond(400, {"error": "id is required"})
            errors = validate(data, record_id)
            if errors:
                return respond(400, {"error": "Validation failed", "details": errors})
            row = db.query("""
                UPDATE metadata
                SET entity_type = %s, entity_id = %s, key = %s, value = %s
                WHERE id = %s RETURNING *
            """, (
                data["entity_type"].lower(), data["entity_id"],
                data["key"].strip(),
                (data.get("value") or "").strip() or None,
                record_id,
            ), "one")
            if not row:
                return respond(404, {"error": "Metadata entry not found"})
            return respond(200, row)

        if method == "DELETE":
            if not record_id:
                return respond(400, {"error": "id is required"})
            row = db.query(
                "DELETE FROM metadata WHERE id = %s RETURNING id",
                (record_id,), "one")
            if not row:
                return respond(404, {"error": "Metadata entry not found"})
            return respond(204, {})

        return respond(405, {"error": f"Method {method} not allowed"})

    except Exception as e:
        logger.error("Handler error: %s", str(e))
        return respond(500, {"error": "Internal server error", "message": str(e)})


if __name__ == "__main__":
    print(handler())