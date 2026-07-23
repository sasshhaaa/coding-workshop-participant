import { describe, it, expect, beforeEach } from "vitest";
import { can, ROLES, authError, setToken, getToken } from "./auth";

/**
 * The permission table decides what every screen shows. If it's wrong, either
 * someone sees a button they can't use, or they lose one they should have.
 */
describe("role permissions", () => {
  it("lets an admin do everything", () => {
    for (const action of ["create", "update", "delete", "manageUsers"]) {
      expect(can("admin", action)).toBe(true);
    }
  });

  it("lets a manager work with records but not users", () => {
    expect(can("manager", "create")).toBe(true);
    expect(can("manager", "update")).toBe(true);
    expect(can("manager", "delete")).toBe(true);
    expect(can("manager", "manageUsers")).toBe(false);
  });

  it("lets a contributor add and edit but never delete", () => {
    expect(can("contributor", "create")).toBe(true);
    expect(can("contributor", "update")).toBe(true);
    expect(can("contributor", "delete")).toBe(false);
  });

  it("gives a viewer no write access at all", () => {
    for (const action of ["create", "update", "delete", "manageUsers"]) {
      expect(can("viewer", action)).toBe(false);
    }
  });

  it("denies anything for an unrecognised role", () => {
    // A role added to the database but not the table must fail closed,
    // not open.
    expect(can("superuser", "delete")).toBe(false);
    expect(can("", "create")).toBe(false);
    expect(can(undefined, "update")).toBe(false);
  });

  it("denies an action the table doesn't define", () => {
    expect(can("admin", "launchMissiles")).toBe(false);
  });

  it("only permits delete for roles that should have it", () => {
    const allowed = ROLES.filter((role) => can(role, "delete"));
    expect(allowed).toEqual(["admin", "manager"]);
  });

  it("lists exactly the four documented roles", () => {
    expect(ROLES).toEqual(["admin", "manager", "contributor", "viewer"]);
  });
});

describe("token storage", () => {
  beforeEach(() => {
    setToken(null);
  });

  it("stores and returns a token", () => {
    setToken("abc.def.ghi");
    expect(getToken()).toBe("abc.def.ghi");
  });

  it("clears the token on sign out", () => {
    setToken("abc.def.ghi");
    setToken(null);
    expect(getToken()).toBeNull();
  });

  it("keeps working when storage is unavailable", () => {
    // Private browsing can make sessionStorage throw. Signing in should
    // still work for the current tab rather than failing outright.
    const original = window.sessionStorage.setItem;
    window.sessionStorage.setItem = () => {
      throw new Error("storage disabled");
    };

    expect(() => setToken("abc.def.ghi")).not.toThrow();
    expect(getToken()).toBe("abc.def.ghi");

    window.sessionStorage.setItem = original;
  });
});

describe("error messages", () => {
  it("prefers the field-level details the API sends", () => {
    const error = {
      response: { data: { details: ["name is required", "location is required"] } },
    };
    expect(authError(error)).toBe("name is required, location is required");
  });

  it("falls back to the error field", () => {
    const error = { response: { data: { error: "Email or password is incorrect" } } };
    expect(authError(error)).toBe("Email or password is incorrect");
  });

  it("falls back to the network message when there is no response", () => {
    expect(authError({ message: "Network Error" })).toBe("Network Error");
  });

  it("never returns nothing", () => {
    // An empty message box would leave the user with no idea what happened.
    expect(authError({})).toBeTruthy();
    expect(authError(null)).toBeTruthy();
  });
});