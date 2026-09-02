using Microsoft.Data.Sqlite;

var builder = WebApplication.CreateBuilder(args);

// Frontend (Vite dev serveri) ilə əlaqə üçün CORS
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
        policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod());
});

var app = builder.Build();

app.UseCors();

// API cavabları keşlənməsin (köhnə açar-dəyər qaytarılmasın)
app.Use(async (ctx, next) =>
{
    if (ctx.Request.Path.StartsWithSegments("/api"))
    {
        ctx.Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate";
        ctx.Response.Headers["Pragma"] = "no-cache";
    }
    await next();
});

// Frontend (build olunmuş statik fayllar wwwroot-dan) verilir
app.UseDefaultFiles();
app.UseStaticFiles();

// ---------- SQLite açar-dəyər anbarı ----------
// DB_DIR mühit dəyişəni ilə (məs. Docker volume) təyin oluna bilər
var dbDir = Environment.GetEnvironmentVariable("DB_DIR") ?? AppContext.BaseDirectory;
Directory.CreateDirectory(dbDir);
var dbPath = Path.Combine(dbDir, "psklub.db");
var connectionString = $"Data Source={dbPath}";

// Hər açılan bağlantıda kilid gözləmə vaxtı — çox cihazlı yazmalarda "database is locked" olmasın
SqliteConnection OpenConnection()
{
    var c = new SqliteConnection(connectionString);
    c.Open();
    using (var pragma = c.CreateCommand())
    {
        pragma.CommandText = "PRAGMA busy_timeout=5000;";
        pragma.ExecuteNonQuery();
    }
    return c;
}

using (var conn = OpenConnection())
{
    using var cmd = conn.CreateCommand();
    // WAL — eyni anda oxu+yaz üçün daha yaxşı konkurentlik (bir dəfə DB faylına yazılır)
    cmd.CommandText = "PRAGMA journal_mode=WAL;";
    cmd.ExecuteNonQuery();
    // Version — hər yazmada 1 artır. Frontend oxuduğu versiyanı geri göndərir;
    // aralıqda başqa cihaz yazıbsa yazma rədd edilir (409) və birləşdirilib təkrarlanır.
    cmd.CommandText = @"CREATE TABLE IF NOT EXISTS Store (
        Key     TEXT PRIMARY KEY,
        Value   TEXT NOT NULL,
        Version INTEGER NOT NULL DEFAULT 0
    );";
    cmd.ExecuteNonQuery();
    // Köhnə bazada Version sütunu olmaya bilər — miqrasiya
    var hasVersion = false;
    cmd.CommandText = "PRAGMA table_info(Store);";
    using (var info = cmd.ExecuteReader())
    {
        while (info.Read())
            if (string.Equals(info.GetString(1), "Version", StringComparison.OrdinalIgnoreCase))
                hasVersion = true;
    }
    if (!hasVersion)
    {
        cmd.CommandText = "ALTER TABLE Store ADD COLUMN Version INTEGER NOT NULL DEFAULT 0;";
        cmd.ExecuteNonQuery();
    }
}

// ---------- Endpoint-lər (frontend window.storage interfeysinə uyğun) ----------

// GET /api/storage/get?key=...  ->  { value, version } | null
app.MapGet("/api/storage/get", (string key) =>
{
    try
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT Value, Version FROM Store WHERE Key = $key";
        cmd.Parameters.AddWithValue("$key", key);
        using var reader = cmd.ExecuteReader();
        // Açar yoxdursa literal "null" JSON qaytar (boş body YOX) — frontend bunu
        // düzgün "məlumat yoxdur" kimi anlasın, "offline" ilə qarışdırmasın.
        if (!reader.Read()) return Results.Content("null", "application/json");
        return Results.Json(new { value = reader.GetString(0), version = reader.GetInt64(1) });
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = ex.Message }, statusCode: 500);
    }
});

