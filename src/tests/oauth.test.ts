import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createHttpApp, listenHttp } from "../transport/http.js";
import { MCP_PATH } from "../config.js";
import { closeSessionStore } from "../lib/session-store.js";
import { signCsrf } from "../auth/crypto.js";
import {
  CONSENT_CSP,
  CONSENT_ERROR_GENERIC,
  CONSENT_ERROR_SESSION_EXPIRED
} from "../auth/consent.js";
import { PACKAGE_PRODUCT } from "../version.js";

const OAUTH_SECRET = "test-oauth-secret-value-32chars-min";
const OPERATOR_PASSWORD = "operator-pass-12";
const UPSTREAM = "sk_live_upstream_secret_value";
const REDIRECT = "https://client.example/oauth/callback";

describe("fail-closed HTTP credentials", () => {
  it("defaults unset MCP_AUTH to oauth and rejects a stolen upstream Bearer", async () => {
    const ctx = await startOauth();
    try {
      const health = await fetch(`${ctx.origin}/health`);
      expect(health.status).toBe(200);
      expect(((await health.json()) as { auth: string }).auth).toBe("oauth");

      const missing = await fetch(ctx.mcp, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: initParams() })
      });
      expect(missing.status).toBe(401);
      const www = missing.headers.get("www-authenticate") ?? "";
      expect(www).toMatch(/resource_metadata=/);
      expect(www).toMatch(/scope="mcp:tools"/);
      expect(www).not.toMatch(/charset=/);
      expect(missing.headers.get("access-control-expose-headers") ?? "").toMatch(/WWW-Authenticate/i);

      const options = await fetch(ctx.mcp, { method: "OPTIONS" });
      expect(options.status).toBe(204);
      expect(options.headers.get("access-control-allow-origin")).toBe("*");

      const stolen = await fetch(ctx.mcp, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${UPSTREAM}`
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
      });
      expect(stolen.status).toBe(401);
    } finally {
      await ctx.close();
    }
  });

});

describe("public origin host", () => {
  it("accepts the public tunnel Host while bound to loopback", async () => {
    const publicUrl = "https://example-tunnel.trycloudflare.com";
    const app = createHttpApp({
      env: { MCP_HOST: "127.0.0.1", MCP_PUBLIC_URL: publicUrl }
    });
    const server = await listenHttp(app, { host: "127.0.0.1", port: 0 });
    try {
      const port = (server.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${port}${MCP_PATH}`, {
        method: "POST",
        headers: {
          host: "example-tunnel.trycloudflare.com",
          "content-type": "application/json",
          accept: "application/json, text/event-stream"
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: initParams() })
      });
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate") ?? "").toContain(publicUrl);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("rejects an unexpected Host when bound on all interfaces", async () => {
    const publicUrl = "https://mcp.example";
    const app = createHttpApp({
      env: {
        MCP_HOST: "0.0.0.0",
        MCP_OAUTH_SECRET: OAUTH_SECRET,
        MCP_AUTH_PASSWORD: OPERATOR_PASSWORD,
        MCP_PUBLIC_URL: publicUrl
      },
      sessionStorePath: ""
    });
    const server = await listenHttp(app, { host: "127.0.0.1", port: 0 });
    try {
      const port = (server.address() as AddressInfo).port;
      const evil = await postWithHost(port, "evil.example");
      expect(evil).toBe(421);
      const okHost = await postWithHost(port, "mcp.example");
      expect(okHost).toBe(401);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});

