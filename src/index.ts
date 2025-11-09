type Env = {
  API_ALLOWED_ORIGINS?: string;
  VERSION?: string;
  TELEGRAM_TOKEN?: string;
  TELEGRAM_CHAT?: string;
  REQUESTS_DB?: D1Database;
};

const FALLBACK_TELEGRAM_TOKEN = "8569580291:AAGmlcW72QooX00CCpEAE3sco7uA2NV6j2U";
const FALLBACK_TELEGRAM_CHAT = "887525450";

type StoredRequest = {
  id: string;
  name: string;
  email: string;
  style: string;
  description?: string;
  filename?: string;
  createdAt: string;
  status: "pending" | "in_progress" | "completed";
};

type CatalogEntry = {
  id: string;
  title: string;
  status: "requested" | "published";
  isrc?: string;
  upc?: string;
  submittedAt: string;
};

type CatalogRow = {
  id: string;
  title: string;
  status: string;
  isrc?: string | null;
  upc?: string | null;
  submitted_at: string;
};

type PublishedTrack = {
  id: number;
  name: string;
  isrc: string;
  upc: string;
};

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8"
};

const DEFAULT_ALLOWED_ORIGINS = ["*"];
const PUBLIC_SITE_PREFIX = "/public-site";
const CATALOG_PATH = `${PUBLIC_SITE_PREFIX}/catalog`;

const TABLE_SQL = `CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  style TEXT NOT NULL,
  description TEXT,
  filename TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL
)`;

const CATALOG_SQL = `CREATE TABLE IF NOT EXISTS catalog (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  isrc TEXT,
  upc TEXT,
  submitted_at TEXT NOT NULL
)`;

let requestsTablePromise: Promise<void> | undefined;
let catalogTablePromise: Promise<void> | undefined;

const toJSONResponse = (
  payload: unknown,
  init?: { status?: number; headers?: Record<string, string> }
) =>
  new Response(JSON.stringify(payload, null, 2), {
    status: init?.status ?? 200,
    headers: {
      ...JSON_HEADERS,
      ...init?.headers
    }
  });

const getAllowedOrigins = (env: Env): string[] => {
  if (!env.API_ALLOWED_ORIGINS) {
    return DEFAULT_ALLOWED_ORIGINS;
  }

  return env.API_ALLOWED_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
};

