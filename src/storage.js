// window.storage shim — App.jsx-i dəyişmədən işləməsi üçün.
// Verilənlər .NET (ASP.NET Core + SQLite) backend-də saxlanılır.
// Prod build-də VITE_API_URL="" olur → eyni origin (relativ /api).
// Lokal dev-də təyin olunmayıb → undefined → localhost:5100 backend-i.
const API = import.meta.env.VITE_API_URL ?? "http://localhost:5100";

// Şəbəkə "asılıb" qalanda yazma növbəsi əbədi bloklanmasın — hər sorğuya vaxt limiti.
// Limit bitəndə sorğu xəta kimi qayıdır → App offline rejiminə keçir (outbox).
const TIMEOUT_MS = 12000;

async function req(url, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

const storage = {
  // -> { value, version } | null   (açar yoxdursa null)
  async get(key) {
    // cache: "no-store" — brauzer köhnə (keşlənmiş) dəyər qaytarmasın,
    // əks halda bağlanmış kabinet/köhnə stok geri qayıda bilər.
    const res = await req(`${API}/api/storage/get?key=${encodeURIComponent(key)}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`storage.get failed: ${res.status}`);
    // Açar yoxdursa backend boş body və ya "null" qaytara bilər.
    // Bunu XƏTA saymamalıyıq — əks halda getFresh "offline" sanıb köhnə günün
    // datasına düşür və satışlar səhv günə yazılır (hesabat rəqəmləri şişir).
    const text = await res.text();
    if (!text || text === "null") return null;
    const data = JSON.parse(text);
    if (data == null) return null;
    return { value: data.value, version: Number(data.version ?? 0) };
  },

  // expectedVersion ədəd olarsa optimistik kilid (CAS) işləyir:
  //   -> { ok: true, version }                        yazıldı
  //   -> { ok: false, conflict: true, value, version } aralıqda başqası yazıb
  // expectedVersion verilməsə şərtsiz yazılır (son yazan qalib).
  // Şəbəkə xətasında istisna atılır (App onu offline kimi tutur).
  async set(key, value, expectedVersion) {
    const body = { key, value };
    if (typeof expectedVersion === "number") body.expectedVersion = expectedVersion;
    const res = await req(`${API}/api/storage/set`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 409) {
      const data = await res.json();
      return { ok: false, conflict: true, value: data.value ?? null, version: Number(data.version ?? 0) };
    }
    if (!res.ok) throw new Error(`storage.set failed: ${res.status}`);
    const data = await res.json().catch(() => ({}));
    return { ok: true, version: Number(data.version ?? 0) };
  },

  async delete(key) {
    const res = await req(`${API}/api/storage/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    if (!res.ok) throw new Error(`storage.delete failed: ${res.status}`);
    return true;
  },

  async list(prefix) {
    const res = await req(`${API}/api/storage/list?prefix=${encodeURIComponent(prefix || "")}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`storage.list failed: ${res.status}`);
    const data = await res.json();
    return { keys: data.keys || [] };
  },
};

if (typeof window !== "undefined" && !window.storage) {
  window.storage = storage;
}

export default storage;
