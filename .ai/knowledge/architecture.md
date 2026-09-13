# Architecture

Load this document when choosing which layer a change belongs in.

This package is a hostable MCP server for Twitch web GraphQL. Stdio is the local process transport.
HTTP is Streamable HTTP at `/mcp` plus OAuth at `/authorize`, `/token`, `/register`, and RFC 9728
metadata.

## Entry points

- `src/index.ts` — CLI: stdio by default, `http` for the listener.
- `src/http-main.ts` — HTTP process. Refuses tokens on argv.
- `src/transport/stdio.ts` — stdio MCP. Uses `TWITCH_*` env. Must not speak OAuth.
- `src/transport/http.ts` — Express app, Host allowlist, health.
- `src/transport/mcp-sessions.ts` — Streamable HTTP session table and sqlite restore.
- `src/auth/persist.ts` — durable OAuth clients, families, codes, CSRF.
- `src/lib/session-store.ts` — AES-GCM sqlite (`node:sqlite`, no extra package).
- `src/auth/routes.ts` — OAuth HTTP surface and consent POST.
- `src/mcp/server.ts` and `src/mcp/catalog.ts` — MCP server and tool catalog.
- `src/auth/login-fields.ts` — the only login-question customization point.
- `src/twitch/gql.ts` — `gql.twitch.tv/gql` and Usher. Axios. Inject `axiosInstance` in tests.

## Catalog

`tsup.config.ts` regenerates `src/mcp/catalog.ts` on build from `src/tools/*/index.ts`. Do not
edit the catalog by hand except to keep tests in sync before a build. Domain order is `twitch`.

Tools live in `src/tools/twitch/index.ts` and call `TwitchGql.fromBag`. GraphQL documents are
inline on the tool. Runtime `package.json#dependencies` are `@modelcontextprotocol/sdk`, `express`,
`zod`, and `axios`. Do not use `file:` workspace links.

## Facts that are easy to get wrong

- HTTP Bearer must be an `mcp1.` session token from this host. The Twitch OAuth token is not a
  connector credential.
- Tool handlers receive Twitch credentials from the sealed login bag, never from the client.
- The website Client-ID `kimne78kx3ncx6brgo4mv6wki5h1ko` has no secret. GQL reads work with only
  that ID. Optional `TWITCH_OAUTH_TOKEN` is only for personalized raw GQL. Tools that need
  Client-Integrity, Helix, or a logged-in user (following, polls, current user) are not in this
  package.
- Stdio fakes a local session token. Empty Twitch env is allowed; tools then use the public
  Client-ID.
- `src/upstream/client.ts` is the leftover Axios session client required by the MCP server factory.
  Twitch calls go through `src/twitch/gql.ts`.