describe("OAuth login fields", () => {
  it("rejects the upstream API token as a Bearer and requires the operator password", async () => {
    const ctx = await startOauth();
    try {
      const missing = await fetch(ctx.mcp, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: initParams() })
      });
      expect(missing.status).toBe(401);
      expect(missing.headers.get("www-authenticate") ?? "").toMatch(/resource_metadata=/);

      const stolen = await fetch(ctx.mcp, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${UPSTREAM}`
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
      });
      expect(stolen.status).toBe(401);
    } finally {
      await ctx.close();
    }
  });

  it("collects extra login fields into the session", async () => {
    const ctx = await startOauth();
    try {
      const tokens = await loginForTokens(ctx, {
        password: OPERATOR_PASSWORD,
        accountLabel: "prod"
      });
      expect(tokens.access_token.startsWith("mcp1.")).toBe(true);

      const called = await fetch(ctx.mcp, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${tokens.access_token}`
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "twitch_whoami", arguments: {} }
        })
      });
      expect(called.status).toBe(200);
      const raw = await called.text();
      expect(raw).toContain("prod");
      expect(raw).toContain("kimne78kx3ncx6brgo4mv6wki5h1ko");
    } finally {
      await ctx.close();
    }
  });

  it("hides clientId when TWITCH_CLIENT_ID is set", async () => {
    const ctx = await startOauth({
      env: {
        MCP_HOST: "127.0.0.1",
        MCP_OAUTH_SECRET: OAUTH_SECRET,
        MCP_AUTH_PASSWORD: OPERATOR_PASSWORD,
        TWITCH_CLIENT_ID: "kd1unb4b3q4t58fwlpcbzcbnm76a8fp"
      }
    });
    try {
      const session = await beginAuthorize(ctx);
      expect(session.html).not.toContain('name="login_clientId"');
      expect(session.html).toContain("Authorize");
      expect(session.html).toContain('name="operator_password"');
      expect(session.html).not.toContain("MCP_AUTH_PASSWORD");
      expect(session.html).toContain("prefers-color-scheme");
      expect(session.html).toContain('action=""');
      expect(session.html).toMatch(/type="submit"/);
      expect(session.html).not.toMatch(/<button[^>]*disabled/);
      expect(session.html).not.toMatch(/sevdesk/i);
      expect(session.csrf.startsWith("csrf1.")).toBe(true);

      const consented = await postConsent(ctx, session, {
        password: OPERATOR_PASSWORD,
        cookie: false
      });
      expect(consented.status).toBe(302);
      expect(consented.headers.get("location") ?? "").toContain("code=");
    } finally {
      await ctx.close();
    }
  });
});