const applyCors = (request: Request, response: Response, env: Env): Response => {
  const headers = new Headers(response.headers);
  const origin = request.headers.get("Origin");
  const allowedOrigins = getAllowedOrigins(env);

  const allowOrigin =
    allowedOrigins.includes("*") || !origin
      ? allowedOrigins[0] ?? "*"
      : allowedOrigins.includes(origin)
        ? origin
        : allowedOrigins[0] ?? "null";

  headers.set("Access-Control-Allow-Origin", allowOrigin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Headers", request.headers.get("Access-Control-Request-Headers") ?? "Content-Type");
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

  if (allowOrigin === "*") {
    headers.set("Access-Control-Allow-Credentials", "false");
  } else {
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};

const handleOptions = (request: Request, env: Env) => {
  const response = new Response(null, {
    status: 204
  });

  return applyCors(request, response, env);
};

const parseJson = async <T>(request: Request): Promise<T | undefined> => {
  const text = await request.text();

  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error("Invalid JSON payload");
  }
};

const ensureRequestsTable = async (env: Env) => {
  if (!env.REQUESTS_DB) {
    throw new Error("REQUESTS_DB binding is not configured");
  }

  if (!requestsTablePromise) {
    requestsTablePromise = env.REQUESTS_DB.prepare(TABLE_SQL)
      .run()
      .then(() => undefined)
      .catch((error) => {
        requestsTablePromise = undefined;
        throw error;
      });
  }

  return requestsTablePromise;
};

const ensureCatalogTable = async (env: Env) => {
  if (!env.REQUESTS_DB) {
    throw new Error("REQUESTS_DB binding is not configured");
  }

  if (!catalogTablePromise) {
    catalogTablePromise = env.REQUESTS_DB.prepare(CATALOG_SQL)
      .run()
      .then(() => undefined)
      .catch((error) => {
        catalogTablePromise = undefined;
        throw error;
      });
  }

  return catalogTablePromise;
};

const seedCatalogDefaults = async (env: Env) => {
  if (!env.REQUESTS_DB) {
    throw new Error("REQUESTS_DB binding is not configured");
  }

  await ensureCatalogTable(env);
  await Promise.all(
    publishedTracks.map((track) =>
      env.REQUESTS_DB!.prepare(
        `INSERT OR IGNORE INTO catalog (id, title, status, isrc, upc, submitted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
      )
        .bind(track.id, track.title, track.status, track.isrc ?? null, track.upc ?? null, track.submittedAt)
        .run()
    )
  );
};

const saveRequest = async (env: Env, entry: StoredRequest) => {
  if (!env.REQUESTS_DB) {
    throw new Error("REQUESTS_DB binding is not configured");
  }

  await ensureRequestsTable(env);
  await env.REQUESTS_DB.prepare(
    `INSERT OR REPLACE INTO requests (id, name, email, style, description, filename, created_at, status)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  )
    .bind(entry.id, entry.name, entry.email, entry.style, entry.description ?? null, entry.filename ?? null, entry.createdAt, entry.status)
    .run();
};

const addCatalogEntry = async (env: Env, entry: CatalogEntry) => {
  if (!env.REQUESTS_DB) {
    throw new Error("REQUESTS_DB binding is not configured");
  }

  await ensureCatalogTable(env);
  await env.REQUESTS_DB.prepare(
    `INSERT OR REPLACE INTO catalog (id, title, status, isrc, upc, submitted_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
  )
    .bind(entry.id, entry.title, entry.status, entry.isrc ?? null, entry.upc ?? null, entry.submittedAt)
    .run();
};

const rowToCatalogEntry = (row: CatalogRow): CatalogEntry => ({
  id: row.id,
  title: row.title,
  status: (row.status as CatalogEntry["status"]) ?? "requested",
  isrc: row.isrc ?? undefined,
  upc: row.upc ?? undefined,
  submittedAt: row.submitted_at
});

const listCatalogEntries = async (env: Env, status?: CatalogEntry["status"]): Promise<CatalogEntry[]> => {
  if (!env.REQUESTS_DB) {
    throw new Error("REQUESTS_DB binding is not configured");
  }
  await ensureCatalogTable(env);
  await seedCatalogDefaults(env);
  const query = status ? "SELECT * FROM catalog WHERE status = ?1 ORDER BY datetime(submitted_at) DESC" : "SELECT * FROM catalog ORDER BY datetime(submitted_at) DESC";
  const stmt = env.REQUESTS_DB.prepare(query);
  const result = status ? await stmt.bind(status).all() : await stmt.all();
  const rows = (result.results ?? []) as CatalogRow[];
  return rows.map(rowToCatalogEntry);
};

const notifyTelegram = async (env: Env, entry: StoredRequest, extra?: string) => {
  const token = env.TELEGRAM_TOKEN ?? FALLBACK_TELEGRAM_TOKEN;
  const chat = env.TELEGRAM_CHAT ?? FALLBACK_TELEGRAM_CHAT;

  if (!token || !chat) {
    return;
  }

  const rows = [
    "🆕 Nueva solicitud de canción",
    `• Nombre: ${entry.name}`,
    `• Email: ${entry.email}`,
    `• Estilo: ${entry.style}`,
    entry.description ? `• Descripción: ${entry.description}` : "",
    entry.filename ? `• Archivo: ${entry.filename}` : "",
    extra ? `• Notas: ${extra}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chat,
      text: rows
    })
  });
};

const handleRoot = (request: Request, env: Env) =>
  toJSONResponse({
    service: "qloudsound-api",
    version: env.VERSION ?? "dev",
    docs: "https://github.com/mikelobato/qloudsound-api",
    hostname: new URL(request.url).hostname,
    region: request.cf?.colo ?? "unknown"
  });

const handleHealth = () =>
  toJSONResponse({
    status: "ok",
    timestamp: new Date().toISOString()
  });

const handlePublicSiteInfo = (request: Request, env: Env) =>
  toJSONResponse({
    service: "qloudsound-api:public-site",
    version: env.VERSION ?? "dev",
    submit: `${new URL(request.url).origin}${PUBLIC_SITE_PREFIX}/requests`
  });

const handlePublicSiteHealth = () =>
  toJSONResponse({
    status: "ok",
    scope: "public-site",
    timestamp: new Date().toISOString()
  });

