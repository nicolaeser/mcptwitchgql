import { describe, expect, it } from "vitest";
import { collectLoginBag } from "../auth/fields.js";
import { loginFields, WEB_CLIENT_ID, twitchCreds } from "../auth/login-fields.js";
import { isAllowedRedirect } from "../auth/redirects.js";

describe("twitch login fields", () => {
  it("does not require OAuth or a client secret", () => {
    const names = loginFields().map((field) => field.name);
    expect(names).toEqual(["clientId", "oauthToken", "accountLabel"]);
    expect(loginFields().find((field) => field.name === "clientId")?.prompt).toBe("never");
    expect(loginFields().find((field) => field.name === "oauthToken")?.prompt).toBe("if-missing");
    const result = collectLoginBag(loginFields(), {}, {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.bag.secrets).toEqual({});
  });

  it("defaults to the public web Client-ID", () => {
    const creds = twitchCreds({ secrets: {}, claims: {} });
    expect(creds.clientId).toBe(WEB_CLIENT_ID);
  });

  it("does not treat MCP session tokens as Twitch OAuth", () => {
    const creds = twitchCreds({
      secrets: { oauthToken: "mcp1.not-a-twitch-token" },
      claims: {}
    });
    expect(creds.oauthToken).toBeUndefined();
  });
});

describe("redirect allowlist", () => {
  it("allows Grok, Cursor loopback, and the Cursor native callback", () => {
    expect(isAllowedRedirect("https://grok.com/connectors-oauth-exchange-code/")).toBe(true);
    expect(isAllowedRedirect("http://localhost:8787/callback")).toBe(true);
    expect(isAllowedRedirect("cursor://anysphere.cursor-mcp/oauth/callback")).toBe(true);
  });
});
