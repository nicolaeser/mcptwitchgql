# mcptwitchgql

Twitch web GraphQL. Stdio or HTTP at `/mcp`.

```sh
mcptwitchgql
mcptwitchgql http
```

GQL uses Twitch’s public web Client-ID (`kimne78kx3ncx6brgo4mv6wki5h1ko`). That client has no secret. Reads work with only that ID. `twitch_gql` is the escape hatch.

Optional `TWITCH_OAUTH_TOKEN` for personalized GQL. Public reads work without it.

HTTP is OAuth. Secrets stay on this host.

Env: `TWITCH_OAUTH_TOKEN`, `TWITCH_CLIENT_ID`, `MCP_OAUTH_SECRET`, `MCP_PUBLIC_URL`, `MCP_AUTH_PASSWORD`.

`main` publishes GHCR `:latest`. `development` publishes `:dev`.

### Connection page

The consent page identifies the requesting application and explains this connector’s purpose.
Only account details needed for sign-in are shown upfront; optional settings expand on demand.
Server access, when required, is a separate step. Light and dark themes follow your device.
