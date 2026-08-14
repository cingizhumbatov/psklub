// window.storage shim — App.jsx-i dəyişmədən işləməsi üçün.
// Verilənlər .NET (ASP.NET Core + SQLite) backend-də saxlanılır.
// Prod build-də VITE_API_URL="" olur → eyni origin (relativ /api).
// Lokal dev-də təyin olunmayıb → undefined → localhost:5100 backend-i.
const API = import.meta.env.VITE_API_URL ?? "http://localhost:5100";

const storage = {
  async get(key) {
    // cache: "no-store" — brauzer köhnə (keşlənmiş) dəyər qaytarmasın,
    // əks halda bağlanmış kabinet/köhnə stok geri qayıda bilər.
    const res = await fetch(`${API}/api/storage/get?key=${encodeURIComponent(key)}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`storage.get failed: ${res.status}`);
    // Açar yoxdursa backend boş body və ya "null" qaytara bilər.
    // Bunu XƏTA saymamalıyıq — əks halda getFresh "offline" sanıb köhnə günün
    // datasına düşür və satışlar səhv günə yazılır (hesabat rəqəmləri şişir).
    const text = await res.text();
    if (!text || text === "null") return null;
    const data = JSON.parse(text);
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
    const res = await fetch(`${API}/api/storage/list?prefix=${encodeURIComponent(prefix || "")}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`storage.list failed: ${res.status}`);
    const data = await res.json();
    return { keys: data.keys || [] };
  },
};

if (typeof window !== "undefined" && !window.storage) {
  window.storage = storage;
}

export default storage;
