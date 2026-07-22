import axios from "axios";

const ROOT = "http://localhost:3002";
const BASE = `${ROOT}/api/projects-service`;

const client = axios.create({
  headers: { "Content-Type": "application/json" },
  timeout: 15000,
});

export const projectsApi = {
  getAll: () => client.get(BASE).then((r) => r.data),
  getOne: (id) => client.get(`${BASE}/${id}`).then((r) => r.data),
  create: (data) => client.post(BASE, data).then((r) => r.data),
  update: (id, data) => client.put(`${BASE}/${id}`, data).then((r) => r.data),
  remove: (id) => client.delete(`${BASE}/${id}`),
};

export const STATUSES = ["planning", "active", "on_hold", "completed", "cancelled"];