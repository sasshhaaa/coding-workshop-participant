#!/usr/bin/env python3
"""Populate a deployed environment with a demonstration organisation.

Unlike backend/teams-service/seed.py, which writes to the database directly,
this goes through the public API — so it also proves authentication, role
permissions, validation, and every endpoint work end to end against the
deployed stack.

The data is shaped so that every metric on the dashboard has something to
report. A flat, healthy organisation would leave the whole page reading zero,
which tells you nothing about whether the calculations are right.

Usage:
    python3 bin/seed-cloud.py                      # uses the defaults below
    python3 bin/seed-cloud.py --url https://...    # a different environment
"""

import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import date, timedelta

DEFAULT_URL = "https://d3g3li840feny7.cloudfront.net"
DEFAULT_EMAIL = "sasha.admin@acme.com"


def days(n):
    return (date.today() + timedelta(days=n)).isoformat()


def month(n):
    """The first of a month n months back, in the YYYY-MM the API expects."""
    d = date.today().replace(day=1)
    for _ in range(n):
        d = (d - timedelta(days=1)).replace(day=1)
    return d.strftime("%Y-%m")


class Api:
    def __init__(self, base):
        self.base = base.rstrip("/")
        self.token = None

    def call(self, method, path, body=None):
        url = f"{self.base}/api/{path.lstrip('/')}"
        data = json.dumps(body).encode() if body is not None else None

        request = urllib.request.Request(url, data=data, method=method)
        request.add_header("Content-Type", "application/json")
        if self.token:
            request.add_header("Authorization", f"Bearer {self.token}")

        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read().decode()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            detail = e.read().decode()
            raise RuntimeError(f"{method} {path} -> {e.code}: {detail}") from None

    def sign_in(self, email, password):
        result = self.call("POST", "auth-service/login",
                           {"email": email, "password": password})
        self.token = result["token"]
        return result["user"]


