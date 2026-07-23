# ACME Team Management

A self-service tool for tracking team structure, people, delivery, and spend
across an organisation.

Built for the Citi Coding Workshop — Full Stack track.

---

## The problem

Information about team structure and performance was scattered across
systems, so questions that should take seconds took a day of spreadsheet work:

- Who are the members of each team?
- Where are the teams located?
- What has each team achieved, month by month?
- How many teams have a leader who isn't co-located with their team?
- How many teams are led by non-direct staff?
- How many teams have a non-direct to total headcount ratio above 20%?
- How many teams report to an organisation leader?

All seven are answered on the dashboard, live, without running a query.

---

## Running it locally

Three processes. Each needs its own terminal.

```bash
# 0. Database — should already be running
pg_isready -h localhost -p 5432

# 1. Backend API (leave running)
cd backend
python3 router.py          # http://localhost:3002

# 2. Frontend (leave running)
cd frontend
npm install                # first time only
npm run dev                # http://localhost:3000
```

Open http://localhost:3000 and sign in.

### Demo credentials

| Email | Password | Role |
|---|---|---|
| sasha@acme.com | workshop123 | Admin |

The **first account ever registered becomes an admin**; every account after
that is created as a viewer, regardless of what the request asks for.

To see role-based access working, register a second account through the
Create account tab and sign in as it. Every create, edit, and delete control
disappears, replaced by a read-only notice — and the API refuses those
operations too, not just the interface.

An admin can promote someone with `PUT /api/auth-service/{id}`.

### Seeding

```bash
cd backend/teams-service
python3 seed.py
```

Loads a small organisation deliberately shaped to exercise the metrics: one
team whose lead sits in a different city, one contractor pushing a team past
the 20% threshold, and teams both with and without an org leader. Without
this, every metric reads zero and you can't tell working code from broken.

---

## Testing

```bash
pytest backend/ -q                              # run everything
pytest backend/ --cov=backend --cov-report=term # with coverage
pytest backend/projects-service -v              # one service
```

**233 tests, 90% backend coverage, running in under a second.**

| Service | Coverage |
|---|---|
| teams | 99% |
| achievements | 95% |
| auth | 93% |
| projects | 91% |
| metadata | 89% |
| individuals | 85% |

The suite covers the derived logic the tool depends on, the boundaries around
it, and the security guarantees:

- **Business rules** — a team of 4 with 1 contractor reads 25%, and 20% itself
  is not "over 20%"
- **Boundaries** — a project due in 14 days is amber, one due in 15 is green
- **Edge cases** — an empty team must not divide by zero, an overdue project
  is 100% elapsed rather than 300%, a completed project stays complete even
  if it finished late
- **Security** — a viewer's token with the role edited to `admin` is rejected
  by the signature check; failed logins give the same reply whether or not the
  account exists; the last admin cannot demote themselves out of the system
- **Status codes** — 200, 201, 204, 400, 404, and 500 each asserted, including
  that a database failure returns a clean error rather than a stack trace

Tests run against a fake database rather than a live one, so they need no
setup and finish in milliseconds. Where a fake had to distinguish between two
different queries, it does so on the parameters — which is itself documented
in the test file.

Two things the suite found that manual testing had not: a module-name
collision where every service's `function.py` shadowed the others, so tests
were silently running against the wrong code; and a deprecated `datetime`
call that works today and breaks on a future Python.

### Known gaps in testing

`postgres_service.py` sits at 32%, because exercising it properly needs a live
database — that's integration testing rather than unit testing, and it is
excluded from the target rather than faked into a misleading number.

There are no frontend component tests and no end-to-end suite. Frontend
behaviour was verified manually across every user journey, including signing
in as each role to confirm the interface changes.

`.coveragerc` excludes `router.py`, `seed.py`, and `service.py` with a comment
explaining why each: they are development scaffolding that never deploys.

---

## Architecture

```
Browser
  │
  ├── React + Material UI          :3000   (Vite dev server / S3 + CloudFront)
  │
  └── HTTP
        │
      router.py                    :3002   (stands in for AWS API Gateway)
        │
        ├── auth-service           ─┐
        ├── teams-service           │
        ├── individuals-service     ├─ Lambda-style handlers
        ├── projects-service        │
        ├── achievements-service    │
        └── metadata-service       ─┘
                │
           PostgreSQL              :5432   (Aurora in the cloud)
```

