import type { LoginField } from "./fields.js";

export const WEB_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";

export function loginFields(): readonly LoginField[] {
  return [
    {
      name: "clientId",
      label: "Twitch Client-ID",
      type: "text",
      required: false,
      secret: false,
      envFallback: "TWITCH_CLIENT_ID",
      prompt: "never",
      help: "Built-in public web Client-ID. Override only if you have your own app."
    },
    {
      name: "oauthToken",
      label: "Twitch user OAuth token",
      type: "password",
      required: false,
      secret: true,
      envFallback: "TWITCH_OAUTH_TOKEN",
      prompt: "if-missing",
      autocomplete: "new-password",
      help: "Optional user token for personalized GQL. Public reads work without it."
    },
    {
      name: "accountLabel",
      prompt: "never",
      label: "Account label",
      type: "text",
      required: false,
      secret: false
    }
  ];
}

export function apiTokenFromBag(
  bag: { readonly secrets: Readonly<Record<string, string>>; readonly claims?: Readonly<Record<string, string>> },
  envToken: string | undefined
): string | undefined {
  const oauth = bag.secrets.oauthToken?.trim() || envToken?.trim();
  if (oauth !== undefined && oauth.length > 0) return oauth;
  return undefined;
}

export function twitchCreds(bag: {
  readonly secrets: Readonly<Record<string, string>>;
  readonly claims: Readonly<Record<string, string>>;
}): { clientId: string; oauthToken?: string } {
  const clientId = bag.claims.clientId?.trim() || WEB_CLIENT_ID;
  const oauthToken = twitchUserToken(bag.secrets.oauthToken);
  return {
    clientId: clientId.length > 0 ? clientId : WEB_CLIENT_ID,
    ...(oauthToken === undefined ? {} : { oauthToken })
  };
}

function twitchUserToken(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const token = value.replace(/^oauth:/i, "").trim();
  if (token.length < 16) return undefined;
  if (token.startsWith("mcp1.")) return undefined;
  if (token === "gql" || token === "local") return undefined;
  return token;
}
