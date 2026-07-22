import json
from function import handler


def call(method, body=None, rid=None):
    event = {"httpMethod": method}
    if body:
        event["body"] = json.dumps(body)
    if rid:
        event["pathParameters"] = {"id": rid}
    r = handler(event)
    print(f"{method} -> {r['statusCode']}: {r['body'][:200]}")
    return r


print("\n--- CREATE ---")
r = call("POST", {
    "name": "Customer Portal Redesign",
    "department": "Engineering",
    "status": "active",
    "start_date": "2026-06-01",
    "due_date": "2026-09-30",
    "budget_planned": 250000,
    "budget_spent": 82000,
})
pid = str(json.loads(r["body"])["id"])

call("POST", {
    "name": "Data Warehouse Migration",
    "department": "Data",
    "status": "planning",
    "budget_planned": 400000,
    "budget_spent": 15000,
})

print("\n--- READ ALL ---")
call("GET")

print("\n--- READ ONE ---")
call("GET", rid=pid)

print("\n--- UPDATE ---")
call("PUT", {
    "name": "Customer Portal Redesign v2",
    "department": "Engineering",
    "status": "on_hold",
    "budget_planned": 250000,
    "budget_spent": 90000,
}, rid=pid)

print("\n--- VALIDATION (expect 400) ---")
call("POST", {"name": "", "status": "bogus"})

print("\n--- NOT FOUND (expect 404) ---")
call("GET", rid="99999")