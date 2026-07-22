"""Seed demo data for the teams service."""

import postgres_service as db

db.init_schema()

db.query("TRUNCATE metadata, achievements, individuals, teams RESTART IDENTITY CASCADE", fetch=None)

teams = [
    ("Platform engineering", "London", "Anita Desai"),
    ("Data science", "Chennai", "Anita Desai"),
    ("Customer success", "New York", None),
]
for name, loc, org in teams:
    db.query(
        "INSERT INTO teams (name, location, org_leader) VALUES (%s, %s, %s)",
        (name, loc, org), fetch=None)

people = [
    ("Priya Raman", "priya@acme.com", "Engineering manager", "lead", "direct", "Singapore", 1),
    ("Tom Okafor", "tom@acme.com", "Backend engineer", "member", "direct", "London", 1),
    ("Mei Chen", "mei@acme.com", "SRE contractor", "member", "non-direct", "Singapore", 1),
    ("Raj Patel", "raj@acme.com", "Graduate engineer", "junior", "direct", "London", 1),
    ("Arun Nair", "arun@acme.com", "Data lead", "lead", "direct", "Chennai", 2),
    ("Divya Menon", "divya@acme.com", "Data scientist", "member", "direct", "Chennai", 2),
    ("Sam Cole", "sam@acme.com", "Success manager", "member", "direct", "New York", 3),
]
for p in people:
    db.query("""
        INSERT INTO individuals
            (name, email, role, level, staff_type, location, team_id)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
    """, p, fetch=None)

db.query("UPDATE teams SET leader_id = 1 WHERE id = 1", fetch=None)
db.query("UPDATE teams SET leader_id = 5 WHERE id = 2", fetch=None)

achievements = [
    (1, "Cut deploy time by 60%", "2026-06-01", "high"),
    (1, "Zero P1 incidents", "2026-07-01", "medium"),
    (2, "Churn model shipped", "2026-06-01", "high"),
]
for a in achievements:
    db.query("""
        INSERT INTO achievements (team_id, title, month, impact)
        VALUES (%s, %s, %s, %s)
    """, a, fetch=None)

db.query("""
    INSERT INTO metadata (entity_type, entity_id, key, value)
    VALUES ('team', 1, 'cost_centre', 'CC-4471'),
           ('team', 1, 'function', 'Engineering')
""", fetch=None)

print("Seeded:", db.query("SELECT COUNT(*) AS c FROM teams", None, "one")["c"], "teams,",
      db.query("SELECT COUNT(*) AS c FROM individuals", None, "one")["c"], "people")