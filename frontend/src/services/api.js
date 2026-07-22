import axios from "axios";

const ROOT = "http://localhost:3002/api";

const client = axios.create({
  headers: { "Content-Type": "application/json" },
  timeout: 15000,
});

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
  analytics: () => client.get(`${ROOT}/teams-service/analytics`).then((r) => r.data),
};

export const individualsApi = crud("individuals-service");

export const LEVELS = ["lead", "member", "junior"];
export const STAFF_TYPES = ["direct", "non-direct"];

export function apiError(e) {
  return e.response?.data?.details?.join(", ")
    || e.response?.data?.message
    || e.message
    || "Something went wrong";
}