def seed(api):
    created = {"teams": 0, "people": 0, "projects": 0,
               "achievements": 0, "metadata": 0}

    # --- teams -------------------------------------------------------------
    # Leaders are attached afterwards, because a leader has to exist as a
    # person first, and a person has to belong to a team.

    teams = {}
    for name, location, org_leader in [
        ("Platform engineering", "London", "Anita Desai"),
        ("Data science", "Chennai", "Anita Desai"),
        ("Customer success", "New York", None),
        ("Payments", "Singapore", "Marcus Webb"),
    ]:
        body = {"name": name, "location": location}
        if org_leader:
            body["org_leader"] = org_leader
        teams[name] = api.call("POST", "teams-service", body)["id"]
        created["teams"] += 1
        print(f"  team    {name}")

    # --- people ------------------------------------------------------------
    # Mei Chen and Oscar Lund are contractors, which is what pushes their
    # teams past the 20% threshold. Priya leads a London team from Singapore,
    # which is what makes the co-location metric non-zero.

    people = {}
    for name, email, role, level, staff, location, team in [
        ("Priya Raman", "priya@acme.com", "Engineering manager",
         "lead", "direct", "Singapore", "Platform engineering"),
        ("Tom Okafor", "tom@acme.com", "Backend engineer",
         "member", "direct", "London", "Platform engineering"),
        ("Mei Chen", "mei@acme.com", "SRE contractor",
         "member", "non-direct", "Singapore", "Platform engineering"),
        ("Raj Patel", "raj@acme.com", "Graduate engineer",
         "junior", "direct", "London", "Platform engineering"),

        ("Arun Nair", "arun@acme.com", "Data science lead",
         "lead", "direct", "Chennai", "Data science"),
        ("Divya Menon", "divya@acme.com", "Data scientist",
         "member", "direct", "Chennai", "Data science"),
        ("Sara Idris", "sara@acme.com", "Data analyst",
         "junior", "direct", "Chennai", "Data science"),

        ("Sam Cole", "sam@acme.com", "Success manager",
         "lead", "direct", "New York", "Customer success"),
        ("Elena Ruiz", "elena@acme.com", "Account manager",
         "member", "direct", "New York", "Customer success"),

        ("Oscar Lund", "oscar@acme.com", "Payments consultant",
         "lead", "non-direct", "Singapore", "Payments"),
        ("Yara Haddad", "yara@acme.com", "Backend engineer",
         "member", "direct", "Singapore", "Payments"),
        ("Ben Osei", "ben@acme.com", "Platform engineer",
         "member", "direct", "Singapore", "Payments"),
    ]:
        person = api.call("POST", "individuals-service", {
            "name": name, "email": email, "role": role,
            "level": level, "staff_type": staff,
            "location": location, "team_id": teams[team],
        })
        people[name] = person["id"]
        created["people"] += 1
        print(f"  person  {name}")

    # --- leaders -----------------------------------------------------------
    # Priya sits in Singapore while her team is in London, and Oscar is a
    # contractor leading Payments. Both are deliberate: without them the
    # "leader not co-located" and "non-direct leader" cards would read zero
    # and you couldn't tell working code from broken.

    for team_name, leader, location, org_leader in [
        ("Platform engineering", "Priya Raman", "London", "Anita Desai"),
        ("Data science", "Arun Nair", "Chennai", "Anita Desai"),
        ("Customer success", "Sam Cole", "New York", None),
        ("Payments", "Oscar Lund", "Singapore", "Marcus Webb"),
    ]:
        body = {
            "name": team_name, "location": location,
            "leader_id": people[leader],
        }
        if org_leader:
            body["org_leader"] = org_leader
        api.call("PUT", f"teams-service/{teams[team_name]}", body)
        print(f"  lead    {team_name} -> {leader}")

    # --- projects ----------------------------------------------------------
    # One of each health state, so the red/amber/green logic is visible
    # rather than assumed.

    for team, name, description, status, start, due, progress, planned, spent in [
        ("Platform engineering", "Deployment pipeline rebuild",
         "Cut release time from hours to minutes",
         "active", days(-90), days(45), 65, 120000, 71000),

        ("Platform engineering", "Legacy monolith decomposition",
         "Extract billing and identity into their own services",
         "active", days(-200), days(-12), 70, 300000, 340000),

        ("Data science", "Churn prediction model",
         "Flag at-risk accounts a quarter ahead",
         "active", days(-60), days(9), 80, 90000, 62000),

        ("Data science", "Feature store",
         "Shared feature definitions across teams",
         "planning", days(14), days(180), 0, 150000, 0),

        ("Customer success", "Onboarding revamp",
         "Reduce time to first value for new accounts",
         "completed", days(-240), days(-30), 100, 60000, 54000),

        ("Payments", "Settlement latency reduction",
         "Bring end-to-end settlement under two seconds",
         "active", days(-120), days(120), 35, 250000, 180000),

        ("Payments", "Card tokenisation",
         "Remove raw card numbers from every downstream system",
         "on_hold", days(-45), days(90), 20, 80000, 15000),
    ]:
        api.call("POST", "projects-service", {
            "team_id": teams[team], "name": name, "description": description,
            "status": status, "start_date": start, "due_date": due,
            "progress_pct": progress,
            "budget_planned": planned, "budget_spent": spent,
        })
        created["projects"] += 1
        print(f"  project {name}")

    # --- achievements ------------------------------------------------------
    # Spread across months with a deliberate gap, so the momentum chart shows
    # a shape rather than a flat line.

    for team, title, description, months_ago, impact in [
        ("Platform engineering", "Halved deploy time",
         "Pipeline rebuild landed ahead of schedule", 4, "high"),
        ("Platform engineering", "Zero-downtime migration",
         "Moved the primary database with no customer impact", 4, "high"),
        ("Platform engineering", "Onboarding guide rewritten",
         "New joiners productive in days rather than weeks", 1, "low"),

        ("Data science", "Churn model in production",
         "First model serving live traffic", 3, "high"),
        ("Data science", "Data quality dashboard",
         "Broken pipelines now surface within the hour", 2, "medium"),
        ("Data science", "Feature parity with the legacy system",
         "Retired the last spreadsheet-based report", 0, "medium"),

        ("Customer success", "Onboarding time down 40%",
         "New accounts reach first value in under a week", 2, "high"),
        ("Customer success", "Quarterly review template",
         "Consistent reporting across every account", 0, "low"),

        ("Payments", "Settlement latency under 3s",
         "Down from eleven seconds at the start of the year", 1, "high"),
        ("Payments", "PCI audit passed",
         "No findings raised", 3, "medium"),
    ]:
        api.call("POST", "achievements-service", {
            "team_id": teams[team], "title": title,
            "description": description,
            "month": month(months_ago), "impact": impact,
        })
        created["achievements"] += 1
        print(f"  win     {title}")

    # --- metadata ----------------------------------------------------------
    # The attributes that vary by team and don't justify a column each.

    for team, key, value in [
        ("Platform engineering", "cost_centre", "CC-4471"),
        ("Platform engineering", "function", "Engineering"),
        ("Platform engineering", "tech_stack", "Python, Kubernetes, Terraform"),
        ("Platform engineering", "formed", "2023-04"),

        ("Data science", "cost_centre", "CC-2210"),
        ("Data science", "function", "Analytics"),
        ("Data science", "tech_stack", "Python, dbt, Snowflake"),

        ("Customer success", "cost_centre", "CC-1120"),
        ("Customer success", "function", "Commercial"),

        ("Payments", "cost_centre", "CC-8830"),
        ("Payments", "function", "Engineering"),
        ("Payments", "compliance", "PCI DSS Level 1"),
    ]:
        api.call("POST", "metadata-service", {
            "entity_type": "team", "entity_id": teams[team],
            "key": key, "value": value,
        })
        created["metadata"] += 1

    print(f"  meta    {created['metadata']} attributes")
    return created


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--email", default=DEFAULT_EMAIL)
    parser.add_argument("--password", default="workshop123")
    args = parser.parse_args()

    api = Api(args.url)

    print(f"Signing in to {args.url}")
    try:
        user = api.sign_in(args.email, args.password)
    except RuntimeError as e:
        print(f"\nCould not sign in: {e}")
        print("Check the email and password, or pass --email and --password.")
        return 1

    print(f"Signed in as {user['name']} ({user['role']})\n")

    if user["role"] not in ("admin", "manager"):
        print("This account cannot create records. Sign in as an admin.")
        return 1

    try:
        created = seed(api)
    except RuntimeError as e:
        # Most likely cause is running twice — names and emails are unique.
        print(f"\nStopped: {e}")
        print("\nIf this says something already exists, the environment has "
              "been seeded before. Delete the existing teams first, or seed "
              "a fresh environment.")
        return 1

    print("\nDone.")
    for label, count in created.items():
        print(f"  {count:>3} {label}")

    print(f"\nOpen {args.url} and sign in to see it.")
    print("\nWhat the dashboard should show:")
    print("  4 teams, 12 people, 4 locations, 3 reporting to an org leader")
    print("  1 team with a leader who isn't co-located (Priya, London/Singapore)")
    print("  1 team led by non-direct staff (Oscar, Payments)")
    print("  2 teams over the 20% non-direct threshold")
    print("  1 project overdue, 1 at risk, 1 on hold, 1 over budget")
    return 0


if __name__ == "__main__":
    sys.exit(main())