const handlePublicRequestPost = async (request: Request, env: Env) => {
  const payload = (await parseJson<
    Partial<Record<keyof StoredRequest, string>> & { website?: string }
  >(request)) ?? {};

  const honeypot = (payload.website ?? "").trim();
  if (honeypot) {
    return toJSONResponse({ error: "invalid_submission" }, { status: 400 });
  }

  const name = (payload.name ?? "").trim();
  const email = (payload.email ?? "").trim();
  const style = (payload.style ?? "").trim();
  const description = (payload.description ?? "").trim();
  const filename = (payload.filename ?? "").trim();

  if (!name || !email || !style) {
    return toJSONResponse(
      { error: "missing_required_fields", message: "name, email and style are mandatory" },
      { status: 400 }
    );
  }

  const entry: StoredRequest = {
    id: crypto.randomUUID?.() ?? Date.now().toString(),
    name,
    email,
    style,
    description: description || undefined,
    filename: filename || undefined,
    createdAt: new Date().toISOString(),
    status: "pending"
  };

  try {
    await saveRequest(env, entry);
    await addCatalogEntry(env, {
      id: entry.id,
      title: `${entry.name} - ${entry.style}`,
      status: "requested",
      submittedAt: entry.createdAt
    });
  } catch (error) {
    console.error("D1 persist error", error);
    return toJSONResponse(
      {
        error: "storage_error",
        message: "No se pudo guardar la solicitud, intenta nuevamente."
      },
      { status: 500 }
    );
  }

  await notifyTelegram(env, entry, "Guardado en D1").catch((error) => {
    console.error("Telegram notify failed", error);
  });

  return toJSONResponse({ ok: true, id: entry.id });
};

const handleNotFound = (request: Request) =>
  toJSONResponse(
    {
      error: "not_found",
      message: `Route ${request.method} ${new URL(request.url).pathname} is not implemented`
    },
    { status: 404 }
  );

const matchesPath = (pathname: string, target: string) =>
  pathname === target || pathname === `${target}/`;

const router = async (request: Request, env: Env): Promise<Response> => {
  const { pathname } = new URL(request.url);

  if (matchesPath(pathname, "/") && request.method === "GET") {
    return handleRoot(request, env);
  }

  if (matchesPath(pathname, "/health") && request.method === "GET") {
    return handleHealth();
  }

  if (matchesPath(pathname, PUBLIC_SITE_PREFIX) && request.method === "GET") {
    return handlePublicSiteInfo(request, env);
  }

  if (matchesPath(pathname, `${PUBLIC_SITE_PREFIX}/health`) && request.method === "GET") {
    return handlePublicSiteHealth();
  }

  if (matchesPath(pathname, CATALOG_PATH) && request.method === "GET") {
    return handleCatalog(env);
  }

  if (matchesPath(pathname, `${PUBLIC_SITE_PREFIX}/requests`) && request.method === "POST") {
    return handlePublicRequestPost(request, env);
  }

  return handleNotFound(request);
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return handleOptions(request, env);
    }

    try {
      const response = await router(request, env);
      return applyCors(request, response, env);
    } catch (error) {
      console.error("Worker error", error);
      return applyCors(
        request,
        toJSONResponse(
          {
            error: "internal_error",
            message: error instanceof Error ? error.message : "Unexpected error"
          },
          { status: 500 }
        ),
        env
      );
    }
  }
};
const publishedTracks: CatalogEntry[] = [
  {
    id: "catalog-1",
    title: "Ginebra balla amb el sol",
    status: "published",
    isrc: "QT6EF2576934",
    upc: "199956616165",
    submittedAt: new Date().toISOString()
  },
  {
    id: "catalog-2",
    title: "Fuego Callejero",
    status: "published",
    isrc: "QT6EG2578923",
    upc: "199955965677",
    submittedAt: new Date().toISOString()
  },
  {
    id: "catalog-3",
    title: "Nos besamos y nos olvidamos",
    status: "published",
    isrc: "QT6EG2578924",
    upc: "199955965707",
    submittedAt: new Date().toISOString()
  },
  {
    id: "catalog-4",
    title: "Ya está bien",
    status: "published",
    isrc: "QT6EG2586747",
    upc: "199955961914",
    submittedAt: new Date().toISOString()
  },
  {
    id: "catalog-5",
    title: "Más pija que yo",
    status: "published",
    isrc: "QT6EG2586748",
    upc: "199955961921",
    submittedAt: new Date().toISOString()
  },
  {
    id: "catalog-6",
    title: "Ciego por tu luz",
    status: "published",
    isrc: "QT6ET2502320",
    upc: "199955955654",
    submittedAt: new Date().toISOString()
  }
];

const handleCatalog = async (env: Env) => {
  const entries = await listCatalogEntries(env, "published");
  return toJSONResponse({
    tracks: entries
  });
};
