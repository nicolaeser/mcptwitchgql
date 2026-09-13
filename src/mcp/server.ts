import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MissingTokenError } from "../errors.js";
import { toolError } from "./format.js";
import { TOOL_CATALOG } from "./catalog.js";
import type { LoginBag } from "../auth/fields.js";
import type { ToolContext, UpstreamClientFactory } from "../types.js";
import { defaultClientFactory } from "../upstream/client.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../version.js";

export interface McpServerOptions {
  readonly getToken: () => string | undefined;
  readonly getBag?: () => LoginBag;
  readonly createClient?: UpstreamClientFactory;
  readonly baseURL?: string;
}

export function createMcpServer(options: McpServerOptions): McpServer {
  const server = new McpServer(
    { name: PACKAGE_NAME, version: PACKAGE_VERSION },
    { capabilities: { tools: {} } }
  );

  for (const entry of TOOL_CATALOG) {
    const config = {
      title: entry.title,
      description: entry.description,
      inputSchema: schemaShape(entry.inputSchema),
      annotations: entry.annotations
    };
    const callback = async (args: Record<string, unknown> | undefined) => {
      let ctx: ToolContext | undefined;
      try {
        ctx = createToolContext(options);
        return await entry.handler(ctx, args ?? {});
      } catch (error) {
        return toolError(error, ctx?.secrets ?? []);
      } finally {
        ctx?.client.dispose();
      }
    };
    server.registerTool(entry.name, config, callback as never);
  }

  return server;
}

function createToolContext(options: McpServerOptions): ToolContext {
  const token = options.getToken();
  if (token === undefined || token.length === 0) {
    throw new MissingTokenError();
  }
  const bag = options.getBag?.() ?? { secrets: { apiToken: token }, claims: {} };
  const baseURL = options.baseURL ?? bag.claims.baseURL;
  const createClient = options.createClient ?? defaultClientFactory;
  const client = createClient({
    apiToken: token,
    ...(baseURL === undefined || baseURL.length === 0 ? {} : { baseURL })
  });
  return {
    token,
    bag,
    secrets: [token, ...Object.values(bag.secrets)],
    client
  };
}

function schemaShape(schema: z.ZodTypeAny): z.ZodRawShape {
  if (schema instanceof z.ZodObject) {
    return schema.shape as z.ZodRawShape;
  }
  return {};
}