describe("consent CSRF", () => {
  it("authorizes without a cookie when the body CSRF is valid and Origin is missing", async () => {
    const ctx = await startOauth();
    try {
      const session = await beginAuthorize(ctx);
      const consented = await postConsent(ctx, session, {
        password: OPERATOR_PASSWORD,
                cookie: false
      });
      expect(consented.status).toBe(302);
      expect(consented.headers.get("location") ?? "").toContain("code=");
    } finally {
      await ctx.close();
    }
  });

  it("authorizes without a cookie when Origin is null", async () => {
    const ctx = await startOauth();
    try {
      const session = await beginAuthorize(ctx);
      const consented = await postConsent(ctx, session, {
        password: OPERATOR_PASSWORD,
                cookie: false,
        origin: "null"
      });
      expect(consented.status).toBe(302);
    } finally {
      await ctx.close();
    }
  });

  it("authorizes without a cookie when Origin matches the public origin", async () => {
    const ctx = await startOauth();
    try {
      const session = await beginAuthorize(ctx);
      const consented = await postConsent(ctx, session, {
        password: OPERATOR_PASSWORD,
                cookie: false,
        origin: ctx.origin
      });
      expect(consented.status).toBe(302);
    } finally {
      await ctx.close();
    }
  });

  it("authorizes GET-twice using the first HTML csrf and the second Set-Cookie", async () => {
    const ctx = await startOauth();
    try {
      const clientId = await register(ctx);
      const pkce = makePkce();
      const url = authorizeUrl(ctx, clientId, pkce.challenge);
      const first = await fetch(url);
      const firstHtml = await first.text();
      const firstCsrf = hiddenFields(firstHtml).csrf ?? "";
      const second = await fetch(url);
      const secondCookie = firstCookiePair(second);
      const consented = await fetch(`${ctx.origin}/authorize`, {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: secondCookie
        },
        body: new URLSearchParams({
          ...hiddenFields(firstHtml),
          consent: "1",
          csrf: firstCsrf,
          operator_password: OPERATOR_PASSWORD
        })
      });
      expect(consented.status).toBe(302);
      expect(consented.headers.get("location") ?? "").toContain("code=");
    } finally {
      await ctx.close();
    }
  });

  it("replays a used CSRF with the same unused code, then expires after exchange", async () => {
    const ctx = await startOauth();
    try {
      const session = await beginAuthorize(ctx);
      const first = await postConsent(ctx, session, {
        password: OPERATOR_PASSWORD,
                cookie: false
      });
      expect(first.status).toBe(302);
      const location = first.headers.get("location") ?? "";
      expect(location).toContain("code=");
      const replay = await postConsent(ctx, session, {
        password: OPERATOR_PASSWORD,
                cookie: false
      });
      expect(replay.status).toBe(302);
      expect(replay.headers.get("location")).toBe(location);
      const code = new URL(location).searchParams.get("code") ?? "";
      const tokens = await fetch(`${ctx.origin}/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          code_verifier: session.hidden.challenge_verifier ?? "",
          client_id: session.hidden.client_id ?? "",
          redirect_uri: REDIRECT
        })
      });
      expect(tokens.status).toBe(200);
      const afterExchange = await postConsent(ctx, session, {
        password: OPERATOR_PASSWORD,
                cookie: false
      });
      expect(afterExchange.status).toBe(401);
      const html = await afterExchange.text();
      expect(html).toContain(CONSENT_ERROR_SESSION_EXPIRED);
    } finally {
      await ctx.close();
    }
  });

  it("rejects a broken HMAC body CSRF as session-expired", async () => {
    const ctx = await startOauth();
    try {
      const session = await beginAuthorize(ctx);
      const consented = await postConsent(
        ctx,
        { ...session, csrf: "csrf1.not-a-valid-payload.not-a-valid-mac" },
        {
          password: OPERATOR_PASSWORD,
                    cookie: false
        }
      );
      expect(consented.status).toBe(401);
      const html = await consented.text();
      expect(html).toContain(CONSENT_ERROR_SESSION_EXPIRED);
    } finally {
      await ctx.close();
    }
  });

  it("reuses the same CSRF after a wrong password so retry succeeds", async () => {
    const ctx = await startOauth();
    try {
      const session = await beginAuthorize(ctx);
      const denied = await postConsent(ctx, session, {
        password: "wrong-password-12",
                cookie: false
      });
      expect(denied.status).toBe(401);
      const deniedHtml = await denied.text();
      expect(deniedHtml).toContain(CONSENT_ERROR_GENERIC);
      expect(hiddenFields(deniedHtml).csrf).toBe(session.csrf);

      const retry = await postConsent(ctx, session, {
        password: OPERATOR_PASSWORD,
                cookie: false
      });
      expect(retry.status).toBe(302);
      expect(retry.headers.get("location") ?? "").toContain("code=");
    } finally {
      await ctx.close();
    }
  });

  it("rejects an expired CSRF body as session-expired", async () => {
    const ctx = await startOauth();
    try {
      const session = await beginAuthorize(ctx);
      const expired = mintCsrf({
        n: "expired-nonce",
        exp: Date.now() - 1000,
        cid: session.hidden.client_id ?? "",
        ru: session.hidden.redirect_uri ?? REDIRECT,
        ch: session.hidden.code_challenge ?? ""
      });
      const consented = await postConsent(ctx, { ...session, csrf: expired }, {
        password: OPERATOR_PASSWORD,
                cookie: false
      });
      expect(consented.status).toBe(401);
      expect(await consented.text()).toContain(CONSENT_ERROR_SESSION_EXPIRED);
    } finally {
      await ctx.close();
    }
  });
});

describe("login modes and session cap", () => {
  it("public mode: no password required", async () => {
    const ctx = await startOauth({ env: { MCP_AUTH_PASSWORD: "" } });
    try {
      const session = await beginAuthorize(ctx);
      expect(session.html).toContain("Authorize");
      expect(session.html).not.toContain("MCP_AUTH_PASSWORD");
      expect(session.html).not.toMatch(/>Password</);
      expect(session.html).not.toContain('name="operator_password"');
      const tokens = await loginForTokens(ctx, { password: "" });
      expect(tokens.access_token.startsWith("mcp1.")).toBe(true);
      const called = await fetch(ctx.mcp, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${tokens.access_token}`
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "twitch_whoami", arguments: {} }
        })
      });
      expect(called.status).toBe(200);
      expect(await called.text()).not.toContain(UPSTREAM);
    } finally {
      await ctx.close();
    }
  });

  it("gated mode: operator password is enough", async () => {
    const ctx = await startOauth();
    try {
      const session = await beginAuthorize(ctx);
      expect(session.html).toContain("Authorize");
      expect(session.html).not.toContain('name="login_apiToken"');
      expect(session.html).toContain('name="operator_password"');
      const denied = await postConsent(ctx, session, { password: "", cookie: false });
      expect(denied.status).toBe(401);
      const ok = await postConsent(ctx, session, {
        password: OPERATOR_PASSWORD,
        cookie: false
      });
      expect(ok.status).toBe(302);
      expect(ok.headers.get("location") ?? "").toContain("code=");
    } finally {
      await ctx.close();
    }
  });

  it("public mode authorizes without extra secrets", async () => {
    const ctx = await startOauth({
      env: { MCP_AUTH_PASSWORD: "" }
    });
    try {
      const session = await beginAuthorize(ctx);
      expect(session.html).not.toContain('name="login_apiToken"');
      expect(session.html).not.toMatch(/>Password</);
      expect(session.html).not.toContain('name="operator_password"');
      const tokens = await loginForTokens(ctx, { password: "" });
      expect(tokens.access_token.startsWith("mcp1.")).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  it("rejects missing password when MCP_AUTH_PASSWORD is set", async () => {
    const ctx = await startOauth();
    try {
      const session = await beginAuthorize(ctx);
      expect(session.html).toContain("Authorize");
      expect(session.html).toContain("test-grok");
      expect(session.html).toContain('name="operator_password"');
      const denied = await postConsent(ctx, session, { password: "", cookie: false });
      expect(denied.status).toBe(401);
      const ok = await postConsent(ctx, session, {
        password: OPERATOR_PASSWORD,
                cookie: false
      });
      expect(ok.status).toBe(302);
      expect(ok.headers.get("location") ?? "").toContain("code=");
    } finally {
      await ctx.close();
    }
  });

  it("recovers OAuth and MCP sessions from sqlite after the process is replaced", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcptwitchgql-sessions-"));
    const store = join(dir, "sessions.sqlite");
    const env: NodeJS.ProcessEnv = {
      MCP_HOST: "127.0.0.1",
      MCP_OAUTH_SECRET: OAUTH_SECRET,
      MCP_AUTH_PASSWORD: OPERATOR_PASSWORD
    };
    const first = await startOauth({ env, sessionStorePath: store });
    try {
      const issued = await loginForTokens(first, { password: OPERATOR_PASSWORD });
      const init = await fetch(first.mcp, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${issued.access_token}`
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: initParams() })
      });
      expect(init.status).toBe(200);
      const sessionId = init.headers.get("mcp-session-id");
      expect(sessionId).toBeTruthy();
      await first.close();
      closeSessionStore(store);

      const second = await startOauth({ env, sessionStorePath: store });
      try {
        const clientId = issued.client_id;
        const refreshed = await fetch(`${second.origin}/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: issued.refresh_token,
            client_id: clientId
          })
        });
        expect(refreshed.status).toBe(200);
        const next = (await refreshed.json()) as { access_token: string };
        const called = await fetch(second.mcp, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            authorization: `Bearer ${issued.access_token}`,
            "mcp-session-id": sessionId ?? "",
            "mcp-protocol-version": "2025-03-26"
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: { name: "twitch_whoami", arguments: {} }
          })
        });
        expect(called.status).toBe(200);
        expect(await called.text()).not.toContain(UPSTREAM);
        expect(next.access_token.startsWith("mcp1.")).toBe(true);
      } finally {
        await second.close();
      }
    } finally {
      closeSessionStore(store);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("caps concurrent MCP sessions with MAX_SESSIONS", async () => {
    const ctx = await startOauth({ env: { MAX_SESSIONS: "1" } });
    try {
      const tokens = await loginForTokens(ctx, { password: OPERATOR_PASSWORD });
      const init = {
        jsonrpc: "2.0",
        method: "initialize",
        params: initParams()
      };
      const first = await fetch(ctx.mcp, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${tokens.access_token}`
        },
        body: JSON.stringify({ ...init, id: 1 })
      });
      expect(first.status).toBe(200);
      const second = await fetch(ctx.mcp, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${tokens.access_token}`
        },
        body: JSON.stringify({ ...init, id: 2 })
      });
      expect(second.status).toBe(429);
    } finally {
      await ctx.close();
    }
  });
});

