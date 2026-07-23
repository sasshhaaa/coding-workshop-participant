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
that is created as a viewer. To see role-based access in action, register a
second account through the Create account tab and sign in as it — every
create, edit, and delete control disappears, replaced by a read-only notice.

To promote someone, an admin can `PUT /api/auth-service/{id}` with a new role.

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
against the 20% threshold, so the definition is stated explicitly here, in
the tooltip on the dashboard, and in the SQL comment. A team of 4 with 1
contractor reads 25%, not 33%.

**Project health is derived, never typed in.**
A project turns red when it is overdue, cancelled, or over budget; amber when
it is on hold, due within 14 days, or when elapsed time outruns progress by
25 points or more. Because it is computed, a project that is 80% through its
schedule at 40% complete flags *before* the deadline rather than after.

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
actual rule.

**Password hashing and JWTs use the standard library.**
`bcrypt` and `PyJWT` weren't available in the environment, so passwords use
PBKDF2-HMAC-SHA256 at 120,000 rounds with a per-user salt, and tokens are
HS256 JWTs signed with `hmac`. Both are legitimate implementations rather
than shortcuts, and comparisons are constant-time so response timing can't
leak the hash.

**Failed logins don't reveal whether an account exists.**
Wrong password and unknown email both return "Email or password is
incorrect". Requesting a one-time code returns the same message either way.
Without this, the endpoints could be used to enumerate which staff have
accounts.

**Self-registration cannot choose a role.**
The first account bootstraps an admin so the system is usable; every account
after that is created as a viewer regardless of what the request contains.
Honouring a self-selected role would be privilege escalation.

---

## Testing

**This is the weakest area of the submission and I'd rather say so than
have it discovered.**

What has been verified:

- Manual end-to-end testing of every CRUD path through the interface
- Direct API testing with `curl` against each service
- Role behaviour confirmed by signing in as admin and as viewer
- Validation failures confirmed to return 400 with readable messages

What is missing: an automated suite. There is a single `test_crud.py` in
`teams-service`, far short of the 80% coverage target.

If I had more time, the order I would write them in:

1. `validate()` in each service — missing fields, bad references, bad enums
2. The analytics query — a team with 1 of 4 non-direct must report 25%, and a
   team with zero members must not divide by zero
3. `rag_status()` — overdue is red, due-in-10-days is amber, on-track is green
4. Status codes — 201 on create, 404 on missing, 400 on invalid, 204 on delete
5. Frontend component tests for `EntityDialog` validation

Those are ordered by consequence, not by ease. The metrics are the entire
point of the tool, so proving they're arithmetically correct matters more
than covering the CRUD plumbing.

---

## Known gaps

**Authorisation is enforced in the interface, not yet on every endpoint.**
The auth service checks tokens and roles. The CRUD services do not — a viewer
who bypassed the browser with curl could still write. The router already
forwards the `Authorization` header, so the fix is a shared middleware
imported by each service; it is the next thing I would build.

**`postgres_service.py` is duplicated across service folders.** A Lambda
deploys as a self-contained zip and can't import from a sibling directory, so
each service needs its own copy. The proper fix is a single shared source that
the build script copies into each service at package time, keeping one source
of truth in git. Currently there are six copies.

**One-time code sign-in is built but not exposed.** The endpoints work —
codes are hashed, expire after 10 minutes, and lock out after five wrong
attempts — but no email provider is configured, so `send_code()` prints to the
server log instead of sending. Swapping in SES means changing that one
function; the rest of the flow is unaffected. It is hidden in the UI rather
than shipped half-working.

**The cloud deployment is out of date.** The CloudFront site predates the
current build. Redeploying needs `api.js` to read the API URL from
`import.meta.env.VITE_API_URL` rather than the hardcoded localhost value, and
`JWT_SECRET` set as a real Lambda environment variable rather than falling
back to its development default.

**Some projects have no team.** Rows created before `team_id` was added are
unassigned. They can be reassigned through the budget allocation dialog on the
dashboard, which shows a team selector for each project.

**`teams.org_leader` is free text, not a foreign key.** It stores a name
rather than referencing `individuals`, so it can't be validated and won't
update if that person is renamed.

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
curl -i http://localhost:3002/api/teams-service
curl -s http://localhost:3002/api/teams-service/analytics | python3 -m json.tool
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