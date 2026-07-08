// Google Calendar via OAuth 2.0 (loopback + PKCE, the flow Google documents
// for installed/desktop apps). Requires a Desktop-app OAuth client (Client
// ID + Secret) from Google Cloud Console, stored in config.json. Tokens are
// cached in Electron's userData dir — never in git, never in config.json —
// and refreshed silently once a refresh token exists.

import { app, shell } from "electron";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  GoogleCalendarConfig,
  CalendarEvent,
  CalendarResult,
  ActionResult,
} from "../../shared/types";

const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

interface TokenCache {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

function tokenCachePath(): string {
  return path.join(app.getPath("userData"), "google-tokens.json");
}

function readTokenCache(): TokenCache | null {
  try {
    return JSON.parse(fs.readFileSync(tokenCachePath(), "utf8"));
  } catch {
    return null;
  }
}

function writeTokenCache(cache: TokenCache): void {
  fs.writeFileSync(tokenCachePath(), JSON.stringify(cache, null, 2));
}

function todayDateString(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function generatePkce() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function exchangeCodeForTokens(
  config: GoogleCalendarConfig,
  code: string,
  verifier: string,
  redirectUri: string
): Promise<TokenCache> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status})`);
  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

async function refreshAccessToken(
  config: GoogleCalendarConfig,
  refreshToken: string
): Promise<TokenCache> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed (${res.status})`);
  const data = await res.json();
  return {
    accessToken: data.access_token,
    // Google doesn't always resend a refresh_token on refresh — keep the old one.
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

// Opens the system browser for one-time consent, catches the redirect on a
// temporary loopback server, and exchanges the code for tokens.
function runOAuthFlow(config: GoogleCalendarConfig): Promise<ActionResult> {
  return new Promise((resolve) => {
    const { verifier, challenge } = generatePkce();
    let settled = false;
    let redirectUri = "";

    function finish(result: ActionResult) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.close();
      resolve(result);
    }

    const timeout = setTimeout(() => {
      finish({ ok: false, reason: "Authorization timed out" });
    }, 5 * 60 * 1000);

    const server = http.createServer(async (req, res) => {
      if (!req.url) return;
      const reqUrl = new URL(req.url, redirectUri || "http://127.0.0.1");
      const code = reqUrl.searchParams.get("code");
      const error = reqUrl.searchParams.get("error");

      res.setHeader("Content-Type", "text/html");
      if (error) {
        res.end("<h1>Authorization denied</h1><p>You can close this window.</p>");
        finish({ ok: false, reason: "Authorization was denied" });
        return;
      }
      if (!code) {
        res.end("Waiting for authorization...");
        return;
      }

      res.end(
        "<h1>Connected</h1><p>You can close this window and return to Command Center.</p>"
      );
      try {
        const tokens = await exchangeCodeForTokens(config, code, verifier, redirectUri);
        writeTokenCache(tokens);
        finish({ ok: true });
      } catch (err) {
        finish({ ok: false, reason: (err as Error).message });
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        finish({ ok: false, reason: "Couldn't start local server" });
        return;
      }
      redirectUri = `http://127.0.0.1:${address.port}`;

      const authUrl = new URL(AUTH_ENDPOINT);
      authUrl.searchParams.set("client_id", config.clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", SCOPE);
      authUrl.searchParams.set("code_challenge", challenge);
      authUrl.searchParams.set("code_challenge_method", "S256");
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");
      shell.openExternal(authUrl.toString());
    });
  });
}

async function getValidAccessToken(config: GoogleCalendarConfig): Promise<string | null> {
  const cache = readTokenCache();
  if (!cache) return null;
  if (cache.expiresAt - Date.now() > 60_000) return cache.accessToken;

  try {
    const refreshed = await refreshAccessToken(config, cache.refreshToken);
    writeTokenCache(refreshed);
    return refreshed.accessToken;
  } catch {
    return null;
  }
}

export async function connectGoogleCalendar(
  config: GoogleCalendarConfig
): Promise<ActionResult> {
  if (!config.clientId || !config.clientSecret) {
    return { ok: false, reason: "Add a Google Cloud OAuth client ID/secret to config.json first" };
  }
  return runOAuthFlow(config);
}

export async function getEventsForDay(
  config: GoogleCalendarConfig,
  dateStr?: string
): Promise<CalendarResult> {
  const date = dateStr || todayDateString();

  if (!config.clientId || !config.clientSecret) {
    return {
      ok: false,
      reason: "Google Calendar isn't configured",
      needsAuth: true,
      events: [],
      date,
    };
  }

  const accessToken = await getValidAccessToken(config);
  if (!accessToken) {
    return {
      ok: false,
      reason: "Connect Google Calendar to see your schedule",
      needsAuth: true,
      events: [],
      date,
    };
  }

  const [y, m, d] = date.split("-").map(Number);
  const timeMin = new Date(y, m - 1, d, 0, 0, 0).toISOString();
  const timeMax = new Date(y, m - 1, d, 23, 59, 59).toISOString();

  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("timeMin", timeMin);
  url.searchParams.set("timeMax", timeMax);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");

  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch {
    return { ok: false, reason: "Couldn't reach Google Calendar", events: [], date };
  }

  if (!res.ok) {
    return {
      ok: false,
      reason:
        res.status === 401
          ? "Google Calendar access expired — reconnect"
          : "Google Calendar request failed",
      needsAuth: res.status === 401,
      events: [],
      date,
    };
  }

  const data = await res.json();
  const events: CalendarEvent[] = (data.items || []).map((item: any) => {
    const meetingUrl =
      item.hangoutLink ||
      item.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === "video")?.uri ||
      (item.location && isValidHttpUrl(item.location) ? item.location : null) ||
      null;

    return {
      id: item.id,
      summary: item.summary || "(No title)",
      start: item.start?.dateTime || item.start?.date || "",
      end: item.end?.dateTime || item.end?.date || "",
      allDay: !!item.start?.date,
      location: item.location || null,
      meetingUrl,
      description: item.description || "",
      htmlLink: item.htmlLink,
    };
  });

  return { ok: true, events, date };
}
