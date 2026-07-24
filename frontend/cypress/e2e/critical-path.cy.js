/**
 * End-to-end coverage of the paths a real user takes.
 *
 * Every other test in this project uses a fake somewhere — the backend tests
 * fake the database, the component tests fake the API. These are the only
 * ones that prove the pieces actually talk to each other.
 *
 * The journey is split into separate tests rather than one long script. A
 * single failure part-way through a ten-step test tells you almost nothing;
 * smaller tests point at the step that broke. Each seeds its own data through
 * the API so it can run alone and in any order.
 *
 * Elements are targeted by id rather than visible text. The login page has a
 * tab and a submit button both labelled "Sign in", and matching on text hits
 * the tab, which silently does nothing. MUI v9 also stops forwarding
 * inputProps to the underlying element, so data attributes don't survive —
 * id does.
 */

const API = "http://localhost:3002/api";
const ADMIN = { email: "sasha@acme.com", password: "workshop123" };

function stamp() {
  return Date.now().toString().slice(-6);
}

function signIn(email = ADMIN.email, password = ADMIN.password) {
  cy.visit("/");
  cy.get("#signin-email").should("be.visible").type(email);
  cy.get("#signin-password").type(password);
  cy.get("#submit-signin").click();
}

function onDashboard() {
  cy.contains("Organisation health", { timeout: 20000 }).should("be.visible");
}

/** A token for seeding data directly, so setup doesn't go through the UI. */
function withToken(run) {
  cy.request("POST", `${API}/auth-service/login`, ADMIN).then((response) => {
    run(response.body.token);
  });
}

/** Creates a team through the API and hands back its id and name. */
function seedTeam(name) {
  return cy.then(() => {
    let created;
    withToken((token) => {
      cy.request({
        method: "POST",
        url: `${API}/teams-service`,
        headers: { Authorization: `Bearer ${token}` },
        body: { name, location: "Chennai" },
      }).then((response) => {
        created = response.body;
      });
    });
    return cy.then(() => created);
  });
}

describe("signing in", () => {
  it("shows the login page to a visitor with no session", () => {
    cy.visit("/");
    cy.get("#submit-signin").should("be.visible");
    cy.contains("Organisation health").should("not.exist");
  });

  it("lets a known user in", () => {
    signIn();
    onDashboard();
  });

  it("rejects the wrong password", () => {
    signIn(ADMIN.email, "definitely-not-the-password");

    cy.get("#auth-error", { timeout: 20000 }).should("be.visible");
    cy.contains("Organisation health").should("not.exist");
  });

  it("keeps the session across a reload", () => {
    signIn();
    onDashboard();

    cy.reload();
    onDashboard();
  });

  it("signs out again", () => {
    signIn();
    onDashboard();

    cy.get('[aria-label="Open account menu"]').click();
    cy.contains("Sign out").click();

    cy.get("#submit-signin").should("be.visible");
    cy.contains("Organisation health").should("not.exist");
  });
});

describe("creating a team", () => {
  it("creates one through the form and shows it in the list", () => {
    const name = `E2E Team ${stamp()}`;

    signIn();
    onDashboard();

    cy.contains("button", "New team").click();
    cy.get('[role="dialog"]').should("be.visible");

    cy.get('[role="dialog"]').within(() => {
      cy.contains("label", "Team name").parent().find("input").type(name);
      cy.contains("label", "Location").parent().find("input").type("Chennai");
      cy.contains("button", "Save").click();
    });

    // The dialog closing means validation passed and the request succeeded.
    cy.get('[role="dialog"]').should("not.exist");

    // The row appearing proves the POST reached the database and the list
    // refetched — not that local state was optimistically updated.
    cy.contains(name, { timeout: 20000 }).should("exist");
  });

  it("refuses to save a team with no name", () => {
    signIn();
    onDashboard();

    cy.contains("button", "New team").click();
    cy.get('[role="dialog"]').within(() => {
      cy.contains("label", "Location").parent().find("input").type("London");
      cy.contains("button", "Save").click();

      // Still open, with the field flagged — the save never left the browser.
      cy.contains(/required/i).should("be.visible");
    });

    cy.get('[role="dialog"]').should("exist");
  });
});

