import axios from "axios";
import { getToken, setToken } from "./auth";

// Vite inlines this at build time. The deploy script sets it from the
// Terraform output; locally it falls back to the dev router. A trailing
// slash from Terraform would produce "//api" and 404, so it's stripped.
const ROOT = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/$/, "")}/api`
  : "http://localhost:3002/api";

const client = axios.create({
  headers: { "Content-Type": "application/json" },
  timeout: 15000,
});

// Attach the bearer token to every outgoing request.
client.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// A 401 means the session died. Clear it and send the user back to sign in.
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      setToken(null);
      window.location.reload();
    }
    return Promise.reject(error);
  }
);

function crud(service) {
  const base = `${ROOT}/${service}`;
  return {
    getAll: (params) => client.get(base, { params }).then((r) => r.data),
    getOne: (id) => client.get(`${base}/${id}`).then((r) => r.data),
    create: (data) => client.post(base, data).then((r) => r.data),
    update: (id, data) => client.put(`${base}/${id}`, data).then((r) => r.data),
    remove: (id) => client.delete(`${base}/${id}`),
  };
}

export const teamsApi = {
  ...crud("teams-service"),
  analytics: (params) =>
    client.get(`${ROOT}/teams-service/analytics`, { params }).then((r) => r.data),
};

export const individualsApi = crud("individuals-service");
export const projectsApi = crud("projects-service");
export const achievementsApi = crud("achievements-service");

export const metadataApi = {
  ...crud("metadata-service"),
  forEntity: (entityType, entityId) =>
    client
      .get(`${ROOT}/metadata-service`, {
        params: { entity_type: entityType, entity_id: entityId },
      })
      .then((r) => r.data),
};

export const LEVELS = ["lead", "member", "junior"];
export const STAFF_TYPES = ["direct", "non-direct"];
export const IMPACTS = ["low", "medium", "high"];
export const STATUSES = ["planning", "active", "on_hold", "completed", "cancelled"];
export const ENTITY_TYPES = ["team", "individual"];

// Formats a number as currency without decimals — budgets are whole units here.
export const money = (n) =>
  new Intl.NumberFormat(undefined, {
    style: "currency", currency: "GBP", maximumFractionDigits: 0,
  }).format(Number(n) || 0);

export function apiError(e) {
  if (!e) return "Something went wrong";

  return e.response?.data?.details?.join(", ")
    || e.response?.data?.message
    || e.response?.data?.error
    || e.message
    || "Something went wrong";
}