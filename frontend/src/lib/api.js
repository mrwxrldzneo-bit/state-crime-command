import axios from "axios";

// Explicitly route data traffic straight through your stable live Render backend engine URL
const API_BASE_URL = "https://state-crime-command-backend.onrender.com/api";

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Pass token clearance tags automatically inside background transaction handshakes
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("scc_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const formatApiError = (detail) => {
  if (!detail) return null;
  if (Array.isArray(detail)) {
    return detail.map((d) => d.msg || d.message).join(", ");
  }
  if (typeof detail === "object") {
    return detail.msg || detail.message || JSON.stringify(detail);
  }
  return String(detail);
};

export default api;