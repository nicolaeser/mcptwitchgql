import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { TOOL_CATALOG, TOOL_NAMES } from "../mcp/catalog.js";
import { TwitchGql } from "../twitch/gql.js";
import type { ToolContext } from "../types.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const PUBLIC_READS = [
  "twitch_users",
  "twitch_user_result",
  "twitch_game_clips",
  "twitch_game_videos",
  "twitch_game_tags",
  "twitch_video_moments",
  "twitch_team",
  "twitch_cheer_emotes",
  "twitch_emote",
  "twitch_search_tags",
  "twitch_tag",
  "twitch_chat_pinned",
  "twitch_hls"
] as const;

function ctx(): ToolContext {
  return {
    token: "session",
    bag: { secrets: {}, claims: {} },
    secrets: ["session"],
    client: { dispose() {}, axios: {} as never, baseURL: "", getJson: async () => ({}) }
  };
}

function tool(name: string) {
  const entry = TOOL_CATALOG.find((item) => item.name === name);
  if (entry === undefined) throw new Error(`missing tool ${name}`);
  return entry;
}

describe("public GQL tools", () => {
  it("registers public Client-ID reads", () => {
    expect(TOOL_NAMES).toEqual(expect.arrayContaining([...PUBLIC_READS]));
  });

  it("marks public reads as read-only", () => {
    for (const name of PUBLIC_READS) {
      expect(tool(name).annotations.readOnlyHint).toBe(true);
      expect(tool(name).annotations.destructiveHint).toBe(false);
    }
  });

  it("defaults twitch_user lookupType to ACTIVE", async () => {
    const query = vi.fn().mockResolvedValue({ data: { user: { login: "xqc" } } });
    vi.spyOn(TwitchGql, "fromBag").mockReturnValue({ query } as never);
    await tool("twitch_user").handler(ctx(), { login: "xqc" });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("query User"),
      expect.objectContaining({ login: "xqc", lookupType: "ACTIVE" })
    );
  });

  it("omits stream options when game_streams has no filters", async () => {
    const query = vi.fn().mockResolvedValue({ data: { game: { streams: { edges: [] } } } });
    vi.spyOn(TwitchGql, "fromBag").mockReturnValue({ query } as never);
    await tool("twitch_game_streams").handler(ctx(), { name: "Just Chatting" });
    expect(String(query.mock.calls[0]?.[0])).not.toContain("options:");
  });

  it("uses Cursor and Language types for top streams", async () => {
    const query = vi.fn().mockResolvedValue({ data: { streams: { edges: [] } } });
    vi.spyOn(TwitchGql, "fromBag").mockReturnValue({ query } as never);
    await tool("twitch_top_streams").handler(ctx(), { first: 20, sort: "VIEWER_COUNT" });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("$after: Cursor"),
      expect.objectContaining({ first: 20, sort: "VIEWER_COUNT", languages: [], tags: [] })
    );
    expect(String(query.mock.calls[0]?.[0])).not.toContain("$language: String");
  });

  it("inlines the GraphQL document on the wire", async () => {
    const query = vi.fn().mockResolvedValue({ data: { users: [] } });
    vi.spyOn(TwitchGql, "fromBag").mockReturnValue({ query } as never);
    await tool("twitch_users").handler(ctx(), { logins: ["xqc"] });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("query Users"),
      expect.objectContaining({ ids: null, logins: ["xqc"] })
    );
  });

  it("passes VOD comment offset in the query variables", async () => {
    const query = vi.fn().mockResolvedValue({ data: {} });
    vi.spyOn(TwitchGql, "fromBag").mockReturnValue({ query } as never);
    await tool("twitch_comments").handler(ctx(), { videoId: "123", offsetSeconds: 45 });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("contentOffsetSeconds"),
      expect.objectContaining({ videoID: "123", offset: 45 })
    );
  });

  it("builds HLS from a GQL token plus Usher", async () => {
    const query = vi.fn().mockResolvedValue({
      data: { streamPlaybackAccessToken: { value: "tok", signature: "sig" } }
    });
    const usherPlaylist = vi.fn().mockResolvedValue({
      url: "https://usher.ttvnw.net/api/channel/hls/xqc.m3u8",
      playlist: "#EXTM3U"
    });
    vi.spyOn(TwitchGql, "fromBag").mockReturnValue({ query, usherPlaylist } as never);
    const result = await tool("twitch_hls").handler(ctx(), { login: "xqc" });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("streamPlaybackAccessToken"), {
      login: "xqc",
      playerType: "site",
      platform: "web"
    });
    expect(usherPlaylist).toHaveBeenCalledWith(
      "live",
      "xqc",
      { value: "tok", signature: "sig" },
      expect.objectContaining({ platform: "web" })
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("#EXTM3U");
  });

  it("describes every input so the model can choose values", () => {
    for (const entry of TOOL_CATALOG) {
      if (!(entry.inputSchema instanceof z.ZodObject)) continue;
      const shape = entry.inputSchema.shape as Record<string, z.ZodTypeAny>;
      for (const [key, schema] of Object.entries(shape)) {
        expect(fieldDescription(schema), `${entry.name}.${key}`).toBeTruthy();
      }
    }
  });

  it("does not expose integrity or Helix tools", () => {
    expect(TOOL_NAMES).not.toEqual(expect.arrayContaining([
      "twitch_follow",
      "twitch_unfollow",
      "twitch_helix",
      "twitch_prediction",
      "twitch_following",
      "twitch_poll",
      "twitch_current_user"
    ]));
  });
});

function fieldDescription(schema: z.ZodTypeAny): string | undefined {
  if (typeof schema.description === "string" && schema.description.length > 0) return schema.description;
  const inner = "unwrap" in schema && typeof schema.unwrap === "function" ? schema.unwrap() : undefined;
  if (inner !== undefined) return fieldDescription(inner as z.ZodTypeAny);
  return undefined;
}
