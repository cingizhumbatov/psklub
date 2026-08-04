import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Gamepad2, CupSoda, Cookie, BarChart3, Settings2, Plus, Minus, X, Power,
  ShoppingCart, RotateCcw, AlertTriangle, Package, PackagePlus, CheckCircle2, PlayCircle,
  Lock, LogOut, ShieldCheck, User, KeyRound, Trash2, AlarmClock, Timer, Gift,
  Infinity as InfinityIcon,
} from "lucide-react";

// Kabinet başlatma vaxt paketləri
const PLANS = [
  { key: "free", label: "Pulsuz", minutes: null, free: true },
  { key: "unlimited", label: "Limitsiz", minutes: null, unlimited: true },
  { key: "30", label: "30 dəqiqə", minutes: 30 },
  { key: "60", label: "1 saat", minutes: 60 },
  { key: "120", label: "2 saat", minutes: 120 },
];

// ---------- THEME ----------
const T = {
  bg: "#0B0D14",
  panel: "#141826",
  panel2: "#1C2133",
  border: "#262C42",
  free: "#2DD4BF",
  occupied: "#818CF8",
  danger: "#FB7185",
  amber: "#FACC15",
  text: "#EDEFF7",
  muted: "#8A90AC",
};
const FONT_DISPLAY = "'Space Grotesk', sans-serif";
const FONT_BODY = "'Inter', sans-serif";
const FONT_MONO = "'JetBrains Mono', monospace";

// ---------- DEFAULT DATA ----------
const DEFAULT_CABIN_COUNT = 10;
const DEFAULT_CABIN_RATES = Object.fromEntries(
  Array.from({ length: DEFAULT_CABIN_COUNT }, (_, i) => i + 1).map((id) => [id, [4, 5, 6].includes(id) ? 1 : 1.5])
);
const DEFAULT_MENU = {
  categories: [
    { id: "drinks", name: "İçkilər" },
    { id: "food", name: "Yeməklər" },
  ],
  items: [
    { id: "cola", name: "Kola", categoryId: "drinks", price: 1 },
    { id: "fanta", name: "Fanta", categoryId: "drinks", price: 1 },
    { id: "pirojki", name: "Piroşki", categoryId: "food", price: 1.5 },
  ],
};
const DEFAULT_PINS = { worker: "1111", manager: "2222" };
const DEFAULT_SETTINGS = { cabinRates: DEFAULT_CABIN_RATES, cabinNames: {}, menu: DEFAULT_MENU, pins: DEFAULT_PINS };
const DEFAULT_WAREHOUSE = {};

function normalizeSettings(s) {
  if (!s) return DEFAULT_SETTINGS;
  let cabinRates = s.cabinRates;
  if (!cabinRates) {
    // migrate from the old single-hourlyRate shape
    const rate = s.hourlyRate ?? 1.5;
    cabinRates = {};
    for (let i = 1; i <= DEFAULT_CABIN_COUNT; i++) cabinRates[i] = rate;
  }
  let menu = s.menu;
  if (!menu) {
    // migrate from the old fixed cola/fanta/pirojki + prices shape
    menu = JSON.parse(JSON.stringify(DEFAULT_MENU));
    if (s.prices) {
      menu.items.forEach((it) => {
        if (s.prices[it.id] != null) it.price = s.prices[it.id];
      });
    }
  }
  const pins = { ...DEFAULT_PINS, ...(s.pins || {}) };
  const cabinNames = s.cabinNames || {};
  return { cabinRates, cabinNames, menu, pins };
}

function normalizeCabin(cabin, id) {
  if (cabin.segments) return cabin;
  // migrate from the old single-cabin {startTime, orders} shape
  return { orders: cabin.orders || [], segments: [{ cabinId: id, startTime: cabin.startTime, endTime: null }] };
}

// A session can span multiple cabins if it was transferred; segments track each leg.
function segElapsed(cabin, now) {
  return cabin.segments.reduce((s, seg) => s + ((seg.endTime ?? now) - seg.startTime), 0);
}
function segCost(cabin, now, cabinRates) {
  if (cabin.free) return 0; // Pulsuz sessiya — vaxt haqqı yoxdur
  return cabin.segments.reduce((s, seg) => {
    const dur = (seg.endTime ?? now) - seg.startTime;
    const rate = cabinRates?.[seg.cabinId] ?? 1.5;
    return s + (dur / 3600000) * rate;
  }, 0);
}
function cabinStartTime(cabin) {
  return cabin.segments[0].startTime;
}
function cabinPath(cabin) {
  return cabin.segments.length > 1 ? cabin.segments.map((s) => `#${pad(s.cabinId)}`).join(" → ") : null;
}
function cabinIdsOf(settings) {
  return Object.keys(settings.cabinRates).map(Number).sort((a, b) => a - b);
}
// Kabinetin adı təyin olunubsa onu, yoxsa "#01" formatını qaytarır
function cabinName(settings, id) {
  const n = settings.cabinNames?.[id];
  return n && String(n).trim() ? String(n).trim() : null;
}
function cabinLabel(settings, id) {
  return cabinName(settings, id) || `#${pad(id)}`;
}

// ---------- MENU HELPERS ----------
function findMenuItem(menu, id) {
  return menu.items.find((it) => it.id === id);
}
function menuItemLabel(menu, id) {
  const it = findMenuItem(menu, id);
  return it ? it.name : id;
}
function categoryIcon(categoryId) {
  if (categoryId === "drinks") return CupSoda;
  if (categoryId === "food") return Cookie;
  return Package;
}
function itemsByCategory(menu) {
  return menu.categories.map((cat) => ({ cat, items: menu.items.filter((it) => it.categoryId === cat.id) }));
}

// ---------- HELPERS ----------
const round2 = (n) => Math.round(n * 100) / 100;
const money = (n) => `${round2(n).toFixed(2)} ₼`;
const pad = (n) => String(n).padStart(2, "0");
const todayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthStrOf = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const fmtDuration = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
};
const fmtTime = (ts) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

