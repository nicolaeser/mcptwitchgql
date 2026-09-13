---
type: instruction
description: Governs validation; load for code, tests, or builds.
scope: repository
---

# Quality and testing

## Scope and activation

This Instruction must be loaded for every implementation change and whenever tests or builds
are modified.

## Mandatory rules

- Validation must be proportional to risk and must exercise the public or wire-visible behavior
  affected by the change. A bug fix must include a regression test at the narrowest stable layer.
- Source and test code must continue to pass the strict compiler settings in `tsconfig.json`.
- Runtime tests in the default suite must be deterministic, make no live upstream requests, and
  require no real credentials.
- Test fixtures, diagnostics, and logs must not contain real tokens, passwords, or production
  data.
- A check must be reported as passing only when it was run successfully in the current workspace;
  otherwise report it as not run or blocked, with the reason.
- Validate with `npm run typecheck`, `npm test`, and `npm run build`. `src/mcp/catalog.ts` is generated at build from `src/tools`.

## Sources of truth

- Commands: `package.json#scripts`.
- Compiler: `tsconfig.json`.
- HTTP OAuth contract: `src/tests/oauth.test.ts`.
- Production fail-closed config: `src/tests/config.production.test.ts`.
