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
    cmd.CommandText = @"CREATE TABLE IF NOT EXISTS Store (
        Key   TEXT PRIMARY KEY,
        Value TEXT NOT NULL
    );";
    cmd.ExecuteNonQuery();
}

// ---------- Endpoint-lər (frontend window.storage interfeysinə uyğun) ----------

// GET /api/storage/get?key=...  ->  { value } | null
app.MapGet("/api/storage/get", (string key) =>
{
    try
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT Value FROM Store WHERE Key = $key";
        cmd.Parameters.AddWithValue("$key", key);
        var result = cmd.ExecuteScalar();
        if (result is null) return Results.Json<object?>(null);
        return Results.Json(new { value = (string)result });
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = ex.Message }, statusCode: 500);
    }
});

// POST /api/storage/set  { key, value }  ->  { ok: true }
app.MapPost("/api/storage/set", (StoreEntry entry) =>
{
    if (entry is null || entry.Key is null || entry.Value is null)
        return Results.BadRequest(new { ok = false });
    try
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"INSERT INTO Store (Key, Value) VALUES ($key, $value)
            ON CONFLICT(Key) DO UPDATE SET Value = excluded.Value";
        cmd.Parameters.AddWithValue("$key", entry.Key);
        cmd.Parameters.AddWithValue("$value", entry.Value);
        cmd.ExecuteNonQuery();
        return Results.Json(new { ok = true });
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

record StoreEntry(string Key, string Value);
record KeyOnly(string Key);
