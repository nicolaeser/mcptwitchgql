import axios, { AxiosError, AxiosHeaders, type AxiosInstance } from "axios";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../version.js";

export const DEFAULT_BASE_URL = "https://api.example.test";

export interface UpstreamClientOptions {
  readonly apiToken: string;
  readonly baseURL?: string;
  readonly axiosInstance?: AxiosInstance;
  readonly timeoutMs?: number;
}

export type UpstreamClientFactory = (options: UpstreamClientOptions) => UpstreamClient;

export class UpstreamHttpError extends Error {
  public readonly status: number;
  public readonly path: string;
  public constructor(status: number, path: string, message: string) {
    super(message);
    this.name = "UpstreamHttpError";
    this.status = status;
    this.path = path;
  }
}

export const defaultClientFactory: UpstreamClientFactory = (options) => new UpstreamClient(options);

export class UpstreamClient {
  public readonly axios: AxiosInstance;
  public readonly baseURL: string;
  public constructor(options: UpstreamClientOptions) {
    this.baseURL = options.baseURL ?? DEFAULT_BASE_URL;
    const headers = {
      Authorization: `Bearer ${options.apiToken}`,
      "User-Agent": `${PACKAGE_NAME}/${PACKAGE_VERSION}`
    };
    this.axios =
      options.axiosInstance ??
      axios.create({
        baseURL: this.baseURL,
        timeout: options.timeoutMs ?? 30_000,
        headers
      });
    this.axios.defaults.baseURL = this.baseURL;
    this.axios.defaults.timeout = options.timeoutMs ?? this.axios.defaults.timeout ?? 30_000;
    this.axios.defaults.headers.common = AxiosHeaders.from({
      ...headerRecord(this.axios.defaults.headers.common),
      ...headers
    });
  }

  public async getJson(path: string): Promise<unknown> {
    const url = relativePath(path);
    try {
      const response = await this.axios.get(url);
      return response.data;
    } catch (error) {
      throw mapAxiosError(error, url);
    }
  }

  public dispose(): void {

  }
}

function relativePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    throw new Error("path must be a same-origin absolute path starting with /.");
  }
  return trimmed;
}

function mapAxiosError(error: unknown, path: string): UpstreamHttpError {
  if (error instanceof UpstreamHttpError) return error;
  if (error instanceof AxiosError) {
    const status = error.response?.status ?? 0;
    if (status === 401 || status === 403) {
      return new UpstreamHttpError(status, path, "Upstream rejected the API token.");
    }
    return new UpstreamHttpError(
      status,
      path,
      status > 0 ? `Upstream request failed (HTTP ${status}).` : "Could not reach upstream."
    );
  }
  return new UpstreamHttpError(0, path, error instanceof Error ? error.message : String(error));
}

function headerRecord(headers: unknown): Record<string, string> {
  if (headers === undefined || headers === null || typeof headers !== "object") return {};
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (value !== undefined && value !== null && typeof value !== "object") {
      record[key] = String(value);
    }
  }
  return record;
}
