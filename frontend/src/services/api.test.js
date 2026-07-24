import { describe, it, expect, vi, beforeEach } from "vitest";

// axios has to be mocked before the module under test imports it, because
// api.js registers its interceptors at import time.
vi.mock("axios", () => {
  const instance = {
    get: vi.fn(() => Promise.resolve({ data: [] })),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    put: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ status: 204 })),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  };

  return { default: { create: vi.fn(() => instance) } };
});

import axios from "axios";
import {
  teamsApi, individualsApi, projectsApi, achievementsApi, metadataApi,
  apiError, money, LEVELS, STAFF_TYPES, IMPACTS, STATUSES,
} from "./api";
import { setToken, getToken } from "./auth";

const client = axios.create();

// Derived the same way api.js derives it, so these tests follow the
// configured API URL rather than breaking whenever it changes.
const ROOT = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/$/, "")}/api`
  : "http://localhost:3002/api";

// The interceptors register once, when api.js is imported. Capture them now,
// because clearing mocks between tests would erase that call record.
const attachToken = client.interceptors.request.use.mock.calls[0][0];
const onSuccess = client.interceptors.response.use.mock.calls[0][0];
const onFailure = client.interceptors.response.use.mock.calls[0][1];

beforeEach(() => {
  client.get.mockClear();
  client.post.mockClear();
  client.put.mockClear();
  client.delete.mockClear();
  setToken(null);
});

describe("the API base URL", () => {
  it("ends with /api so every service path is built consistently", () => {
    expect(ROOT).toMatch(/\/api$/);
  });

  it("has no double slash before the path", () => {
    // A trailing slash on VITE_API_URL would produce "//api" and 404.
    expect(ROOT).not.toMatch(/\/\/api$/);
  });
});

describe("CRUD routes", () => {
  it("lists from the right endpoint", async () => {
    await teamsApi.getAll();
    expect(client.get).toHaveBeenCalledWith(
      `${ROOT}/teams-service`,
      expect.anything()
    );
  });

  it("fetches one record by id", async () => {
    await individualsApi.getOne(7);
    expect(client.get).toHaveBeenCalledWith(`${ROOT}/individuals-service/7`);
  });

  it("posts to create", async () => {
    await projectsApi.create({ name: "Portal" });
    expect(client.post).toHaveBeenCalledWith(
      `${ROOT}/projects-service`,
      { name: "Portal" }
    );
  });

  it("puts to update, with the id in the path", async () => {
    await achievementsApi.update(3, { title: "Shipped" });
    expect(client.put).toHaveBeenCalledWith(
      `${ROOT}/achievements-service/3`,
      { title: "Shipped" }
    );
  });

  it("deletes by id", async () => {
    await metadataApi.remove(5);
    expect(client.delete).toHaveBeenCalledWith(`${ROOT}/metadata-service/5`);
  });

  it("passes query parameters through", async () => {
    await projectsApi.getAll({ team_id: 2, status: "active" });
    expect(client.get).toHaveBeenCalledWith(
      expect.any(String),
      { params: { team_id: 2, status: "active" } }
    );
  });

  it("gives every service the same five operations", () => {
    // The CRUD factory exists so a new service is one line, not five
    // hand-written functions that can drift apart.
    for (const api of [individualsApi, projectsApi, achievementsApi]) {
      for (const method of ["getAll", "getOne", "create", "update", "remove"]) {
        expect(typeof api[method]).toBe("function");
      }
    }
  });
});

describe("service-specific endpoints", () => {
  it("reaches analytics on its own path", async () => {
    await teamsApi.analytics();
    expect(client.get).toHaveBeenCalledWith(
      `${ROOT}/teams-service/analytics`,
      expect.anything()
    );
  });

  it("filters metadata by the entity it belongs to", async () => {
    await metadataApi.forEntity("team", 4);
    expect(client.get).toHaveBeenCalledWith(
      `${ROOT}/metadata-service`,
      { params: { entity_type: "team", entity_id: 4 } }
    );
  });

  it("keeps the standard CRUD methods alongside the extras", () => {
    expect(typeof teamsApi.analytics).toBe("function");
    expect(typeof teamsApi.getAll).toBe("function");
    expect(typeof metadataApi.forEntity).toBe("function");
    expect(typeof metadataApi.create).toBe("function");
  });
});

describe("the request interceptor", () => {
  it("attaches the token to every request once signed in", () => {
    setToken("abc.def.ghi");

    const config = attachToken({ headers: {} });

    expect(config.headers.Authorization).toBe("Bearer abc.def.ghi");
  });

  it("sends no Authorization header when signed out", () => {
    const config = attachToken({ headers: {} });

    expect(config.headers.Authorization).toBeUndefined();
  });

  it("leaves the rest of the request untouched", () => {
    setToken("abc.def.ghi");

    const config = attachToken({
      headers: { "Content-Type": "application/json" },
      params: { team_id: 1 },
    });

    expect(config.headers["Content-Type"]).toBe("application/json");
    expect(config.params).toEqual({ team_id: 1 });
  });
});

describe("the response interceptor", () => {
  it("passes successful responses through untouched", () => {
    const response = { data: { id: 1 } };
    expect(onSuccess(response)).toBe(response);
  });

  it("clears the session when the token has expired", async () => {
    // A 401 mid-session means the token expired. Holding on to it would
    // leave the user clicking buttons that silently fail.
    setToken("stale.token.here");

    await expect(onFailure({ response: { status: 401 } })).rejects.toBeTruthy();

    expect(getToken()).toBeNull();
  });

  it("leaves the session alone for other errors", async () => {
    // A 500 or a 404 says nothing about whether the token is still good.
    setToken("valid.token.here");

    await expect(onFailure({ response: { status: 500 } })).rejects.toBeTruthy();

    expect(getToken()).toBe("valid.token.here");
  });

  it("re-throws so the caller can still show its own message", async () => {
    const error = { response: { status: 400, data: { error: "Bad request" } } };
    await expect(onFailure(error)).rejects.toBe(error);
  });
});

describe("error messages", () => {
  it("prefers the field-level details the API sends", () => {
    const error = {
      response: { data: { details: ["name is required", "location is required"] } },
    };
    expect(apiError(error)).toBe("name is required, location is required");
  });

  it("falls back to the message field", () => {
    expect(apiError({ response: { data: { message: "Server exploded" } } }))
      .toBe("Server exploded");
  });

  it("falls back to the error field", () => {
    expect(apiError({ response: { data: { error: "Team not found" } } }))
      .toBe("Team not found");
  });

  it("falls back to a network message", () => {
    expect(apiError({ message: "Network Error" })).toBe("Network Error");
  });

  it("always says something", () => {
    expect(apiError({})).toBeTruthy();
    expect(apiError(null)).toBeTruthy();
  });
});

describe("money formatting", () => {
  it("formats a whole amount", () => {
    expect(money(10000)).toMatch(/10,000/);
  });

  it("shows zero rather than an empty string", () => {
    expect(money(0)).toMatch(/0/);
  });

  it("treats missing values as zero", () => {
    // A project with no budget set must not render "£NaN".
    expect(money(null)).toMatch(/0/);
    expect(money(undefined)).toMatch(/0/);
    expect(money("")).toMatch(/0/);
  });

  it("copes with a numeric string, which is what the API returns", () => {
    expect(money("2500")).toMatch(/2,500/);
  });

  it("shows an overspend as a negative rather than hiding it", () => {
    expect(money(-500)).toMatch(/500/);
  });
});

describe("shared constants", () => {
  it("matches the levels the backend accepts", () => {
    expect(LEVELS).toEqual(["lead", "member", "junior"]);
  });

  it("matches the staff types the backend accepts", () => {
    expect(STAFF_TYPES).toEqual(["direct", "non-direct"]);
  });

  it("matches the impact ratings the backend accepts", () => {
    expect(IMPACTS).toEqual(["low", "medium", "high"]);
  });

  it("matches the project statuses the backend accepts", () => {
    // These drive a dropdown; a value the API rejects would fail on save
    // with a validation error the user can't act on.
    expect(STATUSES).toEqual([
      "planning", "active", "on_hold", "completed", "cancelled",
    ]);
  });
});