Each service is a folder containing a `function.py` with the AWS Lambda
handler signature — it takes an `event` dict and returns
`{statusCode, headers, body}`. That shape is why the same code runs locally
and deploys to Lambda unchanged.

`router.py` is **local development only**. It imports each handler at startup,
matches incoming URLs against service names, builds a Lambda-shaped event, and
translates the return value into a real HTTP response. In AWS, API Gateway
does this job and `router.py` is not deployed.

### Frontend structure

```
frontend/src/
  App.jsx              routing between screens, session restore, account menu
  theme.js             every colour and spacing value, in one place
  services/
    api.js             axios client, token interceptor, one CRUD factory
    auth.js            token storage, role permission table
  pages/
    Login.jsx          sign in and registration
    Dashboard.jsx      org metrics, team list, budget allocation
    TeamDetail.jsx     hierarchy, projects, achievements, metadata
  components/
    EntityDialog.jsx   one form component, driven by a field definition array
```

---

## Security

**Authentication.** Passwords are stored as PBKDF2-HMAC-SHA256 hashes at
120,000 rounds with a per-user random salt, and compared in constant time.
Sessions are HS256 JWTs carrying the user's id, email, name, role, and an
expiry.

**Authorisation is enforced twice, and the second one is the real one.**
`auth_guard.py` sits in `backend/` and is imported by every service. It reads
the bearer token, maps the HTTP method to an action, and checks the role
against a single permission table:

| Role | Read | Create | Update | Delete |
|---|---|---|---|---|
| Admin | ✓ | ✓ | ✓ | ✓ |
| Manager | ✓ | ✓ | ✓ | ✓ |
| Contributor | ✓ | ✓ | ✓ | — |
| Viewer | ✓ | — | — | — |

The check runs *before* any database work, so an unauthorised request never
reaches Postgres. The interface hiding a button is a convenience; this is the
rule. Verified directly:

```bash
curl -X DELETE http://localhost:3002/api/teams-service/1
# 401 — no token
```

The table lives in one module rather than being copied per service, because a
role that could delete in one place and not another would be a bug waiting to
happen. Only `auth-service` is unguarded, since guarding the login endpoint
would make signing in impossible.

**Other properties, each with a test:**

- A token with its payload edited to escalate a role fails the signature check
- Wrong password and unknown email return byte-identical responses, so the
  endpoint can't be used to discover which staff have accounts
- Self-registration ignores any submitted role — the first account bootstraps
  an admin, everyone else starts as a viewer
- The last remaining admin cannot demote themselves and lock everyone out
- One-time codes are stored hashed, expire after 10 minutes, and lock out
  after five wrong attempts

---

## Data model

| Table | Purpose |
|---|---|
| `teams` | name, location, leader, reporting line |
| `individuals` | people, with level and staff type |
| `achievements` | monthly wins, with an impact rating |
| `metadata` | key/value attributes on teams or individuals |
| `projects` | delivery work with dates, progress, and budget |
| `project_members` | join table: people assigned to projects |
| `users` | accounts, password hashes, roles |
| `login_codes` | one-time sign-in codes |

`individuals.team_id → teams.id` and `teams.leader_id → individuals.id` point
at each other, which is why `leader_id` is nullable — one has to exist before
the other can reference it.

Deleting a team **cascades** to its achievements and projects, but only
**nulls** `individuals.team_id`. That asymmetry is deliberate: people outlast
teams and shouldn't vanish when one is dissolved.

---

## Decisions and trade-offs

**Derived values are computed in SQL, not the interface.**
`non_direct_pct`, `leader_offsite`, and the RAG health signals come back from
the API already calculated. If two components each did their own arithmetic
they would eventually disagree, and a metric that reads 33% on one screen and
25% on another is worse than no metric at all. One source, one answer.

**"Non-direct ratio" means non-direct ÷ total headcount.**
The other plausible reading — non-direct ÷ direct — gives different answers
against the 20% threshold, so the definition is stated explicitly here, in the
tooltip on the dashboard, and in a test. A team of 4 with 1 contractor reads
25%, not 33%.

**Project health is derived, never typed in.**
A project turns red when it is overdue, cancelled, or over budget; amber when
it is on hold, due within 14 days, when elapsed time outruns progress by 25
points or more, or when budget burn outruns progress by the same margin.
Because it is computed, a project 80% through its schedule at 40% complete
flags *before* the deadline rather than after.

