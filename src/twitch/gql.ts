import axios, { type AxiosInstance } from "axios";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../version.js";
import { WEB_CLIENT_ID, twitchCreds } from "../auth/login-fields.js";
import type { LoginBag } from "../auth/fields.js";

export const GQL_URL = "https://gql.twitch.tv/gql";
export const USHER_LIVE_URL = "https://usher.ttvnw.net/api/channel/hls";
export const USHER_VOD_URL = "https://usher.ttvnw.net/vod";

export interface GqlRequest {
  readonly query?: string;
  readonly operationName?: string;
  readonly variables?: Record<string, unknown>;
  readonly extensions?: Record<string, unknown>;
}

export class TwitchGqlError extends Error {
  public readonly status: number;
  public constructor(status: number, message: string) {
    super(message);
    this.name = "TwitchGqlError";
    this.status = status;
  }
}

export class TwitchGql {
  public readonly clientId: string;
  public readonly oauthToken?: string;
  private readonly http: AxiosInstance;

  public constructor(
    creds: { clientId: string; oauthToken?: string },
    axiosInstance?: AxiosInstance
  ) {
    this.clientId = creds.clientId || WEB_CLIENT_ID;
    if (creds.oauthToken !== undefined) this.oauthToken = creds.oauthToken;
    this.http =
      axiosInstance ??
      axios.create({
        timeout: 20_000,
        headers: {
          "Client-ID": this.clientId,
          "Content-Type": "application/json",
          "User-Agent": `${PACKAGE_NAME}/${PACKAGE_VERSION}`
        }
      });
  }

  public static fromBag(bag: LoginBag, axiosInstance?: AxiosInstance): TwitchGql {
    return new TwitchGql(twitchCreds(bag), axiosInstance);
  }

  public async gql(request: GqlRequest | readonly GqlRequest[]): Promise<unknown> {
    try {
      return await this.gqlOnce(request, this.oauthToken !== undefined);
    } catch (error) {
      if (
        this.oauthToken !== undefined &&
        !isMutation(request) &&
        error instanceof TwitchGqlError &&
        isInvalidTwitchAuth(error)
      ) {
        return this.gqlOnce(request, false);
      }
      throw error;
    }
  }

  private async gqlOnce(request: GqlRequest | readonly GqlRequest[], withOAuth: boolean): Promise<unknown> {
    const body = Array.isArray(request) ? request : request;
    try {
      const response = await this.http.post(
        GQL_URL,
        body,
        withOAuth && this.oauthToken !== undefined
          ? { headers: { Authorization: `OAuth ${this.oauthToken}` } }
          : {}
      );
      const data = response.data as { errors?: Array<{ message?: string }> } | unknown;
      if (data !== null && typeof data === "object" && "errors" in data) {
        const errors = (data as { errors?: Array<{ message?: string }> }).errors;
        if (Array.isArray(errors) && errors.length > 0) {
          throw new TwitchGqlError(
            response.status,
            errors.map((item) => item.message ?? "GraphQL error").join("; ")
          );
        }
      }
      return data;
    } catch (error) {
      if (error instanceof TwitchGqlError) throw error;
      if (axios.isAxiosError(error)) {
        const status = error.response?.status ?? 0;
        const payload = error.response?.data;
        const message =
          payload !== undefined && typeof payload === "object" && payload !== null && "message" in payload
            ? String((payload as { message: unknown }).message)
            : error.message;
        throw new TwitchGqlError(status, message);
      }
      throw error;
    }
  }

  public async query(query: string, variables?: Record<string, unknown>, operationName?: string): Promise<unknown> {
    return this.gql({
      query,
      ...(variables === undefined ? {} : { variables }),
      ...(operationName === undefined ? {} : { operationName })
    });
  }

  public async usherPlaylist(
    kind: "live" | "vod",
    id: string,
    access: { value: string; signature: string },
    options?: {
      platform?: string;
      player?: string;
      supportedCodecs?: string;
    }
  ): Promise<{ url: string; playlist: string }> {
    const encoded = encodeURIComponent(id);
    const url = kind === "live" ? `${USHER_LIVE_URL}/${encoded}.m3u8` : `${USHER_VOD_URL}/${encoded}.m3u8`;
    const params: Record<string, string> = {
      client_id: this.clientId,
      player: options?.player ?? "twitchweb",
      platform: options?.platform ?? "web",
      allow_source: "true",
      allow_audio_only: "true",
      allow_spectre: "true",
      fast_bread: "true",
      playlist_include_framerate: "true",
      supported_codecs: options?.supportedCodecs ?? "avc1",
      sig: access.signature,
      token: access.value,
      nauth: access.value,
      nauthsig: access.signature,
      p: String(usherNonce())
    };
    try {
      const response = await this.http.get(url, { params, responseType: "text" });
      return { url: usherRequestUrl(url, params), playlist: String(response.data) };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status ?? 0;
        throw new TwitchGqlError(status, error.message);
      }
      throw error;
    }
  }
}

function isInvalidTwitchAuth(error: TwitchGqlError): boolean {
  return error.status === 401 || /authorization/i.test(error.message);
}

function isMutation(request: GqlRequest | readonly GqlRequest[]): boolean {
  const items = Array.isArray(request) ? request : [request];
  return items.some((item) => /^\s*mutation\b/i.test(item.query ?? ""));
}

function usherNonce(): number {
  return Math.floor(Math.random() * 9_000_000) + 1_000_000;
}

function usherRequestUrl(base: string, params: Record<string, string>): string {
  const search = new URLSearchParams(params);
  return `${base}?${search.toString()}`;
}
