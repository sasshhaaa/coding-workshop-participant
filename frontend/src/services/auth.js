import axios from "axios";

const ROOT = "http://localhost:3002/api/auth-service";
const KEY = "acme_token";

// Kept in memory and mirrored to sessionStorage so a refresh doesn't sign you out.
let token = null;
try {
  token = sessionStorage.getItem(KEY);
} catch {
  token = null;
}

export function getToken() {
  return token;
}

export function setToken(value) {
  token = value;
  try {
    if (value) sessionStorage.setItem(KEY, value);
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage unavailable; the in-memory copy still works for this tab.
  }
}

export const authApi = {
  register: (data) =>
    axios.post(`${ROOT}/register`, data).then((r) => r.data),

  login: (email, password) =>
    axios.post(`${ROOT}/login`, { email, password }).then((r) => r.data),

  requestCode: (email) =>
    axios.post(`${ROOT}/request-code`, { email }).then((r) => r.data),

  verifyCode: (email, code) =>
    axios.post(`${ROOT}/verify-code`, { email, code }).then((r) => r.data),

  me: () =>
    axios
      .get(`${ROOT}/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.data),
};

export const ROLES = ["admin", "manager", "contributor", "viewer"];

// One place that decides what each role may do.
const RULES = {
  admin: { create: true, update: true, delete: true, manageUsers: true },
  manager: { create: true, update: true, delete: true, manageUsers: false },
  contributor: { create: true, update: true, delete: false, manageUsers: false },
  viewer: { create: false, update: false, delete: false, manageUsers: false },
};

export function can(role, action) {
  return RULES[role]?.[action] ?? false;
}

export function authError(e) {
  return e.response?.data?.details?.join(", ")
    || e.response?.data?.error
    || e.message
    || "Something went wrong";
}