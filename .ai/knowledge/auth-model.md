# Auth model

Load this document when credentials, tokens, or connector clients change.

HTTP is OAuth 2.1 authorization code + S256 PKCE. Access and refresh tokens are HMAC-signed
`mcp1.` blobs. The login bag is encrypted into the token so Grok, Claude, and Codex never store
the upstream secret.

## Modes

Visible consent fields come from `visibleLoginFields` in `src/auth/service.ts`:

- No `MCP_AUTH_PASSWORD`: one consent page; each user must submit required login secrets.
- `MCP_AUTH_PASSWORD` plus env fallbacks: skip filled login fields; remaining questions then a
  separate **Server password** step.
- `MCP_AUTH_PASSWORD` without env fallbacks: login fields (**Continue**), then **Server password**
  (**Authorize**).

Stdio ignores OAuth and reads env. `MCP_AUTH=bearer` is not a supported mode.

## Token rules

- Authorization codes are single-use with a 5-minute TTL.
- Refresh tokens rotate; reuse of a previous `jti` revokes the family.
- Access tokens are audience-bound to this MCP origin + `/mcp`.
- Redirect URIs are allowlisted in `src/auth/redirects.ts` (HTTPS callback paths, loopback HTTP,
  Cursor `cursor:` callback).
- Dynamic clients are public (`token_endpoint_auth_method: none`) unless they register a secret.
- Clients, refresh families, CSRF nonces, authorization codes, and MCP session ids are written
  through `src/auth/persist.ts` and `src/transport/mcp-sessions.ts` into the encrypted sqlite
  store so a process restart does not require reconnect.
