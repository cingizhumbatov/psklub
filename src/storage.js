// window.storage shim — App.jsx-i dəyişmədən işləməsi üçün.
// Verilənlər .NET (ASP.NET Core + SQLite) backend-də saxlanılır.
// Prod build-də VITE_API_URL="" olur → eyni origin (relativ /api).
// Lokal dev-də təyin olunmayıb → undefined → localhost:5100 backend-i.
const API = import.meta.env.VITE_API_URL ?? "http://localhost:5100";

const storage = {
  async get(key) {
    const res = await fetch(`${API}/api/storage/get?key=${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error(`storage.get failed: ${res.status}`);
    const data = await res.json();
    if (data == null) return null;
    return { value: data.value };
  },
  async set(key, value) {
    const res = await fetch(`${API}/api/storage/set`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    if (!res.ok) throw new Error(`storage.set failed: ${res.status}`);
    return true;
  },
  async delete(key) {
    const res = await fetch(`${API}/api/storage/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    if (!res.ok) throw new Error(`storage.delete failed: ${res.status}`);
    return true;
  },
  async list(prefix) {
    const res = await fetch(`${API}/api/storage/list?prefix=${encodeURIComponent(prefix || "")}`);
    if (!res.ok) throw new Error(`storage.list failed: ${res.status}`);
    const data = await res.json();
    return { keys: data.keys || [] };
  },
};

if (typeof window !== "undefined" && !window.storage) {
  window.storage = storage;
}

export default storage;