async function safeGet(key) {
  try {
    const res = await window.storage.get(key, false);
    return res ? JSON.parse(res.value) : null;
  } catch {
    return null;
  }
}
async function safeSet(key, value) {
  try {
    await window.storage.set(key, JSON.stringify(value), false);
    return true;
  } catch {
    return false;
  }
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [active, setActive] = useState({});
  const [todaySales, setTodaySales] = useState([]);
  const [businessDay, setBusinessDay] = useState(todayStr());
  const [dayOpen, setDayOpen] = useState(true);
  const [dayOpenedAt, setDayOpenedAt] = useState(0);
  const [tab, setTab] = useState("dashboard");
  const [now, setNow] = useState(Date.now());
  const [modalCabin, setModalCabin] = useState(null);
  const [startCabinId, setStartCabinId] = useState(null);
  const [stockModalOpen, setStockModalOpen] = useState(false);
  const [closeDayOpen, setCloseDayOpen] = useState(false);
  const [openDayOpen, setOpenDayOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [warehouse, setWarehouse] = useState(DEFAULT_WAREHOUSE);
  const [intakes, setIntakes] = useState([]);
  const [role, setRole] = useState(() => {
    try {
      return localStorage.getItem("psklub-role") || null;
    } catch {
      return null;
    }
  });
  const isManager = role === "manager";

  function login(r) {
    setRole(r);
    try {
      localStorage.setItem("psklub-role", r);
    } catch {}
    setTab("dashboard");
  }
  function logout() {
    setRole(null);
    try {
      localStorage.removeItem("psklub-role");
    } catch {}
  }

  useEffect(() => {
    (async () => {
      const s = await safeGet("settings");
      const a = await safeGet("active-sessions");
      const w = await safeGet("warehouse");
      const ik = await safeGet("stock-intakes");
      let bd = await safeGet("current-business-day");
      if (!bd) {
        bd = todayStr();
        await safeSet("current-business-day", bd);
      }
      const doStored = await safeGet("day-open");
      const doVal = doStored === null ? true : doStored;
      const openedAt = await safeGet("day-opened-at");
      const t = await safeGet(`sales:${bd}`);
      if (s) setSettings(normalizeSettings(s));
      if (a) {
        const norm = {};
        Object.entries(a).forEach(([cid, cab]) => {
          norm[cid] = normalizeCabin(cab, Number(cid));
        });
        setActive(norm);
      }
      setBusinessDay(bd);
      setDayOpen(doVal);
      if (openedAt != null) setDayOpenedAt(openedAt);
      if (t) setTodaySales(t);
      if (w) setWarehouse(w);
      if (ik) setIntakes(ik);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const showToast = useCallback((msg, isError) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // Vaxt bitmə bildirişi üçün səs (istifadəçi klik etdikdə hazırlanır)
  const audioRef = useRef(null);
  function primeAudio() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioRef.current) audioRef.current = new AC();
      if (audioRef.current.state === "suspended") audioRef.current.resume();
    } catch {}
  }
  function beep() {
    try {
      const ctx = audioRef.current;
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume();
      const t0 = ctx.currentTime;
      [0, 0.6].forEach((offset) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g);
        g.connect(ctx.destination);
        o.type = "sine";
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, t0 + offset);
        g.gain.exponentialRampToValueAtTime(0.3, t0 + offset + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.45);
        o.start(t0 + offset);
        o.stop(t0 + offset + 0.5);
      });
    } catch {}
  }

  async function persistActive(next) {
    setActive(next);
    const ok = await safeSet("active-sessions", next);
    if (!ok) showToast("Sessiya yadda saxlanmadı", true);
  }

  // Paket vaxtı bitəndə bir dəfə bildiriş (toast + səs), kartda "Vaxt bitdi" işarəsi qalır
  useEffect(() => {
    const due = Object.entries(active).filter(
      ([, c]) => c.plannedEndTime && !c.notified && now >= c.plannedEndTime
    );
    if (due.length === 0) return;
    const next = { ...active };
    due.forEach(([cid, c]) => {
      next[cid] = { ...c, notified: true };
      showToast(`⏰ ${cabinLabel(settings, Number(cid))} — vaxt bitdi!`, true);
    });
    persistActive(next);
    beep();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, active, settings]);

  async function persistSettings(next) {
    setSettings(next);
    const ok = await safeSet("settings", next);
    showToast(ok ? "Ayarlar saxlanıldı" : "Ayarlar saxlanmadı", !ok);
  }

  async function appendSale(record) {
    const key = `sales:${businessDay}`;
    const existing = (await safeGet(key)) || [];
    const next = [...existing, record];
    const ok = await safeSet(key, next);
    if (ok) setTodaySales(next);
    else showToast("Satış qeydə alınmadı", true);
  }

  async function persistWarehouse(next) {
    setWarehouse(next);
    const ok = await safeSet("warehouse", next);
    if (!ok) showToast("Anbar qalığı saxlanmadı", true);
  }

  async function addStockIntake(item, qty) {
    if (!(qty > 0)) return;
    persistWarehouse({ ...warehouse, [item]: round2((warehouse[item] || 0) + qty) });
    const record = { id: `in-${Date.now()}`, item, qty, timestamp: Date.now(), businessDay };
    const nextIntakes = [record, ...intakes].slice(0, 80);
    setIntakes(nextIntakes);
    const ok = await safeSet("stock-intakes", nextIntakes);
    if (!ok) showToast("Tarixçə saxlanmadı", true);
    showToast(`Anbara ${qty} ədəd ${menuItemLabel(settings.menu, item)} əlavə edildi`, false);
  }

  // "Başlat" düyməsi paket seçimi modalını açır
  function openStartPicker(id) {
    if (!dayOpen) {
      showToast("Əvvəlcə günü aç", true);
      return;
    }
    primeAudio();
    setStartCabinId(id);
  }

  function startCabin(id, plan) {
    if (!dayOpen) {
      showToast("Əvvəlcə günü aç", true);
      return;
    }
    const startTime = Date.now();
    const free = plan?.free === true;
    const planMinutes = plan?.minutes ?? null;
    const plannedEndTime = planMinutes ? startTime + planMinutes * 60000 : null;
    const next = {
      ...active,
      [id]: {
        segments: [{ cabinId: id, startTime, endTime: null }],
        orders: [],
        free,
        planMinutes,
        plannedEndTime,
        notified: false,
      },
    };
    persistActive(next);
    setStartCabinId(null);
    setModalCabin(id);
  }

  function transferCabin(fromId, toId) {
    const cabin = active[fromId];
    if (!cabin || active[toId] || fromId === toId) return;
    const now = Date.now();
    const segments = [...cabin.segments];
    segments[segments.length - 1] = { ...segments[segments.length - 1], endTime: now };
    segments.push({ cabinId: toId, startTime: now, endTime: null });
    const next = { ...active };
    delete next[fromId];
    next[toId] = { ...cabin, segments };
    persistActive(next);
    setModalCabin(toId);
    showToast(`${cabinLabel(settings, fromId)} → ${cabinLabel(settings, toId)} transfer edildi`, false);
  }

  function changeOrder(id, itemKey, delta) {
    const cabin = active[id];
    if (!cabin) return;
    if (delta > 0 && (warehouse[itemKey] || 0) <= 0) {
      showToast("Anbarda bu məhsul qalmayıb", true);
      return;
    }
    const orders = [...cabin.orders];
    const idx = orders.findIndex((o) => o.item === itemKey);
    if (idx === -1 && delta > 0) {
      const price = findMenuItem(settings.menu, itemKey)?.price ?? 0;
      orders.push({ item: itemKey, qty: 1, unitPrice: price });
    } else if (idx !== -1) {
      const newQty = orders[idx].qty + delta;
      if (newQty <= 0) orders.splice(idx, 1);
      else orders[idx] = { ...orders[idx], qty: newQty };
    }
    persistActive({ ...active, [id]: { ...cabin, orders } });
    persistWarehouse({ ...warehouse, [itemKey]: round2((warehouse[itemKey] || 0) - delta) });
  }

  async function checkoutCabin(id) {
    const cabin = active[id];
    if (!cabin) return;
    const endTime = Date.now();
    const cabinCost = round2(segCost(cabin, endTime, settings.cabinRates));
    const minutes = segElapsed(cabin, endTime) / 60000;
    const stockTotal = round2(cabin.orders.reduce((s, o) => s + o.qty * o.unitPrice, 0));
    const grandTotal = round2(cabinCost + stockTotal);
    const record = {
      id: `c${id}-${endTime}`,
      type: "cabinet",
      cabinetId: id,
      startTime: cabinStartTime(cabin),
      endTime,
      minutes: Math.round(minutes),
      cabinCost,
      orders: cabin.orders,
      stockTotal,
      grandTotal,
      segments: cabin.segments.map((s) => ({ cabinId: s.cabinId, startTime: s.startTime, endTime: s.endTime ?? endTime })),
    };
    await appendSale(record);
    const next = { ...active };
    delete next[id];
    persistActive(next);
    setModalCabin(null);
    showToast(`${cabinLabel(settings, id)} bağlandı — ${money(grandTotal)}`, false);
  }

  async function closeDay(closeTimeMs) {
    const ids = Object.keys(active).map(Number);
    const dayKey = `sales:${businessDay}`;
    let merged = (await safeGet(dayKey)) || [];
    if (ids.length > 0) {
      const nextActive = { ...active };
      for (const id of ids) {
        const cabin = active[id];
        const cabinCost = round2(segCost(cabin, closeTimeMs, settings.cabinRates));
        const minutes = segElapsed(cabin, closeTimeMs) / 60000;
        const stockTotal = round2(cabin.orders.reduce((s, o) => s + o.qty * o.unitPrice, 0));
        const grandTotal = round2(cabinCost + stockTotal);
        merged = [
          ...merged,
          {
            id: `c${id}-${closeTimeMs}`,
            type: "cabinet",
            cabinetId: id,
            startTime: cabinStartTime(cabin),
            endTime: closeTimeMs,
            minutes: Math.round(minutes),
            cabinCost,
            orders: cabin.orders,
            stockTotal,
            grandTotal,
            segments: cabin.segments.map((s) => ({ cabinId: s.cabinId, startTime: s.startTime, endTime: s.endTime ?? closeTimeMs })),
          },
        ];
        delete nextActive[id];
      }
      await safeSet(dayKey, merged);
      persistActive(nextActive);
    }
    await safeSet("day-open", false);
    setDayOpen(false);
    setTodaySales(merged);
    showToast(`Gün bağlandı${ids.length ? ` — ${ids.length} kabinet hesablandı` : ""}`, false);
    setCloseDayOpen(false);
  }

  async function openDay(dateLabel, stockAdditions) {
    const bd = dateLabel || todayStr();
    const openedAt = Date.now();
    await safeSet("current-business-day", bd);
    await safeSet("day-open", true);
    await safeSet("day-opened-at", openedAt);
    setBusinessDay(bd);
    setDayOpen(true);
    setDayOpenedAt(openedAt);
    const sales = (await safeGet(`sales:${bd}`)) || [];
    setTodaySales(sales);

    const entries = Object.entries(stockAdditions || {}).filter(([, q]) => q > 0);
    if (entries.length > 0) {
      const nextWarehouse = { ...warehouse };
      const newIntakes = [];
      entries.forEach(([itemId, qty]) => {
        nextWarehouse[itemId] = round2((nextWarehouse[itemId] || 0) + qty);
        newIntakes.push({ id: `in-${Date.now()}-${itemId}`, item: itemId, qty, timestamp: Date.now(), businessDay: bd });
      });
      persistWarehouse(nextWarehouse);
      const mergedIntakes = [...newIntakes, ...intakes].slice(0, 80);
      setIntakes(mergedIntakes);
      await safeSet("stock-intakes", mergedIntakes);
    }

    showToast(`Gün açıldı — ${bd}`, false);
    setOpenDayOpen(false);
  }

  async function submitStockSale(items) {
    if (!dayOpen) {
      showToast("Əvvəlcə günü aç", true);
      return;
    }
    const orders = Object.entries(items)
      .filter(([, q]) => q > 0)
      .map(([item, qty]) => ({ item, qty, unitPrice: findMenuItem(settings.menu, item)?.price ?? 0 }));
    if (orders.length === 0) return;
    const stockTotal = round2(orders.reduce((s, o) => s + o.qty * o.unitPrice, 0));
    const record = {
      id: `s-${Date.now()}`,
      type: "stock",
      cabinetId: null,
      cabinCost: 0,
      orders,
      stockTotal,
      grandTotal: stockTotal,
      endTime: Date.now(),
    };
    await appendSale(record);
    const nextWarehouse = { ...warehouse };
    orders.forEach((o) => {
      nextWarehouse[o.item] = round2((nextWarehouse[o.item] || 0) - o.qty);
    });
    persistWarehouse(nextWarehouse);
    setStockModalOpen(false);
    showToast(`Stok satışı əlavə edildi — ${money(stockTotal)}`, false);
  }

  // Səhvən başladılmış sessiyanı ləğv et — satış yazılmır, sifariş edilmiş stok anbara qaytarılır
  function cancelSession(id) {
    const cabin = active[id];
    if (!cabin) return;
    const nextWarehouse = { ...warehouse };
    cabin.orders.forEach((o) => {
      nextWarehouse[o.item] = round2((nextWarehouse[o.item] || 0) + o.qty);
    });
    if (cabin.orders.length > 0) persistWarehouse(nextWarehouse);
    const next = { ...active };
    delete next[id];
    persistActive(next);
    setModalCabin(null);
    showToast(`${cabinLabel(settings, id)} sessiyası ləğv edildi`, false);
  }

  // Aktiv sessiyaya vaxt əlavə et — bitmə vaxtı irəli çəkilir, bildiriş yenidən aktivləşir
  function extendSession(id, minutes) {
    const cabin = active[id];
    if (!cabin || !minutes) return;
    const base = Math.max(now, cabin.plannedEndTime || now);
    const plannedEndTime = base + minutes * 60000;
    const planMinutes = (cabin.planMinutes || 0) + minutes;
    persistActive({ ...active, [id]: { ...cabin, plannedEndTime, planMinutes, notified: false } });
    showToast(`${cabinLabel(settings, id)} — ${minutes} dəq əlavə edildi`, false);
  }

  // Anbara səhv daxil edilmiş malı sil — həmin qədər qalıqdan çıxılır
  async function deleteStockIntake(record) {
    const nextIntakes = intakes.filter((r) => r.id !== record.id);
    setIntakes(nextIntakes);
    const ok = await safeSet("stock-intakes", nextIntakes);
    if (!ok) {
      showToast("Silinmədi", true);
      return;
    }
    persistWarehouse({
      ...warehouse,
      [record.item]: round2(Math.max(0, (warehouse[record.item] || 0) - record.qty)),
    });
    showToast(`Daxilolma silindi — ${record.qty} ədəd ${menuItemLabel(settings.menu, record.item)}`, false);
  }

  // Bütün anbar qalıqlarını 0-la və daxilolma tarixçəsini təmizlə
  async function resetWarehouse() {
    persistWarehouse({});
    setIntakes([]);
    await safeSet("stock-intakes", []);
    showToast("Anbar sıfırlandı — bütün qalıqlar 0", false);
  }

  // Hesabatdan səhv satış/sessiya qeydini sil — satılan stok anbara qaytarılır
  async function deleteSale(date, recordId) {
    const key = `sales:${date}`;
    const list = (await safeGet(key)) || [];
    const rec = list.find((r) => r.id === recordId);
    const next = list.filter((r) => r.id !== recordId);
    const ok = await safeSet(key, next);
    if (!ok) {
      showToast("Silinmədi", true);
      return list;
    }
    if (date === businessDay) setTodaySales(next);
    if (rec && rec.orders && rec.orders.length > 0) {
      const nextWarehouse = { ...warehouse };
      rec.orders.forEach((o) => {
        nextWarehouse[o.item] = round2((nextWarehouse[o.item] || 0) + o.qty);
      });
      persistWarehouse(nextWarehouse);
    }
    showToast("Qeyd silindi", false);
    return next;
  }

  const activeCount = Object.keys(active).length;
  // "Günün gəliri" yalnız cari açıq günə aiddir. Gün bağlananda 0-lanır,
  // yeni gün açılanda (eyni tarixdə olsa belə) sıfırdan başlayır.
  const todayRevenue = dayOpen
    ? todaySales
        .filter((r) => (r.endTime ?? r.startTime ?? 0) >= dayOpenedAt)
        .reduce((s, r) => s + r.grandTotal, 0)
    : 0;
  const cabinIds = cabinIdsOf(settings);
  const timeUpCabins = Object.entries(active)
    .filter(([, c]) => c.plannedEndTime && now >= c.plannedEndTime)
    .map(([id]) => Number(id));

  return (
    <div
      style={{ background: T.bg, color: T.text, fontFamily: FONT_BODY, minHeight: "100%" }}
      className="w-full min-h-full p-4 md:p-6"
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;600&display=swap');
        @keyframes pulse-dot { 0%,100%{opacity:1} 50%{opacity:.35} }
        .dot-pulse { animation: pulse-dot 1.6s ease-in-out infinite; }
        input[type=date], input[type=month], input[type=time], input[type=number] { color-scheme: dark; }
      `}</style>

      {loading ? (
        <div style={{ color: T.muted }} className="text-center py-20">Yüklənir…</div>
      ) : !role ? (
        <LoginView settings={settings} onLogin={login} />
      ) : (
        <>
          {/* Header */}
          <div className="mb-6 flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="flex items-center gap-3 lg:mr-auto min-w-0">
              <div style={{ background: T.panel2, borderRadius: 12 }} className="p-2.5 shrink-0">
                <Gamepad2 size={24} color={T.free} />
              </div>
              <div className="min-w-0">
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20 }} className="truncate">PS Klub — İdarəetmə</div>
                <div style={{ color: T.muted, fontSize: 13 }} className="truncate">{cabinIds.length} kabinet · idarəetmə paneli</div>
              </div>
              <span
                className="flex lg:hidden items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold shrink-0 ml-auto"
                style={{ background: T.panel2, color: isManager ? T.occupied : T.free }}
              >
                {isManager ? <ShieldCheck size={14} /> : <User size={14} />}
                {isManager ? "Müdir" : "İşçi"}
              </span>
            </div>
            <nav className="flex gap-1 w-full lg:w-auto" style={{ background: T.panel, borderRadius: 10, padding: 4 }}>
              {[
                { k: "dashboard", label: "Kabinetlər", icon: Gamepad2 },
                { k: "warehouse", label: "Anbar", icon: Package, manager: true },
                { k: "reports", label: "Hesabatlar", icon: BarChart3, manager: true },
                { k: "settings", label: "Ayarlar", icon: Settings2, manager: true },
              ]
                .filter((t) => isManager || !t.manager)
                .map((t) => (
                  <button
                    key={t.k}
                    onClick={() => setTab(t.k)}
                    className="flex-1 lg:flex-none min-w-0 flex flex-col lg:flex-row items-center justify-center gap-0.5 lg:gap-1.5 px-1.5 lg:px-3 py-1.5 lg:py-2 rounded-lg text-[11px] lg:text-sm"
                    style={{
                      background: tab === t.k ? T.panel2 : "transparent",
                      color: tab === t.k ? T.text : T.muted,
                      fontWeight: tab === t.k ? 600 : 400,
                    }}
                  >
                    <t.icon size={15} className="shrink-0" /> <span className="truncate max-w-full">{t.label}</span>
                  </button>
                ))}
            </nav>
            <div className="flex items-center gap-2 flex-wrap">
              <span style={{ color: T.muted, fontSize: 12 }} className="flex items-center gap-1.5">
                <span style={{ width: 7, height: 7, borderRadius: 999, background: dayOpen ? T.free : T.danger }} />
                {dayOpen ? `Açıq gün: ${businessDay}` : `Bağlı gün: ${businessDay}`}
              </span>
              {dayOpen ? (
                <button
                  onClick={() => setCloseDayOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold"
                  style={{ background: T.panel, border: `1px solid ${T.border}`, color: T.text }}
                >
                  <CheckCircle2 size={15} color={T.amber} /> Günü bağla
                </button>
              ) : (
                <button
                  onClick={() => setOpenDayOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold"
                  style={{ background: T.free, color: "#0B0D14" }}
                >
                  <PlayCircle size={15} /> Günü aç
                </button>
              )}
              <span
                className="hidden lg:flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-sm font-semibold"
                style={{ background: T.panel2, color: isManager ? T.occupied : T.free }}
              >
                {isManager ? <ShieldCheck size={15} /> : <User size={15} />}
                {isManager ? "Müdir" : "İşçi"}
              </span>
              <button
                onClick={logout}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold"
                style={{ background: T.panel, border: `1px solid ${T.border}`, color: T.muted }}
                title="Çıxış"
              >
                <LogOut size={15} /> Çıxış
              </button>
            </div>
          </div>

          {timeUpCabins.length > 0 && (
            <div
              className="rounded-xl px-4 py-3 mb-4 flex items-center gap-2 dot-pulse"
              style={{ background: T.panel, border: `1px solid ${T.danger}`, color: T.danger }}
            >
              <AlarmClock size={18} />
              <span style={{ fontSize: 14, fontWeight: 600 }}>
                Vaxtı bitən kabinet{timeUpCabins.length > 1 ? "lər" : ""}: {timeUpCabins.map((cid) => cabinLabel(settings, cid)).join(", ")}
              </span>
            </div>
          )}

          {tab === "warehouse" && isManager ? (
            <WarehouseView menu={settings.menu} warehouse={warehouse} intakes={intakes} businessDay={businessDay} onAdd={addStockIntake} onDeleteIntake={deleteStockIntake} onReset={resetWarehouse} />
          ) : tab === "reports" && isManager ? (
            <Reports businessDay={businessDay} settings={settings} onDeleteSale={deleteSale} />
          ) : tab === "settings" && isManager ? (
            <SettingsView settings={settings} onSave={persistSettings} activeIds={Object.keys(active).map(Number)} />
          ) : (
            <Dashboard
              active={active}
              now={now}
              settings={settings}
              warehouse={warehouse}
              activeCount={activeCount}
              todayRevenue={todayRevenue}
              dayOpen={dayOpen}
              isManager={isManager}
              onStart={openStartPicker}
              onOpen={setModalCabin}
              onStockSale={() => setStockModalOpen(true)}
            />
          )}

          {startCabinId != null && !active[startCabinId] && (
            <StartCabinModal
              id={startCabinId}
              settings={settings}
              onPick={startCabin}
              onClose={() => setStartCabinId(null)}
            />
          )}

          {modalCabin && active[modalCabin] && (
            <CabinModal
              id={modalCabin}
              cabin={active[modalCabin]}
              now={now}
              settings={settings}
              warehouse={warehouse}
              activeSessions={active}
              onChangeOrder={changeOrder}
              onCheckout={checkoutCabin}
              onTransfer={transferCabin}
              onCancelSession={cancelSession}
              onExtend={extendSession}
              onClose={() => setModalCabin(null)}
            />
          )}

          {stockModalOpen && (
            <StockSaleModal settings={settings} warehouse={warehouse} onSubmit={submitStockSale} onClose={() => setStockModalOpen(false)} />
          )}

          {closeDayOpen && (
            <CloseDayModal activeCount={Object.keys(active).length} onClose={() => setCloseDayOpen(false)} onConfirm={closeDay} />
          )}

          {openDayOpen && (
            <OpenDayModal menu={settings.menu} warehouse={warehouse} canAddStock={isManager} onClose={() => setOpenDayOpen(false)} onConfirm={openDay} />
          )}
        </>
      )}

      {toast && (
        <div
          className="fixed bottom-5 right-5 px-4 py-3 rounded-xl text-sm shadow-lg"
          style={{ background: toast.isError ? T.danger : T.free, color: "#0B0D14", fontWeight: 600 }}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ---------- LOGIN ----------
function LoginView({ settings, onLogin }) {
  const [selected, setSelected] = useState(null); // "worker" | "manager"
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const pins = settings.pins || {};

  const profiles = [
    { role: "worker", label: "İşçi", desc: "Kabinetlər və satış", icon: User, color: T.free },
    { role: "manager", label: "Müdir", desc: "Tam idarəetmə", icon: ShieldCheck, color: T.occupied },
  ];

  function pick(role) {
    setSelected(role);
    setPin("");
    setError(false);
  }
  function submit() {
    if (pin === String(pins[selected] ?? "")) onLogin(selected);
    else setError(true);
  }

  const current = profiles.find((p) => p.role === selected);

  return (
    <div className="flex items-center justify-center" style={{ minHeight: "80vh" }}>
      <div className="w-full max-w-sm rounded-2xl p-6" style={{ background: T.panel, border: `1px solid ${T.border}` }}>
        <div className="flex items-center gap-3 mb-1">
          <div style={{ background: T.panel2, borderRadius: 12 }} className="p-2.5">
            <Gamepad2 size={24} color={T.free} />
          </div>
          <div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20 }}>PS Klub</div>
            <div style={{ color: T.muted, fontSize: 13 }}>İdarəetmə paneli</div>
          </div>
        </div>

        {!selected ? (
          <>
            <div style={{ color: T.muted, fontSize: 13 }} className="mt-4 mb-3">Profil seçin</div>
            <div className="flex flex-col gap-2.5">
              {profiles.map((p) => (
                <button
                  key={p.role}
                  onClick={() => pick(p.role)}
                  className="flex items-center gap-3 rounded-xl p-3.5 text-left"
                  style={{ background: T.panel2, border: `1px solid ${T.border}` }}
                >
                  <div style={{ background: T.panel, borderRadius: 10 }} className="p-2.5">
                    <p.icon size={20} color={p.color} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{p.label}</div>
                    <div style={{ color: T.muted, fontSize: 12 }}>{p.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="mt-4 mb-3 flex items-center gap-2">
              <current.icon size={16} color={current.color} />
              <span style={{ fontWeight: 600, fontSize: 15 }}>{current.label}</span>
              <span style={{ color: T.muted, fontSize: 12 }}>— PIN kodu daxil edin</span>
            </div>
            <div className="flex items-center gap-2 mb-1 rounded-xl px-3 py-2.5" style={{ background: T.panel2, border: `1px solid ${error ? T.danger : T.border}` }}>
              <Lock size={16} color={T.muted} />
              <input
                type="password"
                inputMode="numeric"
                autoFocus
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value);
                  setError(false);
                }}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="••••"
                className="flex-1 bg-transparent outline-none text-sm"
                style={{ color: T.text, fontFamily: FONT_MONO, letterSpacing: 2 }}
              />
            </div>
            {error && <div style={{ color: T.danger, fontSize: 12 }} className="mb-1">PIN kodu yanlışdır</div>}
            <button
              onClick={submit}
              className="w-full py-3 rounded-xl font-semibold mt-3"
              style={{ background: T.free, color: "#0B0D14" }}
            >
              Daxil ol
            </button>
            <button
              onClick={() => setSelected(null)}
              className="w-full py-2 rounded-xl text-sm mt-2"
              style={{ color: T.muted }}
            >
              ← Profil dəyiş
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- DASHBOARD ----------
function Dashboard({ active, now, settings, warehouse, activeCount, todayRevenue, dayOpen, isManager, onStart, onOpen, onStockSale }) {
  const cabinIds = cabinIdsOf(settings);
  return (
    <div>
      {!dayOpen && (
        <div
          className="rounded-xl px-4 py-3 mb-4 text-sm"
          style={{ background: T.panel, border: `1px solid ${T.danger}`, color: T.danger }}
        >
          Gün bağlıdır — kabinet açmaq üçün əvvəlcə yuxarıdan "Günü aç" düyməsini basın.
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        {isManager && (
          <StatCard label="Aktiv kabinet" value={`${activeCount} / ${cabinIds.length}`} icon={Power} color={T.occupied} />
        )}
        {isManager && (
          <StatCard label="Günün gəliri" value={money(todayRevenue)} icon={BarChart3} color={T.amber} mono />
        )}
        <button
          onClick={dayOpen ? onStockSale : undefined}
          className="rounded-2xl p-4 flex items-center gap-3 text-left"
          style={{ background: T.panel, border: `1px solid ${T.border}`, opacity: dayOpen ? 1 : 0.5 }}
        >
          <div style={{ background: T.panel2, borderRadius: 10 }} className="p-2">
            <ShoppingCart size={18} color={T.text} />
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Stok satışı</div>
            <div style={{ color: T.muted, fontSize: 12 }}>Kabinetsiz satış</div>
          </div>
        </button>
      </div>

      {isManager && (
        <div className="flex gap-2 mb-5 flex-wrap">
          {settings.menu.items.map((it) => {
            const qty = warehouse[it.id] || 0;
            const low = qty <= 5;
            const Icon = categoryIcon(it.categoryId);
            return (
              <div
                key={it.id}
                className="flex items-center gap-2 px-3 py-2 rounded-xl"
                style={{ background: T.panel, border: `1px solid ${low ? T.danger : T.border}` }}
              >
                <Icon size={14} color={T.muted} />
                <span style={{ fontSize: 13, color: T.muted }}>{it.name} anbarda:</span>
                <span style={{ fontFamily: FONT_MONO, fontWeight: 600, color: low ? T.danger : T.text }}>{qty}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 ${isManager ? "" : "mt-5"}`}>
        {cabinIds.map((id) => {
          const cabin = active[id];
          const busy = !!cabin;
          const name = cabinName(settings, id);
          const rate = settings.cabinRates?.[id] ?? 1.5;
          const elapsed = busy ? segElapsed(cabin, now) : 0;
          const cost = busy ? segCost(cabin, now, settings.cabinRates) : 0;
          const stockTotal = busy ? cabin.orders.reduce((s, o) => s + o.qty * o.unitPrice, 0) : 0;
          const free = busy && cabin.free;
          const plannedEnd = busy ? cabin.plannedEndTime : null;
          const remaining = plannedEnd ? plannedEnd - now : null;
          const timeUp = plannedEnd != null && remaining <= 0;
          const disabled = !busy && !dayOpen;
          return (
            <div
              key={id}
              className="rounded-2xl p-4 flex flex-col gap-2"
              style={{
                background: T.panel,
                border: `1px solid ${timeUp ? T.danger : busy ? T.occupied : T.border}`,
                opacity: disabled ? 0.45 : 1,
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-baseline gap-1.5" style={{ minWidth: 0 }}>
                  <span
                    style={{
                      fontFamily: FONT_DISPLAY,
                      fontWeight: 700,
                      fontSize: name ? 16 : 22,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {name || `#${pad(id)}`}
                  </span>
                  {name && <span style={{ color: T.muted, fontFamily: FONT_MONO, fontSize: 11 }}>#{pad(id)}</span>}
                </div>
                <span
                  className={busy ? "dot-pulse" : ""}
                  style={{ width: 9, height: 9, borderRadius: 999, background: timeUp ? T.danger : busy ? T.occupied : T.free, flexShrink: 0 }}
                />
              </div>
              <div style={{ color: T.muted, fontSize: 12 }}>
                {busy ? (free ? "Pulsuz oyun" : "Məşğuldur") : "Boşdur"} · {money(rate)}/saat
              </div>
              {busy ? (
                <>
                  <div style={{ fontFamily: FONT_MONO, color: T.amber, fontSize: 15, fontWeight: 600 }}>
                    {fmtDuration(elapsed)}
                  </div>
                  {free ? (
                    <div style={{ fontFamily: FONT_MONO, color: T.free, fontSize: 12 }} className="flex items-center gap-1">
                      <Gift size={12} /> Pulsuz
                    </div>
                  ) : plannedEnd ? (
                    timeUp ? (
                      <div className="dot-pulse flex items-center gap-1" style={{ fontFamily: FONT_MONO, color: T.danger, fontSize: 12, fontWeight: 600 }}>
                        <AlarmClock size={12} /> Vaxt bitdi
                      </div>
                    ) : (
                      <div style={{ fontFamily: FONT_MONO, color: T.muted, fontSize: 12 }} className="flex items-center gap-1">
                        <Timer size={12} /> Qalıq: {fmtDuration(remaining)}
                      </div>
                    )
                  ) : (
                    <div style={{ fontFamily: FONT_MONO, color: T.occupied, fontSize: 12 }} className="flex items-center gap-1">
                      <InfinityIcon size={12} /> Limitsiz
                    </div>
                  )}
                  <div style={{ fontFamily: FONT_MONO, fontSize: 13 }} className="mb-1">{money(cost + stockTotal)}</div>
                </>
              ) : (
                <div style={{ fontFamily: FONT_MONO, color: T.muted, fontSize: 13 }} className="mb-1">
                  {dayOpen ? "Boş kabinet" : "Gün bağlıdır"}
                </div>
              )}
              <button
                onClick={() => {
                  if (busy) onOpen(id);
                  else if (dayOpen) onStart(id);
                }}
                disabled={disabled}
                className="w-full py-2 rounded-xl text-sm font-semibold"
                style={{
                  background: busy ? T.occupied : T.free,
                  color: "#0B0D14",
                  opacity: disabled ? 0.5 : 1,
                }}
              >
                {busy ? "İdarə et" : "Başlat"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color, mono }) {
  return (
    <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: T.panel, border: `1px solid ${T.border}` }}>
      <div style={{ background: T.panel2, borderRadius: 10 }} className="p-2">
        <Icon size={18} color={color} />
      </div>
      <div>
        <div style={{ color: T.muted, fontSize: 12 }}>{label}</div>
        <div style={{ fontFamily: mono ? FONT_MONO : FONT_BODY, fontWeight: 600, fontSize: 16 }}>{value}</div>
      </div>
    </div>
  );
}

// ---------- START CABIN (PLAN PICKER) MODAL ----------
function StartCabinModal({ id, settings, onPick, onClose }) {
  const nm = cabinName(settings, id);
  const rate = settings.cabinRates?.[id] ?? 1.5;
  return (
    <Modal onClose={onClose} title={`${nm || `Kabinet #${pad(id)}`} — başlat`}>
      <div style={{ color: T.muted, fontSize: 13 }} className="mb-3">Vaxt paketini seçin</div>
      <div className="grid grid-cols-2 gap-2.5">
        {PLANS.map((p) => (
          <button
            key={p.key}
            onClick={() => onPick(id, p)}
            className="rounded-xl p-4 flex flex-col items-center gap-1"
            style={{
              background: T.panel2,
              border: `1px solid ${p.free ? T.free : p.unlimited ? T.occupied : T.border}`,
            }}
          >
            {p.free ? (
              <Gift size={20} color={T.free} />
            ) : p.unlimited ? (
              <InfinityIcon size={20} color={T.occupied} />
            ) : (
              <Timer size={20} color={T.amber} />
            )}
            <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16 }}>{p.label}</span>
            <span
              style={{ color: p.free ? T.free : p.unlimited ? T.occupied : T.muted, fontSize: 12, fontFamily: FONT_MONO }}
            >
              {p.free ? "Pulsuz" : p.unlimited ? `${money(rate)}/saat` : money((rate * p.minutes) / 60)}
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

// ---------- CABIN MODAL ----------
function CabinModal({ id, cabin, now, settings, warehouse, activeSessions, onChangeOrder, onCheckout, onTransfer, onCancelSession, onExtend, onClose }) {
  const [transferTarget, setTransferTarget] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const rate = settings.cabinRates?.[id] ?? 1.5;
  const elapsed = segElapsed(cabin, now);
  const cost = segCost(cabin, now, settings.cabinRates);
  const stockTotal = cabin.orders.reduce((s, o) => s + o.qty * o.unitPrice, 0);
  const path = cabinPath(cabin);
  const freeCabins = cabinIdsOf(settings).filter((cid) => cid !== id && !activeSessions[cid]);
  const remaining = cabin.plannedEndTime ? cabin.plannedEndTime - now : null;
  const timeUp = cabin.plannedEndTime != null && remaining <= 0;

  const nm = cabinName(settings, id);
  return (
    <Modal onClose={onClose} title={nm ? `${nm} (#${pad(id)})` : `Kabinet #${pad(id)}`}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div style={{ color: T.muted, fontSize: 12 }}>
            Başlama: {fmtTime(cabinStartTime(cabin))} · Tarif: {cabin.free ? "Pulsuz" : `${money(rate)}/saat`}
          </div>
          {path && <div style={{ color: T.occupied, fontSize: 12 }}>Marşrut: {path}</div>}
          <div style={{ fontFamily: FONT_MONO, color: T.amber, fontSize: 26, fontWeight: 600 }}>{fmtDuration(elapsed)}</div>
        </div>
        <div className="text-right">
          <div style={{ color: T.muted, fontSize: 12 }}>Cari məbləğ</div>
          <div style={{ fontFamily: FONT_MONO, fontSize: 20, fontWeight: 600 }}>{money(cost + stockTotal)}</div>
        </div>
      </div>

      <div
        className="rounded-xl px-3 py-2 mb-4 flex items-center gap-2"
        style={{
          background: T.panel2,
          border: `1px solid ${timeUp ? T.danger : T.border}`,
          color: cabin.free ? T.free : timeUp ? T.danger : T.text,
        }}
      >
        {cabin.free ? (
          <>
            <Gift size={15} /> <span style={{ fontSize: 13, fontWeight: 600 }}>Pulsuz oyun — vaxt haqqı yoxdur</span>
          </>
        ) : cabin.plannedEndTime ? (
          timeUp ? (
            <>
              <AlarmClock size={15} className="dot-pulse" />
              <span style={{ fontSize: 13, fontWeight: 600 }}>Vaxt bitdi ({cabin.planMinutes} dəq paket)</span>
            </>
          ) : (
            <>
              <Timer size={15} color={T.amber} />
              <span style={{ fontSize: 13 }}>
                Paket: {cabin.planMinutes} dəq · Qalıq:{" "}
                <b style={{ fontFamily: FONT_MONO }}>{fmtDuration(remaining)}</b> (bitir {fmtTime(cabin.plannedEndTime)})
              </span>
            </>
          )
        ) : (
          <>
            <InfinityIcon size={15} color={T.occupied} />{" "}
            <span style={{ fontSize: 13, color: T.occupied, fontWeight: 600 }}>Limitsiz vaxt — "bitir" basana qədər davam edir</span>
          </>
        )}
      </div>

      {cabin.plannedEndTime != null && (
        <>
          <div style={{ color: T.muted, fontSize: 12 }} className="mb-2">Vaxt artır</div>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {[
              { label: "+30 dəq", minutes: 30 },
              { label: "+1 saat", minutes: 60 },
              { label: "+2 saat", minutes: 120 },
            ].map((e) => (
              <button
                key={e.minutes}
                onClick={() => onExtend(id, e.minutes)}
                className="flex items-center justify-center gap-1 py-2 rounded-lg text-sm font-semibold"
                style={{ background: T.panel2, border: `1px solid ${T.border}`, color: T.text }}
              >
                <Plus size={13} color={T.amber} /> {e.label}
              </button>
            ))}
          </div>
        </>
      )}

      <div style={{ color: T.muted, fontSize: 12 }} className="mb-2">Stok əlavə et</div>
      <div className="flex flex-col gap-3 mb-4">
        {itemsByCategory(settings.menu).map(({ cat, items }) =>
          items.length === 0 ? null : (
            <div key={cat.id}>
              <div style={{ color: T.muted, fontSize: 11, fontWeight: 600, letterSpacing: 0.4 }} className="mb-1.5 uppercase">
                {cat.name}
              </div>
              <div className="flex flex-col gap-2">
                {items.map((it) => {
                  const order = cabin.orders.find((o) => o.item === it.id);
                  const qty = order ? order.qty : 0;
                  return (
                    <div key={it.id} className="flex items-center justify-between rounded-xl p-2.5" style={{ background: T.panel2 }}>
                      <div className="flex items-center gap-2">
                        <span style={{ fontSize: 14 }}>{it.name}</span>
                        <span style={{ color: T.muted, fontSize: 12 }}>
                          ({money(it.price)} · qalıq: {warehouse[it.id] || 0})
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <IconBtn onClick={() => onChangeOrder(id, it.id, -1)} disabled={qty === 0}><Minus size={14} /></IconBtn>
                        <span style={{ fontFamily: FONT_MONO, minWidth: 18, textAlign: "center" }}>{qty}</span>
                        <IconBtn onClick={() => onChangeOrder(id, it.id, 1)} disabled={(warehouse[it.id] || 0) <= 0}><Plus size={14} /></IconBtn>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )
        )}
      </div>

      <div style={{ color: T.muted, fontSize: 12 }} className="mb-2">Kabinet dəyiş</div>
      {freeCabins.length === 0 ? (
        <div className="mb-4 text-sm" style={{ color: T.muted }}>Boş kabinet yoxdur</div>
      ) : (
        <div className="flex gap-2 mb-4">
          <select
            value={transferTarget}
            onChange={(e) => setTransferTarget(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg text-sm"
            style={{ background: T.panel2, border: `1px solid ${T.border}`, color: T.text }}
          >
            <option value="">Kabinet seç…</option>
            {freeCabins.map((cid) => (
              <option key={cid} value={cid}>
                {cabinLabel(settings, cid)} ({money(settings.cabinRates?.[cid] ?? 1.5)}/saat)
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              if (transferTarget) {
                onTransfer(id, Number(transferTarget));
                setTransferTarget("");
              }
            }}
            disabled={!transferTarget}
            className="px-4 rounded-lg text-sm font-semibold shrink-0"
            style={{ background: transferTarget ? T.occupied : T.border, color: T.text, opacity: transferTarget ? 1 : 0.6 }}
          >
            Köçür
          </button>
        </div>
      )}

      <button
        onClick={() => onCheckout(id)}
        className="w-full py-3 rounded-xl font-semibold"
        style={{ background: T.danger, color: "#1A0A0F" }}
      >
        Sessiyanı bağla və hesabla
      </button>

      <div style={{ borderTop: `1px solid ${T.border}` }} className="mt-4 pt-3">
        {!confirmCancel ? (
          <button
            onClick={() => setConfirmCancel(true)}
            className="w-full py-2.5 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold"
            style={{ border: `1px solid ${T.danger}`, color: T.danger }}
          >
            <Trash2 size={14} /> Sessiyanı ləğv et (səhvən başladılıb)
          </button>
        ) : (
          <>
            <div style={{ color: T.muted, fontSize: 12 }} className="mb-2">
              Sessiya silinəcək, satış qeydə alınmayacaq. Kabinetə əlavə edilmiş stok anbara geri qaytarılacaq.
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => onCancelSession(id)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: T.danger, color: "#1A0A0F" }}
              >
                Bəli, ləğv et
              </button>
              <button
                onClick={() => setConfirmCancel(false)}
                className="flex-1 py-2.5 rounded-xl text-sm"
                style={{ border: `1px solid ${T.border}`, color: T.muted }}
              >
                İmtina
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function IconBtn({ children, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="p-1.5 rounded-lg"
      style={{ background: T.panel, opacity: disabled ? 0.35 : 1, border: `1px solid ${T.border}` }}
    >
      {children}
    </button>
  );
}

// ---------- STOCK SALE MODAL ----------
function StockSaleModal({ settings, warehouse, onSubmit, onClose }) {
  const [items, setItems] = useState({});
  const total = settings.menu.items.reduce((s, it) => s + (items[it.id] || 0) * it.price, 0);
  return (
    <Modal onClose={onClose} title="Stok satışı">
      <div className="flex flex-col gap-3 mb-4">
        {itemsByCategory(settings.menu).map(({ cat, items: catItems }) =>
          catItems.length === 0 ? null : (
            <div key={cat.id}>
              <div style={{ color: T.muted, fontSize: 11, fontWeight: 600, letterSpacing: 0.4 }} className="mb-1.5 uppercase">
                {cat.name}
              </div>
              <div className="flex flex-col gap-2">
                {catItems.map((it) => (
                  <div key={it.id} className="flex items-center justify-between rounded-xl p-2.5" style={{ background: T.panel2 }}>
                    <div className="flex items-center gap-2">
                      <span style={{ fontSize: 14 }}>{it.name}</span>
                      <span style={{ color: T.muted, fontSize: 12 }}>
                        ({money(it.price)} · qalıq: {warehouse[it.id] || 0})
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <IconBtn
                        onClick={() => setItems((p) => ({ ...p, [it.id]: Math.max(0, (p[it.id] || 0) - 1) }))}
                        disabled={(items[it.id] || 0) === 0}
                      >
                        <Minus size={14} />
                      </IconBtn>
                      <span style={{ fontFamily: FONT_MONO, minWidth: 18, textAlign: "center" }}>{items[it.id] || 0}</span>
                      <IconBtn
                        onClick={() => setItems((p) => ({ ...p, [it.id]: (p[it.id] || 0) + 1 }))}
                        disabled={(items[it.id] || 0) >= (warehouse[it.id] || 0)}
                      >
                        <Plus size={14} />
                      </IconBtn>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        )}
      </div>
      <div className="flex items-center justify-between mb-4">
        <span style={{ color: T.muted, fontSize: 13 }}>Cəmi</span>
        <span style={{ fontFamily: FONT_MONO, fontSize: 18, fontWeight: 600 }}>{money(total)}</span>
      </div>
      <button
        onClick={() => onSubmit(items)}
        disabled={total === 0}
        className="w-full py-3 rounded-xl font-semibold"
        style={{ background: total === 0 ? T.border : T.free, color: "#0B0D14", opacity: total === 0 ? 0.6 : 1 }}
      >
        Satışı qeyd et
      </button>
    </Modal>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center p-4 z-50" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl p-5 max-h-[90vh] overflow-y-auto"
        style={{ background: T.panel, border: `1px solid ${T.border}` }}
      >
        <div className="flex items-center justify-between mb-4">
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17 }}>{title}</div>
          <button onClick={onClose}><X size={18} color={T.muted} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------- WAREHOUSE ----------
function WarehouseView({ menu, warehouse, intakes, businessDay, onAdd, onDeleteIntake, onReset }) {
  const [form, setForm] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const todayAdditions = {};
  intakes.forEach((r) => {
    if (r.businessDay === businessDay) {
      todayAdditions[r.item] = (todayAdditions[r.item] || 0) + r.qty;
    }
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16 }}>Anbar</div>
        {confirmReset ? (
          <div className="flex items-center gap-2">
            <span style={{ color: T.muted, fontSize: 12 }}>Bütün qalıqlar 0 olacaq.</span>
            <button
              onClick={() => {
                onReset();
                setConfirmReset(false);
              }}
              className="px-3 py-1.5 rounded-lg text-sm font-semibold"
              style={{ background: T.danger, color: "#1A0A0F" }}
            >
              Təsdiqlə
            </button>
            <button
              onClick={() => setConfirmReset(false)}
              className="px-3 py-1.5 rounded-lg text-sm"
              style={{ border: `1px solid ${T.border}`, color: T.muted }}
            >
              İmtina
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmReset(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold"
            style={{ border: `1px solid ${T.danger}`, color: T.danger }}
          >
            <RotateCcw size={14} /> Anbarı sıfırla
          </button>
        )}
      </div>
      {itemsByCategory(menu).map(({ cat, items }) =>
        items.length === 0 ? null : (
          <div key={cat.id} className="mb-5">
            <div style={{ color: T.muted, fontSize: 12, fontWeight: 600, letterSpacing: 0.4 }} className="mb-2 uppercase">
              {cat.name}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {items.map((it) => {
                const qty = warehouse[it.id] || 0;
                const low = qty <= 5;
                const addedToday = todayAdditions[it.id] || 0;
                return (
                  <div key={it.id} className="rounded-2xl p-4" style={{ background: T.panel, border: `1px solid ${low ? T.danger : T.border}` }}>
                    <div className="mb-2 flex items-center justify-between">
                      <span style={{ fontSize: 14 }}>{it.name}</span>
                      {addedToday > 0 && <span style={{ color: T.free, fontSize: 12, fontFamily: FONT_MONO }}>bugün +{addedToday}</span>}
                    </div>
                    <div style={{ fontFamily: FONT_MONO, fontSize: 30, fontWeight: 600, color: low ? T.danger : T.text }} className="mb-3">
                      {qty}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="0"
                        placeholder="say"
                        value={form[it.id] || ""}
                        onChange={(e) => setForm((p) => ({ ...p, [it.id]: e.target.value }))}
                        className="w-full px-2 py-1.5 rounded-lg text-sm"
                        style={{ background: T.panel2, border: `1px solid ${T.border}`, color: T.text, fontFamily: FONT_MONO }}
                      />
                      <button
                        onClick={() => {
                          const q = parseInt(form[it.id], 10);
                          if (q > 0) {
                            onAdd(it.id, q);
                            setForm((p) => ({ ...p, [it.id]: "" }));
                          }
                        }}
                        className="px-3 rounded-lg flex items-center gap-1 text-sm font-semibold shrink-0"
                        style={{ background: T.free, color: "#0B0D14" }}
                      >
                        <PackagePlus size={14} /> Əlavə et
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )
      )}

      <div style={{ color: T.muted, fontSize: 12 }} className="mb-2">Son daxilolmalar</div>
      <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${T.border}` }}>
        {intakes.length === 0 ? (
          <div className="px-4 py-4 text-sm" style={{ color: T.muted }}>Hələ anbara mal daxil edilməyib</div>
        ) : (
          intakes.slice(0, 15).map((r, i) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3" style={{ background: i % 2 ? T.panel : T.panel2 }}>
              <span style={{ fontSize: 14, flex: 1 }}>{menuItemLabel(menu, r.item)}</span>
              <span style={{ color: T.muted, fontSize: 13 }}>
                {new Date(r.timestamp).toLocaleDateString("az-AZ")} {fmtTime(r.timestamp)}
              </span>
              <span style={{ fontFamily: FONT_MONO, fontSize: 14, color: T.free, minWidth: 34, textAlign: "right" }}>+{r.qty}</span>
              {confirmDelete === r.id ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      onDeleteIntake(r);
                      setConfirmDelete(null);
                    }}
                    className="px-2 py-1 rounded text-xs font-semibold"
                    style={{ background: T.danger, color: "#1A0A0F" }}
                  >
                    Sil
                  </button>
                  <button onClick={() => setConfirmDelete(null)} className="px-2 py-1 rounded text-xs" style={{ color: T.muted }}>
                    İmtina
                  </button>
                </div>
              ) : (
                <button onClick={() => setConfirmDelete(r.id)} title="Daxilolmanı sil" className="p-1 rounded" style={{ color: T.muted }}>
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function CloseDayModal({ activeCount, onClose, onConfirm }) {
  const now = new Date();
  const [time, setTime] = useState(`${pad(now.getHours())}:${pad(now.getMinutes())}`);

  return (
    <Modal onClose={onClose} title="Günü bağla">
      <div style={{ color: T.muted, fontSize: 13 }} className="mb-3">
        {activeCount > 0
          ? `${activeCount} aktiv kabinet seçdiyiniz saata görə avtomatik hesablanıb bağlanacaq.`
          : "Aktiv kabinet yoxdur — gün bağlanacaq."}
      </div>
      <div style={{ color: T.muted, fontSize: 12 }} className="mb-1">Bağlanma saatı</div>
      <input
        type="time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        className="w-full mb-4 px-3 py-2 rounded-lg text-sm"
        style={{ background: T.panel2, border: `1px solid ${T.border}`, color: T.text, fontFamily: FONT_MONO }}
      />
      <button
        onClick={() => {
          const [h, m] = time.split(":").map(Number);
          const d = new Date();
          d.setHours(h, m, 0, 0);
          onConfirm(d.getTime());
        }}
        className="w-full py-3 rounded-xl font-semibold"
        style={{ background: T.danger, color: "#1A0A0F" }}
      >
        Günü bağla
      </button>
    </Modal>
  );
}

function OpenDayModal({ menu, warehouse, canAddStock = true, onClose, onConfirm }) {
  const [date, setDate] = useState(todayStr());
  const [additions, setAdditions] = useState({});

  return (
    <Modal onClose={onClose} title="Günü aç">
      <div style={{ color: T.muted, fontSize: 13 }} className="mb-3">
        {canAddStock
          ? "Yeni iş günü açılacaq. Dünənki qalıq avtomatik saxlanılır — istəsən bugünkü üçün əlavə mal da daxil edə bilərsən."
          : "Yeni iş günü açılacaq. Dünənki qalıq avtomatik saxlanılır."}
      </div>
      <div style={{ color: T.muted, fontSize: 12 }} className="mb-1">Gün tarixi</div>
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="w-full mb-4 px-3 py-2 rounded-lg text-sm"
        style={{ background: T.panel2, border: `1px solid ${T.border}`, color: T.text, fontFamily: FONT_MONO }}
      />

      {canAddStock && (
        <>
          <div style={{ color: T.muted, fontSize: 12 }} className="mb-2">Bugünkü stok (istəyə görə)</div>
          <div className="flex flex-col gap-3 mb-4">
            {itemsByCategory(menu).map(({ cat, items }) =>
              items.length === 0 ? null : (
                <div key={cat.id}>
                  <div style={{ color: T.muted, fontSize: 11, fontWeight: 600, letterSpacing: 0.4 }} className="mb-1.5 uppercase">
                    {cat.name}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {items.map((it) => (
                      <div key={it.id} className="flex items-center justify-between rounded-lg px-2.5 py-1.5" style={{ background: T.panel2 }}>
                        <div>
                          <span style={{ fontSize: 13 }}>{it.name}</span>
                          <span style={{ color: T.muted, fontSize: 11 }}> · qalıq: {warehouse[it.id] || 0}</span>
                        </div>
                        <input
                          type="number"
                          min="0"
                          placeholder="0"
                          value={additions[it.id] || ""}
                          onChange={(e) => setAdditions((p) => ({ ...p, [it.id]: parseInt(e.target.value, 10) || 0 }))}
                          className="w-16 px-2 py-1 rounded text-right text-sm"
                          style={{ background: T.panel, border: `1px solid ${T.border}`, color: T.text, fontFamily: FONT_MONO }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )
            )}
          </div>
        </>
      )}

      <button
        onClick={() => onConfirm(date, additions)}
        className="w-full py-3 rounded-xl font-semibold"
        style={{ background: T.free, color: "#0B0D14" }}
      >
        Günü aç
      </button>
    </Modal>
  );
}

// ---------- REPORTS ----------
function Reports({ businessDay, settings, onDeleteSale }) {
  const [mode, setMode] = useState("daily");
  return (
    <div>
      <div className="flex gap-1 mb-4" style={{ background: T.panel, borderRadius: 10, padding: 4, width: "fit-content" }}>
        {[{ k: "daily", l: "Günlük" }, { k: "monthly", l: "Aylıq" }].map((m) => (
          <button
            key={m.k}
            onClick={() => setMode(m.k)}
            className="px-3 py-1.5 rounded-lg text-sm"
            style={{ background: mode === m.k ? T.panel2 : "transparent", fontWeight: mode === m.k ? 600 : 400, color: mode === m.k ? T.text : T.muted }}
          >
            {m.l}
          </button>
        ))}
      </div>
      {mode === "daily" ? <DailyReport defaultDate={businessDay} settings={settings} onDeleteSale={onDeleteSale} /> : <MonthlyReport settings={settings} />}
    </div>
  );
}

function DailyReport({ defaultDate, settings, onDeleteSale }) {
  const [date, setDate] = useState(defaultDate || todayStr());
  const [sales, setSales] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  useEffect(() => {
    (async () => setSales((await safeGet(`sales:${date}`)) || []))();
  }, [date]);

  async function handleDelete(recordId) {
    const next = await onDeleteSale(date, recordId);
    setSales(next);
    setConfirmDel(null);
  }

  if (sales === null) return <div style={{ color: T.muted }}>Yüklənir…</div>;

  const cabinRevenue = sales.reduce((s, r) => s + (r.cabinCost || 0), 0);
  const stockRevenue = sales.reduce((s, r) => s + (r.stockTotal || 0), 0);
  const total = cabinRevenue + stockRevenue;
  const itemTotals = {};
  sales.forEach((r) => r.orders?.forEach((o) => {
    itemTotals[o.item] = itemTotals[o.item] || { qty: 0, revenue: 0 };
    itemTotals[o.item].qty += o.qty;
    itemTotals[o.item].revenue += o.qty * o.unitPrice;
  }));
  const sessions = sales.filter((r) => r.type === "cabinet");
  const stockSales = sales.filter((r) => r.type === "stock");

  const delControl = (recordId) =>
    confirmDel === recordId ? (
      <span className="flex items-center gap-1">
        <button
          onClick={() => handleDelete(recordId)}
          className="px-2 py-1 rounded text-xs font-semibold"
          style={{ background: T.danger, color: "#1A0A0F" }}
        >
          Sil
        </button>
        <button onClick={() => setConfirmDel(null)} className="px-2 py-1 rounded text-xs" style={{ color: T.muted }}>
          İmtina
        </button>
      </span>
    ) : (
      <button onClick={() => setConfirmDel(recordId)} title="Qeydi sil" className="p-1 rounded" style={{ color: T.muted }}>
        <Trash2 size={15} />
      </button>
    );

  return (
    <div>
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="mb-4 px-3 py-2 rounded-lg text-sm"
        style={{ background: T.panel2, border: `1px solid ${T.border}`, color: T.text }}
      />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <StatCard label="Ümumi gəlir" value={money(total)} icon={BarChart3} color={T.amber} mono />
        <StatCard label="Kabinet gəliri" value={money(cabinRevenue)} icon={Gamepad2} color={T.occupied} mono />
        <StatCard label="Stok gəliri" value={money(stockRevenue)} icon={ShoppingCart} color={T.free} mono />
      </div>

      <div style={{ color: T.muted, fontSize: 12 }} className="mb-2">Məhsul üzrə satış</div>
      <div className="rounded-2xl overflow-hidden mb-5" style={{ border: `1px solid ${T.border}` }}>
        {Object.keys(itemTotals).length === 0 ? (
          <div className="px-4 py-4 text-sm" style={{ color: T.muted }}>Bu gün stok satışı olmayıb</div>
        ) : (
          Object.entries(itemTotals).map(([itemId, d], i) => (
            <div key={itemId} className="flex items-center justify-between px-4 py-3" style={{ background: i % 2 ? T.panel : T.panel2 }}>
              <span style={{ fontSize: 14 }}>{menuItemLabel(settings.menu, itemId)}</span>
              <span style={{ color: T.muted, fontSize: 13 }}>{d.qty} ədəd</span>
              <span style={{ fontFamily: FONT_MONO, fontSize: 14 }}>{money(d.revenue)}</span>
            </div>
          ))
        )}
      </div>

      <div style={{ color: T.muted, fontSize: 12 }} className="mb-2">Kabinet sessiyaları ({sessions.length})</div>
      <div className="rounded-2xl overflow-hidden mb-5" style={{ border: `1px solid ${T.border}` }}>
        {sessions.length === 0 && (
          <div className="px-4 py-4 text-sm" style={{ color: T.muted }}>Bu gün üçün sessiya yoxdur</div>
        )}
        {sessions.map((r, i) => (
          <div key={r.id} className="flex items-center gap-3 px-4 py-3" style={{ background: i % 2 ? T.panel : T.panel2 }}>
            <span style={{ fontSize: 14, flex: 1 }}>
              {r.segments && r.segments.length > 1 ? r.segments.map((s) => cabinLabel(settings, s.cabinId)).join(" → ") : cabinLabel(settings, r.cabinetId)}
            </span>
            <span style={{ color: T.muted, fontSize: 13 }}>{fmtTime(r.startTime)}–{fmtTime(r.endTime)} · {r.minutes} dəq</span>
            <span style={{ fontFamily: FONT_MONO, fontSize: 14, minWidth: 64, textAlign: "right" }}>{money(r.grandTotal)}</span>
            {delControl(r.id)}
          </div>
        ))}
      </div>

      <div style={{ color: T.muted, fontSize: 12 }} className="mb-2">Stok satışları ({stockSales.length})</div>
      <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${T.border}` }}>
        {stockSales.length === 0 ? (
          <div className="px-4 py-4 text-sm" style={{ color: T.muted }}>Bu gün kabinetsiz stok satışı yoxdur</div>
        ) : (
          stockSales.map((r, i) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3" style={{ background: i % 2 ? T.panel : T.panel2 }}>
              <span style={{ fontSize: 14, flex: 1 }}>
                {r.orders?.map((o) => `${menuItemLabel(settings.menu, o.item)}×${o.qty}`).join(", ") || "Stok satışı"}
              </span>
              <span style={{ color: T.muted, fontSize: 13 }}>{r.endTime ? fmtTime(r.endTime) : ""}</span>
              <span style={{ fontFamily: FONT_MONO, fontSize: 14, minWidth: 64, textAlign: "right" }}>{money(r.grandTotal)}</span>
              {delControl(r.id)}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function MonthlyReport({ settings }) {
  const [month, setMonth] = useState(monthStrOf());
  const [days, setDays] = useState(null);

  useEffect(() => {
    (async () => {
      setDays(null);
      let keys = [];
      try {
        const res = await window.storage.list(`sales:${month}`, false);
        keys = res ? res.keys : [];
      } catch {
        keys = [];
      }
      const out = [];
      for (const k of keys) {
        const arr = (await safeGet(k)) || [];
        const day = k.replace("sales:", "");
        const rev = arr.reduce((s, r) => s + r.grandTotal, 0);
        out.push({ day, rev, sales: arr });
      }
      out.sort((a, b) => a.day.localeCompare(b.day));
      setDays(out);
    })();
  }, [month]);

  if (days === null) return <div style={{ color: T.muted }}>Yüklənir…</div>;

  const allSales = days.flatMap((d) => d.sales);
  const cabinRevenue = allSales.reduce((s, r) => s + (r.cabinCost || 0), 0);
  const stockRevenue = allSales.reduce((s, r) => s + (r.stockTotal || 0), 0);
  const total = cabinRevenue + stockRevenue;
  const itemTotals = {};
  allSales.forEach((r) => r.orders?.forEach((o) => {
    itemTotals[o.item] = itemTotals[o.item] || { qty: 0, revenue: 0 };
    itemTotals[o.item].qty += o.qty;
    itemTotals[o.item].revenue += o.qty * o.unitPrice;
  }));
  const maxRev = Math.max(1, ...days.map((d) => d.rev));

  return (
    <div>
      <input
        type="month"
        value={month}
        onChange={(e) => setMonth(e.target.value)}
        className="mb-4 px-3 py-2 rounded-lg text-sm"
        style={{ background: T.panel2, border: `1px solid ${T.border}`, color: T.text }}
      />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <StatCard label="Ümumi gəlir" value={money(total)} icon={BarChart3} color={T.amber} mono />
        <StatCard label="Kabinet gəliri" value={money(cabinRevenue)} icon={Gamepad2} color={T.occupied} mono />
        <StatCard label="Stok gəliri" value={money(stockRevenue)} icon={ShoppingCart} color={T.free} mono />
      </div>

      <div style={{ color: T.muted, fontSize: 12 }} className="mb-2">Məhsul üzrə satış (ay)</div>
      <div className="rounded-2xl overflow-hidden mb-5" style={{ border: `1px solid ${T.border}` }}>
        {Object.keys(itemTotals).length === 0 ? (
          <div className="px-4 py-4 text-sm" style={{ color: T.muted }}>Bu ay stok satışı olmayıb</div>
        ) : (
          Object.entries(itemTotals).map(([itemId, d], i) => (
            <div key={itemId} className="flex items-center justify-between px-4 py-3" style={{ background: i % 2 ? T.panel : T.panel2 }}>
              <span style={{ fontSize: 14 }}>{menuItemLabel(settings.menu, itemId)}</span>
              <span style={{ color: T.muted, fontSize: 13 }}>{d.qty} ədəd</span>
              <span style={{ fontFamily: FONT_MONO, fontSize: 14 }}>{money(d.revenue)}</span>
            </div>
          ))
        )}
      </div>

      <div style={{ color: T.muted, fontSize: 12 }} className="mb-2">Günlük gəlir</div>
      {days.length === 0 ? (
        <div className="rounded-2xl px-4 py-4 text-sm" style={{ border: `1px solid ${T.border}`, color: T.muted }}>
          Bu ay üçün məlumat yoxdur
        </div>
      ) : (
        <div className="rounded-2xl p-4 flex flex-col gap-2" style={{ border: `1px solid ${T.border}` }}>
          {days.map((d) => (
            <div key={d.day} className="flex items-center gap-3">
              <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: T.muted, width: 40 }}>{d.day.slice(-2)}</span>
              <div style={{ background: T.panel2, borderRadius: 6, height: 10, flex: 1 }}>
                <div style={{ width: `${(d.rev / maxRev) * 100}%`, background: T.amber, height: "100%", borderRadius: 6 }} />
              </div>
              <span style={{ fontFamily: FONT_MONO, fontSize: 12, width: 70, textAlign: "right" }}>{money(d.rev)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- SETTINGS ----------
function SettingsView({ settings, onSave, activeIds }) {
  const [form, setForm] = useState(settings);
  const [confirmReset, setConfirmReset] = useState(false);
  const [newCabinName, setNewCabinName] = useState("");
  const [newCabinRate, setNewCabinRate] = useState("1.5");
  const [confirmDeleteCabin, setConfirmDeleteCabin] = useState(null);
  const activeSet = new Set(activeIds || []);

  useEffect(() => setForm(settings), [settings]);

  function setCabinRate(id, v) {
    setForm((p) => ({ ...p, cabinRates: { ...p.cabinRates, [id]: v } }));
  }

  function setCabinName(id, v) {
    setForm((p) => ({ ...p, cabinNames: { ...(p.cabinNames || {}), [id]: v } }));
  }

  function setPin(who, v) {
    const digits = v.replace(/\D/g, "").slice(0, 6);
    setForm((p) => ({ ...p, pins: { ...(p.pins || {}), [who]: digits } }));
  }

  const cabinIds = Object.keys(form.cabinRates).map(Number).sort((a, b) => a - b);
  const suggestedNextId = cabinIds.length ? Math.max(...cabinIds) + 1 : 1;

  function addCabin() {
    const id = suggestedNextId;
    if (form.cabinRates[id] != null) return;
    const rate = parseFloat(newCabinRate) || 1.5;
    const nm = newCabinName.trim();
    setForm((p) => ({
      ...p,
      cabinRates: { ...p.cabinRates, [id]: rate },
      cabinNames: { ...(p.cabinNames || {}), [id]: nm },
    }));
    setNewCabinName("");
  }

  function deleteCabin(id) {
    setForm((p) => {
      const cabinRates = { ...p.cabinRates };
      delete cabinRates[id];
      const cabinNames = { ...(p.cabinNames || {}) };
      delete cabinNames[id];
      return { ...p, cabinRates, cabinNames };
    });
    setConfirmDeleteCabin(null);
  }

  return (
    <div className="max-w-md">
      <div className="rounded-2xl p-5 mb-4" style={{ background: T.panel, border: `1px solid ${T.border}` }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16 }} className="mb-1">Kabinetlər</div>
        <div style={{ color: T.muted, fontSize: 12 }} className="mb-3">Hər kabinetin adı (hərflə) və saatlıq tarifi (₼)</div>
        <div className="flex flex-col gap-2 mb-3">
          {cabinIds.map((id) => (
            <div key={id} className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: T.panel2 }}>
              <span style={{ fontSize: 12, color: T.muted, fontFamily: FONT_MONO, minWidth: 26 }}>#{pad(id)}</span>
              <input
                type="text"
                placeholder="Ad (məs: VIP otaq)"
                value={(form.cabinNames || {})[id] ?? ""}
                onChange={(e) => setCabinName(id, e.target.value)}
                className="flex-1 min-w-0 px-2 py-1 rounded text-sm"
                style={{ background: T.panel, border: `1px solid ${T.border}`, color: T.text }}
              />
              <input
                type="number"
                step="0.1"
                min="0"
                value={form.cabinRates[id]}
                onChange={(e) => setCabinRate(id, parseFloat(e.target.value) || 0)}
                className="w-16 px-2 py-1 rounded text-right text-sm"
                style={{ background: T.panel, border: `1px solid ${T.border}`, color: T.text, fontFamily: FONT_MONO }}
              />
              <span style={{ fontSize: 12, color: T.muted }}>₼</span>
              {confirmDeleteCabin === id ? (
                <span className="flex items-center gap-1">
                  <button
                    onClick={() => deleteCabin(id)}
                    className="px-2 py-1 rounded text-xs font-semibold"
                    style={{ background: T.danger, color: "#1A0A0F" }}
                  >
                    Sil
                  </button>
                  <button onClick={() => setConfirmDeleteCabin(null)} className="px-2 py-1 rounded text-xs" style={{ color: T.muted }}>
                    İmtina
                  </button>
                </span>
              ) : activeSet.has(id) ? (
                <span title="Aktiv sessiya var — silmək olmaz" style={{ color: T.muted, opacity: 0.4 }}>
                  <Trash2 size={15} />
                </span>
              ) : (
                <button onClick={() => setConfirmDeleteCabin(id)} title="Kabineti sil" className="p-0.5 rounded" style={{ color: T.muted }}>
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
        <div style={{ color: T.muted, fontSize: 12 }} className="mb-1.5">Yeni kabinet əlavə et (#{pad(suggestedNextId)})</div>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Ad (məs: PS5 otaq)"
            value={newCabinName}
            onChange={(e) => setNewCabinName(e.target.value)}
            className="flex-1 min-w-0 px-2 py-1.5 rounded-lg text-sm"
            style={{ background: T.panel2, border: `1px solid ${T.border}`, color: T.text }}
          />
          <input
            type="number"
            step="0.1"
            min="0"
            placeholder="tarif"
            value={newCabinRate}
            onChange={(e) => setNewCabinRate(e.target.value)}
            className="w-16 px-2 py-1.5 rounded-lg text-sm"
            style={{ background: T.panel2, border: `1px solid ${T.border}`, color: T.text, fontFamily: FONT_MONO }}
          />
          <button
            onClick={addCabin}
            className="rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 px-3 shrink-0"
            style={{ background: T.occupied, color: "#0B0D14" }}
          >
            <Plus size={14} /> Əlavə et
          </button>
        </div>
      </div>

      <div className="rounded-2xl p-5 mb-4" style={{ background: T.panel, border: `1px solid ${T.border}` }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16 }} className="mb-1">Menyu ayarları</div>
        <div style={{ color: T.muted, fontSize: 12 }} className="mb-3">Bölmələr və məhsullar</div>
        <MenuSettingsPanel menu={form.menu} onChange={(menu) => setForm((p) => ({ ...p, menu }))} />
      </div>

      <div className="rounded-2xl p-5 mb-4" style={{ background: T.panel, border: `1px solid ${T.border}` }}>
        <div className="flex items-center gap-2 mb-1">
          <KeyRound size={16} color={T.amber} />
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16 }}>Giriş PIN kodları</div>
        </div>
        <div style={{ color: T.muted, fontSize: 12 }} className="mb-3">Profillərə giriş üçün PIN kodları</div>
        <div className="flex flex-col gap-2">
          {[
            { who: "worker", label: "İşçi", icon: User, color: T.free },
            { who: "manager", label: "Müdir", icon: ShieldCheck, color: T.occupied },
          ].map((p) => (
            <div key={p.who} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: T.panel2 }}>
              <span className="flex items-center gap-2" style={{ fontSize: 13, color: T.muted }}>
                <p.icon size={15} color={p.color} /> {p.label} PIN
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={(form.pins || {})[p.who] ?? ""}
                onChange={(e) => setPin(p.who, e.target.value)}
                className="w-24 px-2 py-1 rounded text-right text-sm"
                style={{ background: T.panel, border: `1px solid ${T.border}`, color: T.text, fontFamily: FONT_MONO, letterSpacing: 2 }}
              />
            </div>
          ))}
        </div>
      </div>

      <button onClick={() => onSave(form)} className="w-full py-3 rounded-xl font-semibold mb-4" style={{ background: T.free, color: "#0B0D14" }}>
        Yadda saxla
      </button>

      <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.border}` }}>
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={16} color={T.danger} />
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15 }}>Sıfırlama</div>
        </div>
        <div style={{ color: T.muted, fontSize: 13 }} className="mb-3">
          Bütün kabinetləri "boş" vəziyyətinə qaytarır. Keçmiş satış tarixçəsinə toxunmur.
        </div>
        {!confirmReset ? (
          <button
            onClick={() => setConfirmReset(true)}
            className="w-full py-2.5 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold"
            style={{ border: `1px solid ${T.danger}`, color: T.danger }}
          >
            <RotateCcw size={14} /> Aktiv sessiyaları sıfırla
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={async () => {
                await safeSet("active-sessions", {});
                window.location.reload();
              }}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: T.danger, color: "#1A0A0F" }}
            >
              Təsdiqlə
            </button>
            <button onClick={() => setConfirmReset(false)} className="flex-1 py-2.5 rounded-xl text-sm" style={{ border: `1px solid ${T.border}`, color: T.muted }}>
              İmtina
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function MenuSettingsPanel({ menu, onChange }) {
  const [newCatName, setNewCatName] = useState("");
  const [confirmDeleteCat, setConfirmDeleteCat] = useState(null);
  const [newItemForms, setNewItemForms] = useState({});
  const [confirmDeleteItem, setConfirmDeleteItem] = useState(null);

  function addCategory() {
    const name = newCatName.trim();
    if (!name) return;
    const id = `cat-${Date.now()}`;
    onChange({ ...menu, categories: [...menu.categories, { id, name }] });
    setNewCatName("");
  }
  function deleteCategory(catId) {
    onChange({
      ...menu,
      categories: menu.categories.filter((c) => c.id !== catId),
      items: menu.items.filter((it) => it.categoryId !== catId),
    });
    setConfirmDeleteCat(null);
  }
  function addItem(catId) {
    const f = newItemForms[catId] || {};
    const name = (f.name || "").trim();
    const price = parseFloat(f.price) || 0;
    if (!name) return;
    const id = `item-${Date.now()}`;
    onChange({ ...menu, items: [...menu.items, { id, name, categoryId: catId, price }] });
    setNewItemForms((p) => ({ ...p, [catId]: { name: "", price: "" } }));
  }
  function deleteItem(itemId) {
    onChange({ ...menu, items: menu.items.filter((it) => it.id !== itemId) });
    setConfirmDeleteItem(null);
  }
  function updateItemPrice(itemId, price) {
    onChange({ ...menu, items: menu.items.map((it) => (it.id === itemId ? { ...it, price } : it)) });
  }

  return (
    <div>
      {menu.categories.map((cat) => {
        const Icon = categoryIcon(cat.id);
        const items = menu.items.filter((it) => it.categoryId === cat.id);
        const f = newItemForms[cat.id] || { name: "", price: "" };
        return (
          <div key={cat.id} className="mb-4 rounded-xl p-3" style={{ background: T.panel2 }}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Icon size={15} color={T.muted} />
                <span style={{ fontWeight: 600, fontSize: 14 }}>{cat.name}</span>
              </div>
              {confirmDeleteCat === cat.id ? (
                <div className="flex gap-1">
                  <button
                    onClick={() => deleteCategory(cat.id)}
                    className="px-2 py-1 rounded text-xs font-semibold"
                    style={{ background: T.danger, color: "#1A0A0F" }}
                  >
                    Təsdiqlə
                  </button>
                  <button onClick={() => setConfirmDeleteCat(null)} className="px-2 py-1 rounded text-xs" style={{ color: T.muted }}>
                    İmtina
                  </button>
                </div>
              ) : (
                <button onClick={() => setConfirmDeleteCat(cat.id)}><X size={14} color={T.muted} /></button>
              )}
            </div>

            <div className="flex flex-col gap-1.5 mb-2">
              {items.length === 0 && <div style={{ color: T.muted, fontSize: 12 }}>Bu bölmədə məhsul yoxdur</div>}
              {items.map((it) => (
                <div key={it.id} className="flex items-center justify-between rounded-lg px-2.5 py-1.5" style={{ background: T.panel }}>
                  <span style={{ fontSize: 13 }}>{it.name}</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={it.price}
                      onChange={(e) => updateItemPrice(it.id, parseFloat(e.target.value) || 0)}
                      className="w-16 px-1.5 py-1 rounded text-right text-xs"
                      style={{ background: T.panel2, border: `1px solid ${T.border}`, color: T.text, fontFamily: FONT_MONO }}
                    />
                    {confirmDeleteItem === it.id ? (
                      <div className="flex gap-1">
                        <button
                          onClick={() => deleteItem(it.id)}
                          className="px-1.5 py-0.5 rounded text-xs font-semibold"
                          style={{ background: T.danger, color: "#1A0A0F" }}
                        >
                          Sil
                        </button>
                        <button onClick={() => setConfirmDeleteItem(null)} className="px-1.5 py-0.5 rounded text-xs" style={{ color: T.muted }}>
                          İmtina
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDeleteItem(it.id)}><X size={13} color={T.muted} /></button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-1.5">
              <input
                placeholder="Yeni məhsul adı"
                value={f.name}
                onChange={(e) => setNewItemForms((p) => ({ ...p, [cat.id]: { ...f, name: e.target.value } }))}
                className="flex-1 min-w-0 px-2 py-1.5 rounded-lg text-xs"
                style={{ background: T.panel, border: `1px solid ${T.border}`, color: T.text }}
              />
              <input
                type="number"
                step="0.1"
                min="0"
                placeholder="qiymət"
                value={f.price}
                onChange={(e) => setNewItemForms((p) => ({ ...p, [cat.id]: { ...f, price: e.target.value } }))}
                className="w-20 px-2 py-1.5 rounded-lg text-xs"
                style={{ background: T.panel, border: `1px solid ${T.border}`, color: T.text, fontFamily: FONT_MONO }}
              />
              <button
                onClick={() => addItem(cat.id)}
                className="px-2.5 rounded-lg text-xs font-semibold shrink-0"
                style={{ background: T.free, color: "#0B0D14" }}
              >
                <Plus size={13} />
              </button>
            </div>
          </div>
        );
      })}

      <div className="flex gap-2">
        <input
          placeholder="Yeni bölmə adı (məs: Şirniyyat)"
          value={newCatName}
          onChange={(e) => setNewCatName(e.target.value)}
          className="flex-1 min-w-0 px-3 py-2 rounded-lg text-sm"
          style={{ background: T.panel2, border: `1px solid ${T.border}`, color: T.text }}
        />
        <button
          onClick={addCategory}
          className="px-3 rounded-lg text-sm font-semibold shrink-0 flex items-center gap-1.5"
          style={{ background: T.occupied, color: "#0B0D14" }}
        >
          <Plus size={14} /> Bölmə əlavə et
        </button>
      </div>
    </div>
  );
}
