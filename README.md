# PS Klub — İdarəetmə

React (Vite) frontend + .NET (ASP.NET Core + SQLite) backend.

## Struktur

- `src/` — React frontend (App.jsx orijinal koddur, dəyişdirilməyib)
- `src/storage.js` — `window.storage` shim-i, backend API-yə qoşulur
- `backend/` — ASP.NET Core Minimal API + SQLite açar-dəyər anbarı

## İşə salma

İki terminal lazımdır.

### 1) Backend (.NET)

```bash
cd backend
dotnet run --launch-profile http
```

Backend `http://localhost:5100` ünvanında işləyir. Verilənlər `backend/bin/.../psklub.db` SQLite faylında saxlanılır.

### 2) Frontend (React)

```bash
npm install
npm run dev
```

Frontend `http://localhost:5173` ünvanında açılır.

Backend başqa portdadırsa, `.env` faylında dəyişə bilərsən:

```
VITE_API_URL=http://localhost:5100
```

## Backend API

| Metod | Ünvan | Təsvir |
|-------|-------|--------|
| GET  | `/api/storage/get?key=...` | Açara görə dəyər (`{ value }` və ya `null`) |
| POST | `/api/storage/set` | Body: `{ key, value }` — yazır/yeniləyir |
| GET  | `/api/storage/list?prefix=...` | Prefiksə uyğun açarların siyahısı (`{ keys }`) |
