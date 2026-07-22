"""PostgreSQL connection, schema, and query helpers."""

import os
from psycopg import connect
from psycopg.rows import dict_row

PG_CONN = None


def get_config():
    """Build connection config from environment variables."""
    is_local = os.getenv("IS_LOCAL", "false").lower() == "true"
    return {
        "host": os.getenv("POSTGRES_HOST") or "localhost",
        "port": int(os.getenv("POSTGRES_PORT") or "5432"),
        "dbname": os.getenv("POSTGRES_NAME") or "postgres",
        "user": os.getenv("POSTGRES_USER") or "postgres",
        "password": os.getenv("POSTGRES_PASS") or "postgres123",
        "sslmode": "prefer" if is_local else "require",
    }


def get_connection():
    """Reuse a module-level connection across Lambda invocations."""
    global PG_CONN
    if PG_CONN is None or PG_CONN.closed:
        PG_CONN = connect(**get_config(), row_factory=dict_row, autocommit=True)
    return PG_CONN


def query(sql, params=None, fetch="all"):
    """Run a SQL statement. fetch: 'all', 'one', or None."""
    conn = get_connection()
    with conn.cursor() as cur:
        cur.execute(sql, params or ())
        if fetch == "all":
            return cur.fetchall()
        if fetch == "one":
            return cur.fetchone()
        return None


def init_schema():
    """Create tables if they don't exist. Safe to call repeatedly."""
    query("""
        CREATE TABLE IF NOT EXISTS projects (
            id              SERIAL PRIMARY KEY,
            name            VARCHAR(200) NOT NULL,
            department      VARCHAR(100),
            status          VARCHAR(50) NOT NULL DEFAULT 'planning',
            start_date      DATE,
            due_date        DATE,
            budget_planned  NUMERIC(14,2) DEFAULT 0,
            budget_spent    NUMERIC(14,2) DEFAULT 0,
            created_at      TIMESTAMP DEFAULT NOW()
        )
    """, fetch=None)