**Metadata is a key/value table rather than columns.**
Cost centre, tech stack, and formation date vary by team — some have them,
some don't. A column per attribute means a schema change every time someone
thinks of a new one. The trade-off is real: everything is stored as text, so
the database can't enforce that a date is a date, and querying "all teams in
cost centre CC-4471" is clumsier than it would be with a real column. That is
the right trade for optional attributes and the wrong one for anything core,
which is why location stays a proper column.

**Validation runs twice, on purpose.**
The frontend catches mistakes instantly so the user isn't waiting on a round
trip. The backend catches them again because anyone can bypass the browser
with curl. Frontend validation is a convenience; backend validation is the
actual rule — the same reasoning as the authorisation guard.

**Password hashing and JWTs use the standard library.**
`bcrypt` and `PyJWT` weren't available in the environment, so passwords use
PBKDF2 and tokens are signed with `hmac`. Both are legitimate implementations
rather than shortcuts, and the properties that matter — per-user salts,
constant-time comparison, signature verification, expiry — each have a test.

---

## Known gaps

**`postgres_service.py` is duplicated across service folders.** A Lambda
deploys as a self-contained zip and can't import from a sibling directory, so
each service needs its own copy. `auth_guard.py` has the same constraint,
solved locally by the router putting `backend/` on the import path and in the
cloud by the deploy script copying it into each bundle. The same treatment
should be applied to `postgres_service.py`; currently there are six copies.

**One-time code sign-in is built but not exposed.** The endpoints work and are
tested, but no email provider is configured, so `send_code()` prints to the
server log instead of sending. Swapping in SES means changing that one
function. It is hidden in the UI rather than shipped half-working.

**The cloud deployment is out of date.** The CloudFront site predates the
current build. Redeploying needs `api.js` to read the API URL from
`import.meta.env.VITE_API_URL` rather than the hardcoded localhost value, and
`JWT_SECRET` set as a real Lambda environment variable rather than falling
back to its development default.

**No frontend or end-to-end test suite.** Component tests with React Testing
Library and a Cypress journey would be the next thing to add.

**`teams.org_leader` is free text, not a foreign key.** It stores a name
rather than referencing `individuals`, so it can't be validated and won't
update if that person is renamed.

**No audit trail.** Nothing records who changed what and when. Useful for a
tool holding organisational data, and not currently built.

---

## API reference

Every service follows the same shape, where `{service}` is one of
`teams-service`, `individuals-service`, `projects-service`,
`achievements-service`, or `metadata-service`.

| Method | Path | Returns |
|---|---|---|
| GET | `/api/{service}` | 200, list |
| GET | `/api/{service}/{id}` | 200, or 404 |
| POST | `/api/{service}` | 201, or 400 with details |
| PUT | `/api/{service}/{id}` | 200, 400, or 404 |
| DELETE | `/api/{service}/{id}` | 204, or 404 |

All of the above require a bearer token, and return 401 without one or 403
when the role lacks permission.

Additional endpoints:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/teams-service/analytics` | Org metrics plus every team with stats |
| POST | `/api/auth-service/register` | Create an account, returns a token |
| POST | `/api/auth-service/login` | Sign in, returns a token |
| GET | `/api/auth-service/me` | Current user from the bearer token |
| PUT | `/api/auth-service/{id}` | Change a role (admin only) |

Query parameters: `team_id`, `status`, `impact`, `entity_type`, `entity_id`,
`search` — depending on the service.

Errors are consistent:

```json
{ "error": "Validation failed", "details": ["name is required"] }
```

### Checking a service by hand

```bash
# Sign in and keep the token
TOKEN=$(curl -s -X POST http://localhost:3002/api/auth-service/login \
  -H "Content-Type: application/json" \
  -d '{"email":"sasha@acme.com","password":"workshop123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

curl -i http://localhost:3002/api/teams-service \
  -H "Authorization: Bearer $TOKEN"
```

---

## Deploying

```bash
./bin/deploy-backend.sh     # zips each service to Lambda, applies Terraform
./bin/deploy-frontend.sh    # builds React, uploads to S3, invalidates the CDN
```

Backend first — it prints the API Gateway URL that the frontend build needs.
Vite inlines environment variables at build time, so the URL must be set
*before* `npm run build`, not after.

CloudFront caches aggressively. If a deploy appears to change nothing:

```bash
aws cloudfront create-invalidation --distribution-id <ID> --paths "/*"
```

Local and cloud have separate databases. Data created in one does not appear
in the other.