// Edge Function: freebusy
// Returns Google Calendar free/busy windows for a set of staff emails.
//
// Security:
//   - Deployed with JWT verification ON, so only a signed-in admin (a valid
//     Supabase user token) can call it.
//   - The Google service-account key never leaves the server; it's read from
//     the Edge Function secret store, never sent to the browser.
//
// Required secrets (set with `supabase secrets set …`):
//   GOOGLE_SERVICE_ACCOUNT      full service-account JSON (as a string)
//   GOOGLE_IMPERSONATE_SUBJECT  a Workspace user email to impersonate
//
// Request  (POST JSON):  { emails: string[], timeMin: ISO, timeMax: ISO }
// Response (JSON):       { calendars: { [email]: { busy:[{start,end}], errors:[] } } }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// base64url helpers
function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlStr(s: string): string {
  return b64url(new TextEncoder().encode(s));
}

// PEM (PKCS#8) private key -> ArrayBuffer for Web Crypto import
function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

// Mint a Google OAuth access token via the service-account JWT-bearer flow,
// impersonating `subject` (domain-wide delegation), scoped to free/busy only.
async function getAccessToken(sa: any, subject: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    sub: subject,
    scope: SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64urlStr(JSON.stringify(header))}.${b64urlStr(JSON.stringify(claims))}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)),
  );
  const assertion = `${unsigned}.${b64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`token: ${data.error_description || data.error || res.status}`);
  return data.access_token;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { emails, timeMin, timeMax } = await req.json().catch(() => ({}));
    if (!Array.isArray(emails) || emails.length === 0 || !timeMin || !timeMax) {
      return json({ error: "Provide emails[] (non-empty), timeMin, timeMax (ISO 8601)." }, 400);
    }
    if (emails.length > 50) return json({ error: "Max 50 emails per request." }, 400);

    const saRaw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT");
    const subject = Deno.env.get("GOOGLE_IMPERSONATE_SUBJECT");
    if (!saRaw || !subject) {
      return json({ error: "Server not configured (missing GOOGLE_SERVICE_ACCOUNT / GOOGLE_IMPERSONATE_SUBJECT)." }, 500);
    }
    let sa: any;
    try { sa = JSON.parse(saRaw); } catch { return json({ error: "GOOGLE_SERVICE_ACCOUNT is not valid JSON." }, 500); }

    const token = await getAccessToken(sa, subject);

    const fbRes = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ timeMin, timeMax, items: emails.map((e: string) => ({ id: e })) }),
    });
    const fb = await fbRes.json();
    if (!fbRes.ok) return json({ error: `freebusy: ${fb.error?.message || fbRes.status}` }, 502);

    // Normalize to { email: { busy:[{start,end}], errors:[…] } }
    const calendars: Record<string, { busy: unknown[]; errors: unknown[] }> = {};
    for (const [email, cal] of Object.entries<any>(fb.calendars || {})) {
      calendars[email] = { busy: cal.busy || [], errors: cal.errors || [] };
    }
    return json({ calendars });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
