import type { LoginBag } from "./auth/fields.js";
import type { UpstreamClient, UpstreamClientFactory } from "./upstream/client.js";

export type { UpstreamClient, UpstreamClientFactory };

export interface ClientFactoryOptions {
  readonly apiToken: string;
  readonly baseURL?: string;
}

export interface ToolContext {
  readonly token: string;
  readonly bag: LoginBag;
  readonly secrets: readonly string[];
  readonly client: UpstreamClient;
}

export type ToolContent = {
  readonly type: "text";
  readonly text: string;
};

export interface ToolResult {
  readonly content: readonly ToolContent[];
  readonly isError?: boolean;
}
