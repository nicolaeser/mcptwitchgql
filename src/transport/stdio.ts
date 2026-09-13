import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readRuntimeConfig } from "../config.js";
import { createMcpServer } from "../mcp/server.js";
import { defaultClientFactory } from "../upstream/client.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../version.js";

export interface StdioRunOptions {
  readonly env?: NodeJS.ProcessEnv;
}

export async function runStdio(options: StdioRunOptions = {}): Promise<void> {
  const env = options.env ?? process.env;
  const config = readRuntimeConfig(env);
  const oauth = config.apiToken ?? env.TWITCH_OAUTH_TOKEN;
  const clientId = env.TWITCH_CLIENT_ID;
  const server = createMcpServer({
    createClient: defaultClientFactory,
    getToken: () => oauth ?? clientId ?? "gql",
    getBag: () => ({
      secrets: {
        ...(oauth !== undefined && oauth.length > 0 ? { oauthToken: oauth } : {})
      },
      claims: {
        ...(clientId !== undefined && clientId.length > 0 ? { clientId } : {})
      }
    })
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`${PACKAGE_NAME}/${PACKAGE_VERSION} listening on stdio\n`);
}
