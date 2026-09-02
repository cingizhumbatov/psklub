// ---------- ÜÇ-TƏRƏFLİ BİRLƏŞDİRMƏ ----------
// İki cihaz eyni anda yazanda "itmiş yeniləmə" olmasın deyə backend optimistik
// kilid (versiya) tətbiq edir. Versiya uyğun gəlmirsə burdakı funksiyalar işə düşür:
//
//   base   — bu cihazın dəyişikliyə başlayanda oxuduğu vəziyyət
//   mine   — bu cihazın nəticəsi
//   theirs — serverdəki ƏN SON vəziyyət (aralıqda başqa cihaz yazıb)
//
// Nəticə: theirs üzərinə YALNIZ bizim etdiyimiz dəyişiklik qoyulur. Beləliklə
// başqa cihazın bağladığı kabinet geri qayıtmır, satdığı mal stoka qayıtmır.

const round2 = (n) => Math.round(n * 100) / 100;
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Kabinet id-si ilə obyekt (active-sessions)
export function mergeSessions(base, mine, theirs) {
  const out = { ...theirs };
  // 1) Bizim BAĞLADIĞIMIZ kabinetlər — hökmən bağlı qalsın
  Object.keys(base).forEach((id) => {
    if (!(id in mine)) delete out[id];
  });
  // 2) Bizim açdığımız/dəyişdirdiyimiz kabinetlər
  Object.keys(mine).forEach((id) => {
    const inBase = id in base;
    if (inBase && sameJson(base[id], mine[id])) return; // toxunmamışıq
    // Başqa cihaz bu kabineti aralıqda BAĞLAYIBSA, bizim dəyişikliyimiz onu DİRİLTMƏSİN
    if (inBase && !(id in theirs)) return;
    out[id] = mine[id];
  });
  return out;
}

// Ədədi qalıqlar (warehouse) — fərq (delta) kimi tətbiq olunur, mütləq dəyər kimi yox
export function mergeCounts(base, mine, theirs) {
  const out = { ...theirs };
  new Set([...Object.keys(base), ...Object.keys(mine)]).forEach((k) => {
    if (!(k in mine)) {
      delete out[k]; // menyudan çıxarılıb
      return;
    }
    const delta = round2((mine[k] || 0) - (base[k] || 0));
    if (delta === 0) return;
    out[k] = round2(Math.max(0, (out[k] || 0) + delta));
  });
  return out;
}

// id-li qeyd siyahıları (sales:*, stock-intakes)
export function mergeListById(base, mine, theirs, cap) {
  const baseById = new Map(base.map((r) => [r.id, r]));
  const mineById = new Map(mine.map((r) => [r.id, r]));
  const theirsIds = new Set(theirs.map((r) => r.id));
  // Bizim SİLDİYİMİZ qeydlər silinmiş qalsın
  const removedByMe = new Set([...baseById.keys()].filter((id) => !mineById.has(id)));
  let out = theirs
    .filter((r) => !removedByMe.has(r.id))
    // Bizim DƏYİŞDİRDİYİMİZ qeydlər (məs. qaytarma) tətbiq olunsun
    .map((r) => {
      const m = mineById.get(r.id);
      const b = baseById.get(r.id);
      return m && b && !sameJson(b, m) ? m : r;
    });
  // Bizim ƏLAVƏ etdiyimiz yeni qeydlər
  mine.forEach((r) => {
    if (!baseById.has(r.id) && !theirsIds.has(r.id)) out.push(r);
  });
  if (cap > 0) {
    out = [...out].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, cap);
  }
  return out;
}

// Açara görə birləşdirmə strategiyası. Siyahıda olmayan açarlar (settings, day-open,
// current-business-day, day-opened-at) skalyar sayılır — son yazan qalib.
export function mergeForKey(key, base, mine, theirs) {
  if (key === "active-sessions") return mergeSessions(base || {}, mine || {}, theirs || {});
  if (key === "warehouse") return mergeCounts(base || {}, mine || {}, theirs || {});
  if (key === "stock-intakes") return mergeListById(base || [], mine || [], theirs || [], 80);
  if (key.startsWith("sales:")) return mergeListById(base || [], mine || [], theirs || [], 0);
  return mine;
}

export const isMergeableKey = (key) =>
  key === "active-sessions" || key === "warehouse" || key === "stock-intakes" || key.startsWith("sales:");