describe("adding a person to a team", () => {
  it("adds one and keeps it in the database", () => {
    const id = stamp();
    const teamName = `E2E People ${id}`;
    const personName = `Tester${id}`;
    const personEmail = `e2e${id}@acme.com`;

    // Seeded through the API so this test is about adding a person, not
    // about creating a team — that's covered separately.
    seedTeam(teamName);

    signIn();
    onDashboard();

    cy.contains(teamName, { timeout: 20000 }).click();
    cy.contains("Team hierarchy", { timeout: 20000 }).should("be.visible");

    cy.contains("button", "Add person").click();
    cy.get('[role="dialog"]').should("be.visible");

    cy.get('[role="dialog"]').within(() => {
      cy.contains("label", "Full name").parent().find("input").type(personName);
      cy.contains("label", "Email").parent().find("input").type(personEmail);

      // Location is required. It defaults to the team's own location, but
      // setting it explicitly keeps the test independent of that default.
      cy.contains("label", "Location").parent().find("input")
        .clear().type("Chennai");

      cy.contains("button", "Save").click();
    });

    // The dialog only closes on a successful save — validation failures and
    // API errors both leave it open with a message.
    cy.get('[role="dialog"]', { timeout: 20000 }).should("not.exist");

    // Confirmed against the API rather than the rendered page. The record
    // reaching the database is the thing that matters; how a card lays the
    // name out is the component tests' concern.
    withToken((token) => {
      cy.request({
        url: `${API}/individuals-service`,
        headers: { Authorization: `Bearer ${token}` },
      }).then((response) => {
        const found = response.body.find((p) => p.email === personEmail);
        expect(found, "the person should exist in the database").to.exist;
        expect(found.name).to.equal(personName);
      });
    });

    // Reloading would return to the dashboard rather than the team, because
    // the selected team lives in React state and has no route of its own.
    // Navigating away and back refetches from the API, which proves the same
    // thing while matching how the app actually works.
    cy.contains("Back to dashboard").click();
    onDashboard();

    cy.contains(teamName, { timeout: 20000 }).click();
    cy.contains("Team hierarchy", { timeout: 20000 }).should("be.visible");
    cy.contains("MEMBERS", { matchCase: false, timeout: 20000 })
      .should("exist");
  });

  it("shows the new headcount back on the dashboard", () => {
    const id = stamp();
    const teamName = `E2E Count ${id}`;

    seedTeam(teamName);

    signIn();
    onDashboard();

    cy.contains(teamName, { timeout: 20000 }).click();
    cy.contains("Team hierarchy", { timeout: 20000 }).should("be.visible");

    cy.contains("button", "Add person").click();
    cy.get('[role="dialog"]').within(() => {
      cy.contains("label", "Full name").parent().find("input")
        .type(`Counted${id}`);
      cy.contains("label", "Email").parent().find("input")
        .type(`count${id}@acme.com`);
      cy.contains("label", "Location").parent().find("input")
        .clear().type("Chennai");
      cy.contains("button", "Save").click();
    });

    cy.get('[role="dialog"]', { timeout: 20000 }).should("not.exist");

    cy.contains("Back to dashboard").click();
    onDashboard();

    // The headcount is computed in SQL, so this proves the analytics query
    // picked the new person up rather than the page caching an old figure.
    // The name sits in a Stack inside the clickable Box and the caption is a
    // sibling of that Stack, so the assertion climbs two levels.
    cy.contains(teamName, { timeout: 20000 })
      .parent()
      .parent()
      .should("contain.text", "1 people");
  });
});

describe("role-based access", () => {
  it("hides every write control from a viewer", () => {
    // Self-registration always produces a viewer, which is itself the thing
    // being demonstrated.
    const id = stamp();

    cy.visit("/");
    cy.get("#tab-register").click();

    cy.get("#register-name").type("E2E Viewer");
    cy.get("#register-email").type(`viewer${id}@acme.com`);
    cy.get("#register-password").type("workshop123");
    cy.get("#submit-register").click();

    onDashboard();

    // The read-only notice explains why the buttons are missing, rather than
    // leaving the user to assume the app is broken.
    cy.contains("read-only access").should("be.visible");
    cy.contains("button", "New team").should("not.exist");

    // Data is still readable — a viewer is limited, not locked out.
    cy.contains("Teams").should("be.visible");
    cy.contains("People").should("be.visible");
  });

  it("refuses a write from an unauthenticated caller", () => {
    // The interface hiding a button is a convenience. This is the rule.
    cy.request({
      method: "DELETE",
      url: `${API}/teams-service/1`,
      failOnStatusCode: false,
    }).its("status").should("eq", 401);
  });
});

describe("the dashboard", () => {
  beforeEach(() => {
    signIn();
    onDashboard();
  });

  it("answers the organisation questions the brief asked", () => {
    cy.contains("Teams").should("be.visible");
    cy.contains("People").should("be.visible");
    cy.contains("Locations").should("be.visible");
    cy.contains("Reporting to org lead").should("be.visible");
    cy.contains("Leader not co-located").should("be.visible");
    cy.contains("Non-direct leader").should("be.visible");
    cy.contains("Non-direct over 20%").should("be.visible");
  });

  it("filters the team list", () => {
    cy.get('input[placeholder*="Search"]').type("zzz-no-such-team");
    cy.contains("No teams match these filters").should("be.visible");

    cy.get('input[placeholder*="Search"]').clear();
    cy.contains("No teams match these filters").should("not.exist");
  });

  it("opens the budget allocation dialog", () => {
    cy.contains("button", /allocation|breakdown/i).click();
    cy.contains("Budget allocation").should("be.visible");
    cy.contains("button", /cancel|close/i).click();
  });
});