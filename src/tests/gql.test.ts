import { describe, expect, it, vi } from "vitest";
import { TwitchGql, GQL_URL } from "../twitch/gql.js";
import { WEB_CLIENT_ID } from "../auth/login-fields.js";

describe("TwitchGql", () => {
  it("posts to gql.twitch.tv with the web Client-ID", async () => {
    const post = vi.fn().mockResolvedValue({
      status: 200,
      data: { data: { user: { login: "xqc" } } }
    });
    const gql = new TwitchGql(
      { clientId: WEB_CLIENT_ID },
      { post, get: vi.fn() } as never
    );
    const result = await gql.query("query { user(login: $login) { login } }", { login: "xqc" }, "User");
    expect(post).toHaveBeenCalledWith(
      GQL_URL,
      expect.objectContaining({
        query: expect.stringContaining("user"),
        variables: { login: "xqc" },
        operationName: "User"
      }),
      {}
    );
    expect(result).toEqual({ data: { user: { login: "xqc" } } });
  });

  it("does not send Authorization on public reads", async () => {
    const post = vi.fn().mockResolvedValue({ status: 200, data: { data: {} } });
    const gql = new TwitchGql({ clientId: WEB_CLIENT_ID }, { post, get: vi.fn() } as never);
    await gql.query("query { streams { edges { node { id } } } }");
    expect(post.mock.calls[0]?.[2]).toEqual({});
  });

  it("retries public GQL without OAuth when the user token is invalid", async () => {
    const unauthorized = Object.assign(new Error("Request failed"), {
      isAxiosError: true,
      response: { status: 401, data: { message: 'The "Authorization" token is invalid.' } }
    });
    const post = vi
      .fn()
      .mockRejectedValueOnce(unauthorized)
      .mockResolvedValueOnce({ status: 200, data: { data: { streams: { edges: [] } } } });
    const gql = new TwitchGql(
      { clientId: WEB_CLIENT_ID, oauthToken: "expiredtokenexpiredtoken" },
      { post, get: vi.fn() } as never
    );
    const result = await gql.query("query { streams { edges { node { id } } } }");
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0]?.[2]).toEqual({
      headers: { Authorization: "OAuth expiredtokenexpiredtoken" }
    });
    expect(post.mock.calls[1]?.[2]).toEqual({});
    expect(result).toEqual({ data: { streams: { edges: [] } } });
  });

  it("surfaces GraphQL errors", async () => {
    const gql = new TwitchGql(
      { clientId: WEB_CLIENT_ID },
      {
        post: vi.fn().mockResolvedValue({
          status: 200,
          data: { errors: [{ message: "persisted query not found" }] }
        })
      } as never
    );
    await expect(gql.query("query { x }")).rejects.toThrow(/persisted query not found/);
  });

  it("fetches an Usher HLS playlist with the playback signature", async () => {
    const get = vi.fn().mockResolvedValue({ data: "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nchunk.ts" });
    const gql = new TwitchGql({ clientId: WEB_CLIENT_ID }, { post: vi.fn(), get } as never);
    const result = await gql.usherPlaylist("live", "xqc", { value: "tok", signature: "sig" });
    expect(get).toHaveBeenCalledWith(
      "https://usher.ttvnw.net/api/channel/hls/xqc.m3u8",
      expect.objectContaining({
        params: expect.objectContaining({ token: "tok", sig: "sig", client_id: WEB_CLIENT_ID }),
        responseType: "text"
      })
    );
    expect(result.playlist).toContain("#EXTM3U");
    expect(result.url).toContain("sig=sig");
  });
});
