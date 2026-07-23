"""Projects service - CRUD, budget tracking, and derived RAG health."""

import json
import logging
from decimal import Decimal
from datetime import date, datetime, timedelta

import postgres_service as db
import auth_guard

logger = logging.getLogger()
logger.setLevel(logging.INFO)

STATUSES = ("planning", "active", "on_hold", "completed", "cancelled")
AMBER_WINDOW_DAYS = 14


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
        CREATE TABLE IF NOT EXISTS projects (
            id             SERIAL PRIMARY KEY,
            team_id        INTEGER REFERENCES teams(id) ON DELETE CASCADE,
            name           VARCHAR(200) NOT NULL,
            description    TEXT,
            status         VARCHAR(20) NOT NULL DEFAULT 'planning',
            start_date     DATE,
            due_date       DATE,
            progress_pct   INTEGER NOT NULL DEFAULT 0,
            budget_planned NUMERIC(12,2) NOT NULL DEFAULT 0,
            budget_spent   NUMERIC(12,2) NOT NULL DEFAULT 0,
            created_at     TIMESTAMP DEFAULT NOW()
        )
    """, fetch=None)

    # The table may pre-date this service, so add anything that's missing.
    for column, definition in [
        ("team_id", "INTEGER REFERENCES teams(id) ON DELETE CASCADE"),
        ("description", "TEXT"),
        ("status", "VARCHAR(20) NOT NULL DEFAULT 'planning'"),
        ("start_date", "DATE"),
        ("due_date", "DATE"),
        ("progress_pct", "INTEGER NOT NULL DEFAULT 0"),
        ("budget_planned", "NUMERIC(12,2) NOT NULL DEFAULT 0"),
        ("budget_spent", "NUMERIC(12,2) NOT NULL DEFAULT 0"),
        ("created_at", "TIMESTAMP DEFAULT NOW()"),
    ]:
        db.query(
            f"ALTER TABLE projects ADD COLUMN IF NOT EXISTS {column} {definition}",
            fetch=None,
        )


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


def parse_date(value):
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.strptime(text[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def to_money(value):
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def elapsed_pct(row):
    """How far through its own timeline a project is, as a percentage."""
    start = row.get("start_date")
    due = row.get("due_date")
    if isinstance(start, str):
        start = parse_date(start)
    if isinstance(due, str):
        due = parse_date(due)
    if not start or not due or due <= start:
        return None

    total = (due - start).days
    gone = (date.today() - start).days
    return max(0, min(100, round(gone / total * 100)))


def budget_pct(row):
    planned = float(row.get("budget_planned") or 0)
    if planned <= 0:
        return None
    return round(float(row.get("budget_spent") or 0) / planned * 100)


def rag_status(row):
    """Red/amber/green from status, dates, progress, and budget burn.

    Computed here rather than in the UI so every caller sees the same answer.
    """
    status = row.get("status")
    if status == "completed":
        return "complete"
    if status == "cancelled":
        return "red"
    if status == "on_hold":
        return "amber"

    spend = budget_pct(row)
    if spend is not None and spend > 100:
        return "red"

    due = row.get("due_date")
    if isinstance(due, str):
        due = parse_date(due)
    if not due:
        return "green"

    today = date.today()
    if due < today:
        return "red"
    if due <= today + timedelta(days=AMBER_WINDOW_DAYS):
        return "amber"

    # Behind schedule: more time gone than work done, by a clear margin.
    elapsed = elapsed_pct(row)
    progress = row.get("progress_pct") or 0
    if elapsed is not None and elapsed - progress >= 25:
        return "amber"

    # Burning budget faster than delivering work.
    if spend is not None and spend - progress >= 25:
        return "amber"

    return "green"


def decorate(rows):
    for r in rows:
        r["budget_planned"] = float(r.get("budget_planned") or 0)
        r["budget_spent"] = float(r.get("budget_spent") or 0)
        r["budget_pct"] = budget_pct(r)
        r["budget_remaining"] = r["budget_planned"] - r["budget_spent"]
        r["over_budget"] = r["budget_spent"] > r["budget_planned"] > 0
        r["elapsed_pct"] = elapsed_pct(r)
        r["progress_pct"] = r.get("progress_pct") or 0
        r["rag"] = rag_status(r)
        r["overdue"] = r["rag"] == "red" and r.get("status") not in (
            "completed", "cancelled")
    return rows


def validate(data, record_id=None):
    errors = []

    if not str(data.get("name", "")).strip():
        errors.append("name is required")

    team_id = data.get("team_id")
    if not team_id:
        errors.append("team_id is required")
    else:
        exists = db.query("SELECT id FROM teams WHERE id = %s", (team_id,), "one")
        if not exists:
            errors.append(f"team_id {team_id} does not exist")

    status = str(data.get("status", "planning")).lower()
    if status not in STATUSES:
        errors.append(f"status must be one of: {', '.join(STATUSES)}")

    start = parse_date(data.get("start_date"))
    due = parse_date(data.get("due_date"))
    if data.get("start_date") and not start:
        errors.append("start_date must be a valid date")
    if data.get("due_date") and not due:
        errors.append("due_date must be a valid date")
    if start and due and due < start:
        errors.append("due date must be on or after the start date")

    try:
        progress = int(data.get("progress_pct") or 0)
        if progress < 0 or progress > 100:
            errors.append("progress must be between 0 and 100")
    except (TypeError, ValueError):
        errors.append("progress must be a whole number")

    for field in ("budget_planned", "budget_spent"):
        raw = data.get(field)
        if raw in (None, ""):
            continue
        try:
            if float(raw) < 0:
                errors.append(f"{field.replace('_', ' ')} cannot be negative")
        except (TypeError, ValueError):
            errors.append(f"{field.replace('_', ' ')} must be a number")

    if not errors:
        clash = db.query("""
            SELECT id FROM projects WHERE team_id = %s AND LOWER(name) = LOWER(%s)
        """, (team_id, data["name"].strip()), "one")
        if clash and str(clash["id"]) != str(record_id or ""):
            errors.append("this team already has a project with that name")

    return errors


def list_projects(params):
    clauses, values = [], []

    if params.get("team_id"):
        clauses.append("p.team_id = %s")
        values.append(params["team_id"])

    if params.get("status"):
        clauses.append("p.status = %s")
        values.append(params["status"].lower())

    if params.get("search"):
        clauses.append("p.name ILIKE %s")
        values.append(f"%{params['search']}%")

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = db.query(f"""
        SELECT p.*, t.name AS team_name
        FROM projects p
        LEFT JOIN teams t ON t.id = p.team_id
        {where}
        ORDER BY
            CASE p.status WHEN 'active' THEN 1 WHEN 'planning' THEN 2
                          WHEN 'on_hold' THEN 3 ELSE 4 END,
            p.due_date NULLS LAST
    """, tuple(values))
    return decorate(rows)


def handler(event=None, context=None):
    event = event or {}
    try:
        db.init_schema()
        ensure_schema()

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

        # Authorise before touching the database, so an unauthorised request
        # never reaches it. The UI hides what a role can't do; this enforces it.
        denied = auth_guard.check(event, method)
        if denied:
            return denied

        if method == "GET" and record_id:
            row = db.query("""
                SELECT p.*, t.name AS team_name
                FROM projects p LEFT JOIN teams t ON t.id = p.team_id
                WHERE p.id = %s
            """, (record_id,), "one")
            if not row:
                return respond(404, {"error": "Project not found"})
            return respond(200, decorate([row])[0])

        if method == "GET":
            return respond(200, list_projects(query_params(event)))

        if method == "POST":
            errors = validate(data)
            if errors:
                return respond(400, {"error": "Validation failed", "details": errors})
            row = db.query("""
                INSERT INTO projects
                    (team_id, name, description, status, start_date, due_date,
                     progress_pct, budget_planned, budget_spent)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *
            """, (
                data["team_id"], data["name"].strip(),
                (data.get("description") or "").strip() or None,
                str(data.get("status", "planning")).lower(),
                parse_date(data.get("start_date")),
                parse_date(data.get("due_date")),
                int(data.get("progress_pct") or 0),
                to_money(data.get("budget_planned")),
                to_money(data.get("budget_spent")),
            ), "one")
            return respond(201, decorate([row])[0])

        if method == "PUT":
            if not record_id:
                return respond(400, {"error": "id is required"})
            errors = validate(data, record_id)
            if errors:
                return respond(400, {"error": "Validation failed", "details": errors})
            row = db.query("""
                UPDATE projects SET team_id = %s, name = %s, description = %s,
                    status = %s, start_date = %s, due_date = %s, progress_pct = %s,
                    budget_planned = %s, budget_spent = %s
                WHERE id = %s RETURNING *
            """, (
                data["team_id"], data["name"].strip(),
                (data.get("description") or "").strip() or None,
                str(data.get("status", "planning")).lower(),
                parse_date(data.get("start_date")),
                parse_date(data.get("due_date")),
                int(data.get("progress_pct") or 0),
                to_money(data.get("budget_planned")),
                to_money(data.get("budget_spent")),
                record_id,
            ), "one")
            if not row:
                return respond(404, {"error": "Project not found"})
            return respond(200, decorate([row])[0])

        if method == "DELETE":
            if not record_id:
                return respond(400, {"error": "id is required"})
            row = db.query(
                "DELETE FROM projects WHERE id = %s RETURNING id", (record_id,), "one")
            if not row:
                return respond(404, {"error": "Project not found"})
            return respond(204, {})

        return respond(405, {"error": f"Method {method} not allowed"})

    except Exception as e:
        logger.error("Handler error: %s", str(e))
        return respond(500, {"error": "Internal server error", "message": str(e)})


if __name__ == "__main__":
    print(handler())