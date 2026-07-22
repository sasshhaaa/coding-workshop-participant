"""Teams service - CRUD plus organisation analytics."""

import json
import logging
from decimal import Decimal
from datetime import date, datetime

import postgres_service as db

logger = logging.getLogger()
logger.setLevel(logging.INFO)


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


def validate(data):
    errors = []
    if not str(data.get("name", "")).strip():
        errors.append("name is required")
    if not str(data.get("location", "")).strip():
        errors.append("location is required")
    leader_id = data.get("leader_id")
    if leader_id:
        exists = db.query(
            "SELECT id FROM individuals WHERE id = %s", (leader_id,), "one")
        if not exists:
            errors.append(f"leader_id {leader_id} does not exist")
    return errors


def team_with_stats(team_id=None):
    where = "WHERE t.id = %s" if team_id else ""
    params = (team_id,) if team_id else ()
    return db.query(f"""
        SELECT
            t.*,
            l.name       AS leader_name,
            l.location   AS leader_location,
            l.staff_type AS leader_staff_type,
            COUNT(i.id)  AS member_count,
            COUNT(i.id) FILTER (WHERE i.staff_type = 'non-direct') AS non_direct_count,
            ROUND(COALESCE(
                COUNT(i.id) FILTER (WHERE i.staff_type = 'non-direct')::numeric
                / NULLIF(COUNT(i.id), 0) * 100, 0), 1) AS non_direct_pct,
            (l.location IS NOT NULL AND l.location <> t.location) AS leader_offsite
        FROM teams t
        LEFT JOIN individuals l ON l.id = t.leader_id
        LEFT JOIN individuals i ON i.team_id = t.id
        {where}
        GROUP BY t.id, l.name, l.location, l.staff_type
        ORDER BY t.name
    """, params)


def analytics():
    rows = team_with_stats()
    return {
        "total_teams": len(rows),
        "total_people": db.query(
            "SELECT COUNT(*) AS c FROM individuals", None, "one")["c"],
        "locations": db.query(
            "SELECT COUNT(DISTINCT location) AS c FROM teams", None, "one")["c"],
        "reporting_to_org_leader": sum(1 for r in rows if r["org_leader"]),
        "leader_not_colocated": sum(1 for r in rows if r["leader_offsite"]),
        "leader_non_direct": sum(
            1 for r in rows if r["leader_staff_type"] == "non-direct"),
        "non_direct_over_20pct": sum(
            1 for r in rows if (r["non_direct_pct"] or 0) > 20),
        "teams": rows,
    }


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

        body = event.get("body")
        data = json.loads(body) if isinstance(body, str) and body else (body or {})

        if method == "GET" and last == "analytics":
            return respond(200, analytics())

        if method == "GET" and record_id:
            rows = team_with_stats(record_id)
            if not rows:
                return respond(404, {"error": "Team not found"})
            team = rows[0]
            team["members"] = db.query("""
                SELECT * FROM individuals WHERE team_id = %s
                ORDER BY CASE level
                    WHEN 'lead' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, name
            """, (record_id,))
            team["achievements"] = db.query("""
                SELECT * FROM achievements WHERE team_id = %s ORDER BY month DESC
            """, (record_id,))
            return respond(200, team)

        if method == "GET":
            return respond(200, team_with_stats())

        if method == "POST":
            errors = validate(data)
            if errors:
                return respond(400, {"error": "Validation failed", "details": errors})
            row = db.query("""
                INSERT INTO teams (name, location, leader_id, org_leader)
                VALUES (%s, %s, %s, %s) RETURNING *
            """, (data["name"].strip(), data["location"].strip(),
                  data.get("leader_id") or None, data.get("org_leader")), "one")
            return respond(201, row)

        if method == "PUT":
            if not record_id:
                return respond(400, {"error": "id is required"})
            errors = validate(data)
            if errors:
                return respond(400, {"error": "Validation failed", "details": errors})
            row = db.query("""
                UPDATE teams SET name = %s, location = %s,
                    leader_id = %s, org_leader = %s
                WHERE id = %s RETURNING *
            """, (data["name"].strip(), data["location"].strip(),
                  data.get("leader_id") or None, data.get("org_leader"),
                  record_id), "one")
            if not row:
                return respond(404, {"error": "Team not found"})
            return respond(200, row)

        if method == "DELETE":
            if not record_id:
                return respond(400, {"error": "id is required"})
            row = db.query(
                "DELETE FROM teams WHERE id = %s RETURNING id", (record_id,), "one")
            if not row:
                return respond(404, {"error": "Team not found"})
            return respond(204, {})

        return respond(405, {"error": f"Method {method} not allowed"})

    except Exception as e:
        logger.error("Handler error: %s", str(e))
        return respond(500, {"error": "Internal server error", "message": str(e)})


if __name__ == "__main__":
    print(handler())