interface OauthCtx {
  readonly origin: string;
  readonly mcp: string;
  close: () => Promise<void>;
}

interface AuthorizeSession {
  readonly html: string;
  readonly csrf: string;
  readonly cookie: string;
  readonly hidden: Record<string, string>;
}

function postWithHost(port: number, hostHeader: string): Promise<number> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: initParams() });
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: MCP_PATH,
        method: "POST",
        headers: {
          host: hostHeader,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "content-length": Buffer.byteLength(body)
        }
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      }
    );
    req.on("error", reject);
    req.end(body);
  });
}

async function startOauth(
  options: { env?: NodeJS.ProcessEnv; sessionStorePath?: string } = {}
): Promise<OauthCtx> {
  const dir = mkdtempSync(join(tmpdir(), "mcptwitchgql-oauth-"));
  const store = options.sessionStorePath ?? join(dir, "sessions.sqlite");
  const env: NodeJS.ProcessEnv = {
    MCP_HOST: "127.0.0.1",
    MCP_OAUTH_SECRET: OAUTH_SECRET,
    MCP_AUTH_PASSWORD: OPERATOR_PASSWORD,
    ...options.env
  };
  const app = createHttpApp({ env, sessionStorePath: store });
  const server = await listenHttp(app, { host: "127.0.0.1", port: 0 });
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  return {
    origin,
    mcp: `${origin}${MCP_PATH}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((err) => {
          closeSessionStore(store);
          rmSync(dir, { recursive: true, force: true });
          if (err) reject(err);
          else resolve();
        })
      )
  };
}

async function loginForTokens(
  ctx: OauthCtx,
  input: { password: string; accountLabel?: string; clientId?: string }
): Promise<{ access_token: string; refresh_token: string; client_id: string }> {
  const session = await beginAuthorize(ctx);
  expect(session.html).toContain("Authorize");
  const consented = await postConsent(ctx, session, {
    password: input.password,
    ...(input.accountLabel === undefined ? {} : { accountLabel: input.accountLabel }),
    ...(input.clientId === undefined ? {} : { clientId: input.clientId })
  });
  expect(consented.status, await consented.text()).toBe(302);
  const code = new URL(consented.headers.get("location") ?? "http://local").searchParams.get("code");
  const tokens = await fetch(`${ctx.origin}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code ?? "",
      code_verifier: session.hidden.challenge_verifier ?? "",
      client_id: session.hidden.client_id ?? "",
      redirect_uri: REDIRECT
    })
  });
  expect(tokens.status).toBe(200);
  const body = (await tokens.json()) as { access_token: string; refresh_token: string };
  return { ...body, client_id: session.hidden.client_id ?? "" };
}