// POST /api/storage/set  { key, value, expectedVersion? }
//   expectedVersion YOXDURSA  -> şərtsiz yazır (son yazan qalib) — skalyar açarlar üçün
//   expectedVersion VARSA     -> yalnız versiya uyğun gələndə yazır (optimistik kilid).
//     Uyğun gəlmirsə 409 + serverdəki son { value, version } qaytarılır ki, frontend
//     öz dəyişikliyini onun ÜZƏRİNƏ birləşdirib təkrar göndərsin.
//   Bu, iki cihaz eyni anda yazanda "itmiş yeniləmə"nin (bağlanmış kabinetin geri
//   qayıtmasının, stok qalığının geri sıçramasının) qarşısını alır.
app.MapPost("/api/storage/set", (StoreEntry entry) =>
{
    if (entry is null || entry.Key is null || entry.Value is null)
        return Results.BadRequest(new { ok = false });
    try
    {
        using var conn = OpenConnection();
        // BEGIN IMMEDIATE — oxu+yaz bir atomik əməliyyat kimi (yazma kilidi dərhal alınır)
        using (var begin = conn.CreateCommand())
        {
            begin.CommandText = "BEGIN IMMEDIATE;";
            begin.ExecuteNonQuery();
        }
        try
        {
            long currentVersion = 0;
            string? currentValue = null;
            using (var sel = conn.CreateCommand())
            {
                sel.CommandText = "SELECT Value, Version FROM Store WHERE Key = $key";
                sel.Parameters.AddWithValue("$key", entry.Key);
                using var r = sel.ExecuteReader();
                if (r.Read())
                {
                    currentValue = r.GetString(0);
                    currentVersion = r.GetInt64(1);
                }
            }

            if (entry.ExpectedVersion is long expected && expected != currentVersion)
            {
                using (var rb = conn.CreateCommand())
                {
                    rb.CommandText = "ROLLBACK;";
                    rb.ExecuteNonQuery();
                }
                return Results.Json(
                    new { ok = false, conflict = true, value = currentValue, version = currentVersion },
                    statusCode: 409);
            }

            var nextVersion = currentVersion + 1;
            using (var up = conn.CreateCommand())
            {
                up.CommandText = @"INSERT INTO Store (Key, Value, Version) VALUES ($key, $value, $ver)
                    ON CONFLICT(Key) DO UPDATE SET Value = excluded.Value, Version = excluded.Version";
                up.Parameters.AddWithValue("$key", entry.Key);
                up.Parameters.AddWithValue("$value", entry.Value);
                up.Parameters.AddWithValue("$ver", nextVersion);
                up.ExecuteNonQuery();
            }
            using (var commit = conn.CreateCommand())
            {
                commit.CommandText = "COMMIT;";
                commit.ExecuteNonQuery();
            }
            return Results.Json(new { ok = true, version = nextVersion });
        }
        catch
        {
            try
            {
                using var rb = conn.CreateCommand();
                rb.CommandText = "ROLLBACK;";
                rb.ExecuteNonQuery();
            }
            catch { /* tranzaksiya artıq bağlanıb */ }
            throw;
        }
    }
    catch (Exception ex)
    {
        return Results.Json(new { ok = false, error = ex.Message }, statusCode: 500);
    }
});

// POST /api/storage/delete  { key }  ->  { ok: true }
app.MapPost("/api/storage/delete", (KeyOnly body) =>
{
    if (body is null || body.Key is null)
        return Results.BadRequest(new { ok = false });
    try
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM Store WHERE Key = $key";
        cmd.Parameters.AddWithValue("$key", body.Key);
        cmd.ExecuteNonQuery();
        return Results.Json(new { ok = true });
    }
    catch (Exception ex)
    {
        return Results.Json(new { ok = false, error = ex.Message }, statusCode: 500);
    }
});

// GET /api/storage/list?prefix=...  ->  { keys: [...] }
app.MapGet("/api/storage/list", (string? prefix) =>
{
    try
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        if (string.IsNullOrEmpty(prefix))
        {
            cmd.CommandText = "SELECT Key FROM Store ORDER BY Key";
        }
        else
        {
            cmd.CommandText = "SELECT Key FROM Store WHERE Key LIKE $p ESCAPE '\\' ORDER BY Key";
            var escaped = prefix.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
            cmd.Parameters.AddWithValue("$p", escaped + "%");
        }
        var keys = new List<string>();
        using var reader = cmd.ExecuteReader();
        while (reader.Read()) keys.Add(reader.GetString(0));
        return Results.Json(new { keys });
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = ex.Message }, statusCode: 500);
    }
});

// SPA fallback — API-yə aid olmayan yollar üçün index.html
app.MapFallbackToFile("index.html");

app.Run();

record StoreEntry(string Key, string Value, long? ExpectedVersion);
record KeyOnly(string Key);
