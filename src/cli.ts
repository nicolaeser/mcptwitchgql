export function cliMode(argv: readonly string[]): "stdio" | "http" {
  return argv[0] === "http" || argv.includes("--http") ? "http" : "stdio";
}

export function wantsHelp(argv: readonly string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

export function tokenOnArgv(argv: readonly string[]): boolean {
  return argv.some((arg) => arg.startsWith("--token") || arg === "-t");
}

export const HELP = `mcptwitchgql

  mcptwitchgql         stdio
  mcptwitchgql http    Streamable HTTP at /mcp

HTTP defaults to OAuth. Public web Client-ID is built in. Optional: TWITCH_OAUTH_TOKEN, MCP_AUTH_PASSWORD.
`;