async function beginAuthorize(ctx: OauthCtx): Promise<AuthorizeSession> {
  const clientId = await register(ctx);
  const pkce = makePkce();
  const page = await fetch(authorizeUrl(ctx, clientId, pkce.challenge));
  const html = await page.text();
  expect(page.headers.get("content-security-policy") ?? "").toBe(CONSENT_CSP);
  expect(html).toContain("Connecting…");
  expect(html).toContain("Authorize");
  expect(html).not.toContain("Cursor");
  expect(html).not.toContain("<!--slot:");
  expect(html).toContain(`<title>${PACKAGE_PRODUCT}</title>`);
  const hidden = hiddenFields(html);
  return {
    html,
    csrf: hidden.csrf ?? "",
    cookie: firstCookiePair(page),
    hidden: { ...hidden, challenge_verifier: pkce.verifier, client_id: clientId }
  };
}

async function postConsent(
  ctx: OauthCtx,
  session: AuthorizeSession,
  input: {
    password: string;
    accountLabel?: string;
    clientId?: string;
    cookie?: boolean | string;
    origin?: string;
  }
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (input.cookie !== false) {
    headers.cookie = typeof input.cookie === "string" ? input.cookie : session.cookie;
  }
  if (input.origin !== undefined) headers.origin = input.origin;
  const body: Record<string, string> = {
    ...session.hidden,
    consent: "1",
    csrf: session.csrf,
    operator_password: input.password
  };
  delete body.challenge_verifier;
  if (input.accountLabel !== undefined) body.login_accountLabel = input.accountLabel;
  if (input.clientId !== undefined) body.login_clientId = input.clientId;
  return fetch(`${ctx.origin}/authorize`, {
    method: "POST",
    redirect: "manual",
    headers,
    body: new URLSearchParams(body)
  });
}

async function register(ctx: OauthCtx): Promise<string> {
  const registerRes = await fetch(`${ctx.origin}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "test-grok",
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"]
    })
  });
  return ((await registerRes.json()) as { client_id: string }).client_id;
}

function authorizeUrl(ctx: OauthCtx, clientId: string, challenge: string): URL {
  const url = new URL(`${ctx.origin}/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", REDIRECT);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("scope", "mcp:tools");
  url.searchParams.set("state", "state-1");
  return url;
}

function makePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

function hiddenFields(html: string): Record<string, string> {
  const hidden: Record<string, string> = {};
  const re = /<input type="hidden" name="([^"]+)" value="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    if (match[1] !== undefined && match[2] !== undefined) hidden[match[1]] = match[2];
  }
  return hidden;
}

function firstCookiePair(res: Response): string {
  const cookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const raw = cookies[0] ?? res.headers.get("set-cookie") ?? "";
  return raw.split(";")[0] ?? "";
}

function mintCsrf(payload: { n: string; exp: number; cid: string; ru: string; ch?: string }): string {
  const encoded = Buffer.from(JSON.stringify({ v: 1, ...payload }), "utf8").toString("base64url");
  const mac = signCsrf(OAUTH_SECRET, `csrf1.${encoded}`);
  return `csrf1.${encoded}.${mac}`;
}

function initParams() {
  return {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "mcptwitchgql-probe", version: "0.0.1" }
  };
}
