"""PostgreSQL connection, schema, and query helpers."""

import os
from psycopg import connect
from psycopg.rows import dict_row

PG_CONN = None


def get_config():
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
    global PG_CONN
    if PG_CONN is None or PG_CONN.closed:
        PG_CONN = connect(**get_config(), row_factory=dict_row, autocommit=True)
    return PG_CONN


def query(sql, params=None, fetch="all"):
    conn = get_connection()
    with conn.cursor() as cur:
        cur.execute(sql, params or ())
        if fetch == "all":
            return cur.fetchall()
        if fetch == "one":
            return cur.fetchone()
        return None


def init_schema():
    """Create all tables if they don't exist. Safe to call repeatedly."""
    query("""
        CREATE TABLE IF NOT EXISTS teams (
            id          SERIAL PRIMARY KEY,
            name        VARCHAR(150) NOT NULL UNIQUE,
            location    VARCHAR(100) NOT NULL,
            leader_id   INTEGER,
            org_leader  VARCHAR(150),
            created_at  TIMESTAMP DEFAULT NOW()
        )
    """, fetch=None)

    query("""
        CREATE TABLE IF NOT EXISTS individuals (
            id          SERIAL PRIMARY KEY,
            name        VARCHAR(150) NOT NULL,
            email       VARCHAR(200) NOT NULL UNIQUE,
            role        VARCHAR(100),
            level       VARCHAR(20) NOT NULL DEFAULT 'member',
            staff_type  VARCHAR(20) NOT NULL DEFAULT 'direct',
            location    VARCHAR(100) NOT NULL,
            team_id     INTEGER REFERENCES teams(id) ON DELETE SET NULL,
            created_at  TIMESTAMP DEFAULT NOW()
        )
    """, fetch=None)

    query("""
        CREATE TABLE IF NOT EXISTS achievements (
            id          SERIAL PRIMARY KEY,
            team_id     INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
            title       VARCHAR(200) NOT NULL,
            description TEXT,
            month       DATE NOT NULL,
            impact      VARCHAR(20) NOT NULL DEFAULT 'medium',
            created_at  TIMESTAMP DEFAULT NOW()
        )
    """, fetch=None)

    query("""
        CREATE TABLE IF NOT EXISTS metadata (
            id          SERIAL PRIMARY KEY,
            entity_type VARCHAR(20) NOT NULL,
            entity_id   INTEGER NOT NULL,
            key         VARCHAR(100) NOT NULL,
            value       TEXT,
            created_at  TIMESTAMP DEFAULT NOW(),
            UNIQUE (entity_type, entity_id, key)
        )
    """, fetch=None)