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

// ---------- SQLite açar-dəyər anbarı ----------
var dbPath = Path.Combine(AppContext.BaseDirectory, "psklub.db");
var connectionString = $"Data Source={dbPath}";

using (var conn = new SqliteConnection(connectionString))
{
    conn.Open();
    using var cmd = conn.CreateCommand();
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
    using var conn = new SqliteConnection(connectionString);
    conn.Open();
    using var cmd = conn.CreateCommand();
    cmd.CommandText = "SELECT Value FROM Store WHERE Key = $key";
    cmd.Parameters.AddWithValue("$key", key);
    var result = cmd.ExecuteScalar();
    if (result is null) return Results.Json<object?>(null);
    return Results.Json(new { value = (string)result });
});

// POST /api/storage/set  { key, value }  ->  { ok: true }
app.MapPost("/api/storage/set", (StoreEntry entry) =>
{
    if (entry is null || entry.Key is null || entry.Value is null)
        return Results.BadRequest(new { ok = false });

    using var conn = new SqliteConnection(connectionString);
    conn.Open();
    using var cmd = conn.CreateCommand();
    cmd.CommandText = @"INSERT INTO Store (Key, Value) VALUES ($key, $value)
        ON CONFLICT(Key) DO UPDATE SET Value = excluded.Value";
    cmd.Parameters.AddWithValue("$key", entry.Key);
    cmd.Parameters.AddWithValue("$value", entry.Value);
    cmd.ExecuteNonQuery();
    return Results.Json(new { ok = true });
});

// GET /api/storage/list?prefix=...  ->  { keys: [...] }
app.MapGet("/api/storage/list", (string? prefix) =>
{
    using var conn = new SqliteConnection(connectionString);
    conn.Open();
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
});

app.MapGet("/", () => "PS Klub backend işləyir.");

app.Run();

record StoreEntry(string Key, string Value);
