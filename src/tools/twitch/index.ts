import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";
import { TwitchGql } from "../../twitch/gql.js";
import { WEB_CLIENT_ID } from "../../auth/login-fields.js";

const login = z.string().min(1).describe("Channel login, e.g. xqc.");
const userId = z.string().min(1).describe("Twitch numeric user id as a string.");
const first = z
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe("Page size 1–100. Omit for 20 (100 for chatters, 50 for comments/chapters).");
const after = z
  .string()
  .optional()
  .describe("Pagination cursor from a previous edges[].cursor when pageInfo.hasNextPage is true.");
const language = z
  .string()
  .optional()
  .describe("Single stream language filter, e.g. en or de. Omit for all languages.");
const languages = z
  .array(z.string().min(1))
  .optional()
  .describe("Language codes for directory filters, e.g. [\"EN\",\"DE\"]. Omit for all.");
const tags = z
  .array(z.string().min(1))
  .optional()
  .describe("Freeform tag names to filter the directory. Omit for no tag filter.");
const clipPeriod = z
  .enum(["LAST_DAY", "LAST_WEEK", "LAST_MONTH", "ALL_TIME"])
  .optional()
  .describe("Clip time window. Omit for LAST_WEEK.");
const videoType = z
  .enum(["ARCHIVE", "HIGHLIGHT", "UPLOAD", "PAST_PREMIERE"])
  .optional()
  .describe("VOD type. Omit for ARCHIVE.");
const videoSort = z
  .enum(["TIME", "VIEWS"])
  .optional()
  .describe("VOD sort. Omit for TIME.");
const streamSort = z
  .enum(["VIEWER_COUNT", "VIEWER_COUNT_ASC", "RECENT", "RELEVANCE"])
  .optional()
  .describe("Live directory sort. Omit for Twitch default.");
const platform = z
  .string()
  .optional()
  .describe("Playback platform sent to GQL/Usher, e.g. web, ios, android. Omit for web.");
const playerType = z
  .string()
  .optional()
  .describe("Playback playerType, e.g. site, embed, frontpage. Omit for site.");
const playerBackend = z
  .string()
  .optional()
  .describe("VOD playerBackend, e.g. mediaplayer. Omit for mediaplayer.");
const player = z
  .string()
  .optional()
  .describe("Usher player query value, e.g. twitchweb. Omit for twitchweb.");
const supportedCodecs = z
  .string()
  .optional()
  .describe("Usher codecs, e.g. avc1 or av1,h265,h264. Omit for avc1.");
const profileWidth = z
  .number()
  .int()
  .min(28)
  .max(600)
  .optional()
  .describe("Profile image width in pixels. Omit for 300.");
const previewWidth = z
  .number()
  .int()
  .min(80)
  .max(1920)
  .optional()
  .describe("Stream preview width in pixels. Omit for 1280.");
const previewHeight = z
  .number()
  .int()
  .min(45)
  .max(1080)
  .optional()
  .describe("Stream preview height in pixels. Omit for 720.");
const thumbWidth = z
  .number()
  .int()
  .min(80)
  .max(1920)
  .optional()
  .describe("VOD/clip thumbnail width. Omit for 440.");
const thumbHeight = z
  .number()
  .int()
  .min(45)
  .max(1080)
  .optional()
  .describe("VOD/clip thumbnail height. Omit for 248.");
const badgeSize = z
  .enum(["NORMAL", "DOUBLE", "QUADRUPLE"])
  .optional()
  .describe("Badge image size. Omit for QUADRUPLE.");
const gameName = z.string().optional().describe("Game/category display name, e.g. Just Chatting.");
const gameSlug = z.string().optional().describe("Game/category slug from the directory URL.");
const gameId = z.string().optional().describe("Game/category id.");
const searchQuery = z.string().min(1).describe("Search string.");
const startAt = z
  .string()
  .optional()
  .describe("Schedule window start as ISO-8601 UTC. Omit for now.");
const segmentFirst = z
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe("How many schedule segments to return. Omit for 25.");
const offsetSeconds = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe("VOD comment offset in seconds from the start. Omit to start from the beginning or cursor.");
const lookupType = z
  .enum(["ACTIVE", "ALL"])
  .optional()
  .describe("User lookupType. Omit for ACTIVE.");

function client(ctx: {
  bag: { secrets: Readonly<Record<string, string>>; claims: Readonly<Record<string, string>> };
}) {
  return TwitchGql.fromBag(ctx.bag);
}

function or<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value;
}

function clipSchedule(raw: unknown, startAt: string | undefined, first: number | undefined): unknown {
  if (raw === null || typeof raw !== "object" || !("data" in raw)) return raw;
  const data = (raw as { data: { user?: { channel?: { schedule?: { segments?: unknown[] } | null } } } }).data;
  const schedule = data.user?.channel?.schedule;
  if (schedule === null || schedule === undefined || !Array.isArray(schedule.segments)) return raw;
  let segments = schedule.segments;
  if (startAt !== undefined) {
    segments = segments.filter((item) => {
      if (item === null || typeof item !== "object" || !("startAt" in item)) return true;
      const value = (item as { startAt?: unknown }).startAt;
      return typeof value !== "string" || value >= startAt;
    });
  }
  if (first !== undefined) segments = segments.slice(0, first);
  return {
    ...(raw as Record<string, unknown>),
    data: {
      ...data,
      user: {
        ...data.user,
        channel: {
          ...data.user?.channel,
          schedule: { ...schedule, segments }
        }
      }
    }
  };
}

function languageList(single: string | undefined, many: string[] | undefined): string[] | null {
  const raw = many ?? (single === undefined ? undefined : [single]);
  if (raw === undefined || raw.length === 0) return null;
  const codes = raw.map((item) => item.trim().toUpperCase()).filter((item) => item.length > 0);
  return codes.length === 0 ? null : codes;
}

function streamFilters(
  single: string | undefined,
  many: string[] | undefined,
  sort: "VIEWER_COUNT" | "VIEWER_COUNT_ASC" | "RECENT" | "RELEVANCE" | undefined,
  tags: string[] | undefined
): { on: boolean; languages: string[]; sort: string; tags: string[] } {
  const languages = languageList(single, many);
  const tagList = tags !== undefined && tags.length > 0 ? tags : null;
  return {
    on: languages !== null || tagList !== null || sort !== undefined,
    languages: languages ?? [],
    sort: sort ?? "VIEWER_COUNT",
    tags: tagList ?? []
  };
}

function playbackAccess(
  payload: unknown,
  field: "streamPlaybackAccessToken" | "videoPlaybackAccessToken"
): { value: string; signature: string } {
  const data =
    payload !== null && typeof payload === "object" && "data" in payload
      ? (payload as { data: Record<string, unknown> }).data
      : undefined;
  const token = data?.[field];
  if (token === null || typeof token !== "object") throw new Error("Playback token missing.");
  const rec = token as { value?: unknown; signature?: unknown };
  if (typeof rec.value !== "string" || typeof rec.signature !== "string") {
    throw new Error("Playback token missing.");
  }
  return { value: rec.value, signature: rec.signature };
}

export const tools = [
  defineTool(
    "twitch_whoami",
    "Who am I",
    "Show Client-ID in use and whether a user OAuth token is present. Secrets are never returned.",
    z.object({}),
    (ctx) =>
      runTool(ctx, async () => {
        const gql = client(ctx);
        return {
          clientId: gql.clientId,
          usingWebClient: gql.clientId === WEB_CLIENT_ID,
          hasOAuth: gql.oauthToken !== undefined,
          accountLabel: ctx.bag.claims.accountLabel ?? null
        };
      })
  ),
  defineTool(
    "twitch_gql",
    "Raw GQL",
    "POST an arbitrary GraphQL query, persisted operation, or batch to gql.twitch.tv/gql.",
    z.object({
      query: z.string().optional().describe("Full GraphQL document. Use when you are not sending a persisted hash."),
      operationName: z.string().optional().describe("Operation name matching the document or persisted query."),
      variables: z.record(z.string(), z.unknown()).optional().describe("GraphQL variables object."),
      sha256Hash: z
        .string()
        .optional()
        .describe("Persisted query sha256 when not sending a query string."),
      batch: z
        .array(
          z.object({
            query: z.string().optional().describe("Full GraphQL document for this batch item."),
            operationName: z.string().optional().describe("Operation name for this batch item."),
            variables: z.record(z.string(), z.unknown()).optional().describe("Variables for this batch item."),
            sha256Hash: z.string().optional().describe("Persisted query sha256 for this batch item.")
          })
        )
        .optional()
        .describe("Batch of operations. Use instead of a single query when you need several in one POST.")
    }),
    (ctx, input) =>
      runTool(ctx, () => {
        const gql = client(ctx);
        if (input.batch !== undefined) {
          return gql.gql(
            input.batch.map((item) => ({
              ...(item.query === undefined ? {} : { query: item.query }),
              ...(item.operationName === undefined ? {} : { operationName: item.operationName }),
              ...(item.variables === undefined ? {} : { variables: item.variables }),
              ...(item.sha256Hash === undefined
                ? {}
                : { extensions: { persistedQuery: { version: 1, sha256Hash: item.sha256Hash } } })
            }))
          );
        }
        return gql.gql({
          ...(input.query === undefined ? {} : { query: input.query }),
          ...(input.operationName === undefined ? {} : { operationName: input.operationName }),
          ...(input.variables === undefined ? {} : { variables: input.variables }),
          ...(input.sha256Hash === undefined
            ? {}
            : { extensions: { persistedQuery: { version: 1, sha256Hash: input.sha256Hash } } })
        });
      })
  ),
  defineTool(
    "twitch_user",
    "User",
    "Channel/user by login or id, including live stream and last broadcast.",
    z.object({
      login: login.optional(),
      id: userId.optional(),
      lookupType,
      profileWidth,
      previewWidth,
      previewHeight
    }),
    (ctx, input) =>
      runTool(ctx, () =>
        client(ctx).query(
          `query User($login: String, $id: ID, $lookupType: UserLookupType, $profileWidth: Int!, $previewWidth: Int, $previewHeight: Int) {
            user(login: $login, id: $id, lookupType: $lookupType) {
              id login displayName description createdAt updatedAt
              profileImageURL(width: $profileWidth) bannerImageURL offlineImageURL profileViewCount
              followers { totalCount }
              roles { isPartner isAffiliate isStaff }
              stream {
                id title type viewersCount createdAt language
                game { id name displayName slug }
                previewImageURL(width: $previewWidth, height: $previewHeight)
                freeformTags { name }
              }
              lastBroadcast { id title startedAt game { id name } }
              broadcastSettings { title language game { id name } isMature }
              chatSettings { slowModeDurationSeconds followersOnlyDurationMinutes isSubscribersOnlyModeEnabled isEmoteOnlyModeEnabled }
              primaryTeam { name displayName }
            }
          }`,
          {
            login: input.login ?? null,
            id: input.id ?? null,
            lookupType: or(input.lookupType, "ACTIVE"),
            profileWidth: or(input.profileWidth, 300),
            previewWidth: or(input.previewWidth, 1280),
            previewHeight: or(input.previewHeight, 720)
          }
        )
      )
  ),
  defineTool(
    "twitch_users",
    "Users",
    "Batch lookup of users by login or id.",
    z.object({
      logins: z.array(z.string().min(1)).max(100).optional().describe("Up to 100 channel logins."),
      ids: z.array(z.string().min(1)).max(100).optional().describe("Up to 100 Twitch user ids."),
      profileWidth,
      previewWidth,
      previewHeight
    }),
    (ctx, input) =>
      runTool(ctx, () => {
        if ((input.logins === undefined || input.logins.length === 0) && (input.ids === undefined || input.ids.length === 0)) {
          throw new Error("Provide logins or ids.");
        }
        return client(ctx).query(
          `query Users($ids: [ID!], $logins: [String!], $profileWidth: Int!, $previewWidth: Int, $previewHeight: Int) {
            users(ids: $ids, logins: $logins) {
              id login displayName profileImageURL(width: $profileWidth)
              roles { isPartner isAffiliate isStaff }
              stream {
                id title viewersCount createdAt language
                game { id name displayName slug }
                previewImageURL(width: $previewWidth, height: $previewHeight)
                freeformTags { name }
              }
            }
          }`,
          {
            ids: input.ids ?? null,
            logins: input.logins ?? null,
            profileWidth: or(input.profileWidth, 300),
            previewWidth: or(input.previewWidth, 1280),
            previewHeight: or(input.previewHeight, 720)
          }
        );
      })
  ),
  defineTool(
    "twitch_user_result",
    "User result",
    "User lookup that distinguishes missing or banned channels.",
    z.object({ login }),
    (ctx, input) =>
      runTool(ctx, () =>
        client(ctx).query(
          `query UserResult($login: String!) {
            userResultByLogin(login: $login) {
              __typename
              ... on User { id login displayName description stream { id title viewersCount } }
              ... on UserDoesNotExist { key reason }
              ... on UserError { key }
            }
          }`,
          { login: input.login }
        )
      )
  ),
  defineTool(
    "twitch_stream",
    "Live stream",
    "Live stream for a channel login.",
    z.object({ login, previewWidth, previewHeight }),
    (ctx, input) =>
      runTool(ctx, () =>
        client(ctx).query(
          `query User($login: String, $id: ID, $previewWidth: Int, $previewHeight: Int) {
            user(login: $login, id: $id) {
              id login displayName
              stream {
                id title type viewersCount createdAt language
                game { id name displayName slug }
                previewImageURL(width: $previewWidth, height: $previewHeight)
                freeformTags { name }
              }
            }
          }`,
          {
            login: input.login,
            id: null,
            previewWidth: or(input.previewWidth, 1280),
            previewHeight: or(input.previewHeight, 720)
          }
        )
      )
  ),
  defineTool(
    "twitch_top_streams",
    "Top streams",
    "Currently live streams.",
    z.object({ first, after, language, languages, tags, sort: streamSort, previewWidth, previewHeight }),
    (ctx, input) =>
      runTool(ctx, () => {
        const filters = streamFilters(input.language, input.languages, input.sort, input.tags);
        const previewWidth = or(input.previewWidth, 1280);
        const previewHeight = or(input.previewHeight, 720);
        const base = {
          first: or(input.first, 20),
          after: input.after ?? null,
          previewWidth,
          previewHeight
        };
        if (!filters.on) {
          return client(ctx).query(
            `query TopStreams($first: Int!, $after: Cursor, $previewWidth: Int, $previewHeight: Int) {
              streams(first: $first, after: $after) {
                edges {
                  cursor
                  node {
                    id title type viewersCount createdAt language
                    broadcaster { id login displayName }
                    game { id name displayName slug }
                    previewImageURL(width: $previewWidth, height: $previewHeight)
                    freeformTags { name }
                  }
                }
                pageInfo { hasNextPage }
              }
            }`,
            base
          );
        }
        return client(ctx).query(
          `query TopStreams($first: Int!, $after: Cursor, $languages: [Language!], $sort: StreamSort, $tags: [String!], $previewWidth: Int, $previewHeight: Int) {
            streams(first: $first, after: $after, options: { broadcasterLanguages: $languages, sort: $sort, freeformTags: $tags }) {
              edges {
                cursor
                node {
                  id title type viewersCount createdAt language
                  broadcaster { id login displayName }
                  game { id name displayName slug }
                  previewImageURL(width: $previewWidth, height: $previewHeight)
                  freeformTags { name }
                }
              }
              pageInfo { hasNextPage }
            }
          }`,
          { ...base, languages: filters.languages, sort: filters.sort, tags: filters.tags }
        );
      })
  ),
  defineTool(
    "twitch_top_games",
    "Top categories",
    "Directory of games/categories by viewers.",
    z.object({ first, after, tags }),
    (ctx, input) =>
      runTool(ctx, () => {
        const base = { first: or(input.first, 20), after: input.after ?? null };
        if (input.tags === undefined || input.tags.length === 0) {
          return client(ctx).query(
            `query TopGames($first: Int!, $after: Cursor) {
              games(first: $first, after: $after) {
                edges {
                  cursor
                  node { id name displayName viewersCount boxArtURL }
                }
                pageInfo { hasNextPage }
              }
            }`,
            base
          );
        }
        return client(ctx).query(
          `query TopGames($first: Int!, $after: Cursor, $tags: [String!]!) {
            games(first: $first, after: $after, options: { tags: $tags }) {
              edges {
                cursor
                node { id name displayName viewersCount boxArtURL }
              }
              pageInfo { hasNextPage }
            }
          }`,
          { ...base, tags: input.tags }
        );
      })
  ),
  defineTool(
    "twitch_game",
    "Game",
    "Category by name, slug, or id.",
    z.object({ name: gameName, slug: gameSlug, id: gameId }),
    (ctx, input) =>
      runTool(ctx, () =>
        client(ctx).query(
          `query Game($name: String, $id: ID, $slug: String) {
            game(name: $name, id: $id, slug: $slug) {
              id name displayName viewersCount followersCount originalReleaseDate boxArtURL
            }
          }`,
          { name: input.name ?? null, slug: input.slug ?? null, id: input.id ?? null }
        )
      )
  ),
  defineTool(
    "twitch_game_streams",
    "Game streams",
    "Live streams in a category.",
    z.object({
      name: gameName,
      slug: gameSlug,
      id: gameId,
      first,
      after,
      languages,
      tags,
      sort: streamSort,
      previewWidth,
      previewHeight
    }),
    (ctx, input) =>
      runTool(ctx, () => {
        const filters = streamFilters(undefined, input.languages, input.sort, input.tags);
        const base = {
          name: input.name ?? null,
          slug: input.slug ?? null,
          first: or(input.first, 20),
          after: input.after ?? null,
          previewWidth: or(input.previewWidth, 1280),
          previewHeight: or(input.previewHeight, 720)
        };
        if (!filters.on) {
          return client(ctx).query(
            `query GameStreams($name: String, $slug: String, $first: Int!, $after: Cursor, $previewWidth: Int, $previewHeight: Int) {
              game(name: $name, slug: $slug) {
                id name
                streams(first: $first, after: $after) {
                  edges {
                    cursor
                    node {
                      id title viewersCount language createdAt
                      broadcaster { id login displayName }
                      previewImageURL(width: $previewWidth, height: $previewHeight)
                      freeformTags { name }
                      game { id name slug }
                    }
                  }
                  pageInfo { hasNextPage }
                }
              }
            }`,
            base
          );
        }
        return client(ctx).query(
          `query GameStreams($name: String, $slug: String, $first: Int!, $after: Cursor, $languages: [Language!], $sort: StreamSort, $tags: [String!], $previewWidth: Int, $previewHeight: Int) {
            game(name: $name, slug: $slug) {
              id name
              streams(first: $first, after: $after, options: { broadcasterLanguages: $languages, sort: $sort, freeformTags: $tags }) {
                edges {
                  cursor
                  node {
                    id title viewersCount language createdAt
                    broadcaster { id login displayName }
                    previewImageURL(width: $previewWidth, height: $previewHeight)
                    freeformTags { name }
                    game { id name slug }
                  }
                }
                pageInfo { hasNextPage }
              }
            }
          }`,
          { ...base, languages: filters.languages, sort: filters.sort, tags: filters.tags }
        );
      })
  ),
  defineTool(
    "twitch_game_clips",
    "Game clips",
    "Top clips in a category.",
    z.object({
      name: gameName,
      slug: gameSlug,
      id: gameId,
      first,
      after,
      period: clipPeriod
    }),
    (ctx, input) =>
      runTool(ctx, () =>
        client(ctx).query(
          `query GameClips($name: String, $slug: String, $id: ID, $first: Int!, $after: Cursor, $period: ClipsPeriod) {
            game(name: $name, slug: $slug, id: $id) {
              id name slug
              clips(first: $first, after: $after, criteria: { period: $period, sort: VIEWS_DESC }) {
                pageInfo { hasNextPage }
                edges {
                  cursor
                  node {
                    id slug title createdAt viewCount durationSeconds url thumbnailURL
                    broadcaster { id login displayName }
                    curator { login displayName }
                  }
                }
              }
            }
          }`,
          {
            name: input.name ?? null,
            slug: input.slug ?? null,
            id: input.id ?? null,
            first: or(input.first, 20),
            after: input.after ?? null,
            period: or(input.period, "LAST_WEEK")
          }
        )
      )
  ),
  defineTool(
    "twitch_game_videos",
    "Game videos",
    "VODs in a category.",
    z.object({
      name: gameName,
      slug: gameSlug,
      id: gameId,
      first,
      after,
      sort: videoSort,
      thumbWidth,
      thumbHeight
    }),
    (ctx, input) =>
      runTool(ctx, () =>
        client(ctx).query(
          `query GameVideos($name: String, $slug: String, $id: ID, $first: Int!, $after: Cursor, $sort: VideoSort, $thumbWidth: Int, $thumbHeight: Int) {
            game(name: $name, slug: $slug, id: $id) {
              id name slug
              videos(first: $first, after: $after, sort: $sort) {
                pageInfo { hasNextPage }
                edges {
                  cursor
                  node {
                    id title createdAt lengthSeconds viewCount broadcastType
                    previewThumbnailURL(width: $thumbWidth, height: $thumbHeight)
                    owner { id login displayName }
                  }
                }
              }
            }
          }`,
          {
            name: input.name ?? null,
            slug: input.slug ?? null,
            id: input.id ?? null,
            first: or(input.first, 20),
            after: input.after ?? null,
            sort: or(input.sort, "TIME"),
            thumbWidth: or(input.thumbWidth, 440),
            thumbHeight: or(input.thumbHeight, 248)
          }
        )
      )
  ),
  defineTool(
    "twitch_game_tags",
    "Game tags",
    "Content tags on a category.",
    z.object({ name: gameName, slug: gameSlug, id: gameId }),
    (ctx, input) =>
      runTool(ctx, () =>
        client(ctx).query(
          `query GameTags($name: String, $slug: String, $id: ID) {
            game(name: $name, slug: $slug, id: $id) {
              id name slug displayName
              tags(tagType: CONTENT) { id localizedName scope }
            }
          }`,
          { name: input.name ?? null, slug: input.slug ?? null, id: input.id ?? null }
        )
      )
  ),
  defineTool(
    "twitch_videos",
    "Channel videos",
    "VODs/highlights/uploads for a channel.",
    z.object({
      login,
      first,
      after,
      type: videoType,
      sort: videoSort,
      thumbWidth,
      thumbHeight
    }),
    (ctx, input) =>
      runTool(ctx, () =>
        client(ctx).query(
          `query ChannelVideos($login: String!, $first: Int!, $after: Cursor, $type: BroadcastType, $sort: VideoSort, $thumbWidth: Int, $thumbHeight: Int) {
            user(login: $login) {
              id login
              videos(first: $first, after: $after, type: $type, sort: $sort) {
                totalCount
                pageInfo { hasNextPage }
                edges {
                  cursor
                  node {
                    id title description createdAt publishedAt lengthSeconds viewCount broadcastType status
                    previewThumbnailURL(width: $thumbWidth, height: $thumbHeight)
                    game { id name }
                  }
                }
              }
            }
          }`,
          {
            login: input.login,
            first: or(input.first, 20),
            after: input.after ?? null,
            type: or(input.type, "ARCHIVE"),
            sort: or(input.sort, "TIME"),
            thumbWidth: or(input.thumbWidth, 440),
            thumbHeight: or(input.thumbHeight, 248)
          }
        )
      )
  ),
  defineTool(
    "twitch_video",
    "Video",
    "Single VOD by id.",
    z.object({ id: z.string().min(1).describe("VOD/video id.") }),
    (ctx, input) =>
      runTool(ctx, () =>
        client(ctx).query(
          `query Video($id: ID!) {
            video(id: $id) {
              id title description createdAt publishedAt lengthSeconds viewCount broadcastType status seekPreviewsURL
              game { id name }
              owner { id login displayName }
              creator { id login displayName }
            }
          }`,
          { id: input.id }
        )
      )
  ),
  defineTool(
    "twitch_video_moments",
    "Video chapters",
    "Game-change chapters on a VOD.",
    z.object({
      id: z.string().min(1).describe("VOD/video id."),
      first,
      after
    }),
    (ctx, input) =>
      runTool(ctx, () =>
        client(ctx).query(
          `query VideoMoments($id: ID!, $first: Int, $after: Cursor) {
            video(id: $id) {
              id title
              moments(first: $first, after: $after, sort: ASC, types: [GAME_CHANGE], momentRequestType: VIDEO_CHAPTER_MARKERS) {
                pageInfo { hasNextPage }
                edges {
                  cursor
                  node {
                    durationMilliseconds
                    positionMilliseconds
                    details { ... on GameChangeMomentDetails { game { id name displayName slug } } }
                  }
                }
              }
            }
          }`,
          { id: input.id, first: or(input.first, 50), after: input.after ?? null }
        )
      )
  ),
  defineTool(
    "twitch_clips",
    "Channel clips",
    "Clips for a channel.",
    z.object({ login, first, after, period: clipPeriod }),
    (ctx, input) =>
      runTool(ctx, () =>
        client(ctx).query(
          `query ChannelClips($login: String!, $first: Int!, $after: Cursor, $period: ClipsPeriod) {
            user(login: $login) {
              id login
              clips(first: $first, after: $after, criteria: { period: $period, sort: VIEWS_DESC }) {
                pageInfo { hasNextPage }
                edges {
                  cursor
                  node {
                    id slug title createdAt viewCount durationSeconds url thumbnailURL
                    game { id name }
                    broadcaster { login displayName }
                    curator { login displayName }
                  }
                }
              }
            }
          }`,
          {
            login: input.login,
            first: or(input.first, 20),
            after: input.after ?? null,
            period: or(input.period, "LAST_WEEK")
          }
        )
      )
  ),
  defineTool(
    "twitch_clip",
    "Clip",
    "Clip by slug, including quality URLs.",
    z.object({ slug: z.string().min(1).describe("Clip slug from the clip URL.") }),
    (ctx, input) =>
      runTool(ctx, () =>
        client(ctx).query(
          `query Clip($slug: ID!) {
            clip(slug: $slug) {
              id slug title createdAt viewCount durationSeconds url
              videoQualities { frameRate quality sourceURL }
              game { id name }
              broadcaster { login displayName }
              curator { login displayName }
              video { id }
            }
          }`,
          { slug: input.slug }
        )
      )
  ),
  defineTool(
    "twitch_search",
    "Search",
    "Search channels, games, and videos.",
    z.object({ query: searchQuery, first }),
    (ctx, input) =>
      runTool(ctx, () =>
        client(ctx).query(
          `query Search($query: String!) {
            searchFor(userQuery: $query, platform: "web") {
              channels { cursor items { id login displayName } }
              games { cursor items { id name displayName viewersCount boxArtURL } }
              videos { cursor items { id title lengthSeconds viewCount owner { login } } }
              relatedLiveChannels { items { id login displayName } }
            }
          }`,
          { query: input.query }
        )
      )
  ),
  defineTool(
    "twitch_search_tags",
    "Search tags",
    "Freeform stream tags and category tags.",
    z.object({ query: searchQuery, first }),
    (ctx, input) =>
      runTool(ctx, () =>
        client(ctx).query(
          `query SearchTags($query: String!, $first: Int) {
            searchFreeformTags(userQuery: $query, first: $first) {
              edges { node { tagName } }
            }
            searchCategoryTags(userQuery: $query, limit: $first) {
              id localizedName scope
            }
          }`,
          { query: input.query, first: or(input.first, 20) }
        )
      )
  ),
  defineTool(
    "twitch_tag",
    "Tag",
    "Content tag by id.",
    z.object({ id: z.string().min(1).describe("Tag id from search_tags or a stream.") }),
    (ctx, input) =>
      runTool(ctx, () =>
        client(ctx).query(
          `query ContentTag($id: ID!) {
            contentTag(id: $id) { id localizedName scope }
          }`,
          { id: input.id }
        )
      )
  ),
  defineTool(
    "twitch_schedule",
    "Schedule",
    "Upcoming stream schedule for a channel.",
    z.object({ login, startAt, first: segmentFirst }),
    (ctx, input) =>
      runTool(ctx, async () => {
        const raw = await client(ctx).query(
          `query Schedule($login: String!) {
            user(login: $login) {
              id login
              channel {
                schedule {
                  id
                  segments {
                    id title startAt endAt isCancelled
                    categories { id name }
                  }
                }
              }
            }
          }`,
          { login: input.login }
        );
        return clipSchedule(raw, input.startAt, input.first);
      })
  ),
  defineTool(
    "twitch_about",
    "About panel",
    "About text, socials, and channel panels.",
    z.object({ login }),
    (ctx, input) =>
      runTool(ctx, () =>
        client(ctx).query(
          `query About($login: String!) {
            user(login: $login) {
              id login displayName description primaryColorHex
              channel { socialMedias { name title url } }
              panels {
                __typename
                ... on DefaultPanel { id title description imageURL linkURL }
              }
            }
          }`,
          { login: input.login }
        )
      )
  ),
  defineTool(
    "twitch_team",
    "Team",
    "Twitch team by name, including members.",
    z.object({
      name: z.string().min(1).describe("Team name from the team URL, e.g. cloud9."),
      first,
      after
    }),
    (ctx, input) =>
      runTool(ctx, () =>
        client(ctx).query(
          `query Team($name: String!, $first: Int!, $after: Cursor) {
            team(name: $name) {
              name displayName description bannerURL logoURL
              owner { id login displayName }
              members(first: $first, after: $after) {
                totalCount
                pageInfo { hasNextPage }
                edges {
                  cursor
                  node {
                    id login displayName
                    stream { id viewersCount title game { id name slug } }
                  }
                }
              }
              liveMembers(first: $first, after: $after) {
                pageInfo { hasNextPage }
                edges {
                  cursor
                  node {
                    id login displayName
                    stream { id viewersCount title game { id name slug } }
                  }
                }
              }
            }
          }`,
          { name: input.name, first: or(input.first, 20), after: input.after ?? null }
        )
      )
  ),
  defineTool(
    "twitch_chat_badges",
    "Chat badges",
    "Channel and global chat badges.",
    z.object({ login, badgeSize }),
    (ctx, input) =>
      runTool(ctx, () =>
        client(ctx).query(
          `query ChatBadges($login: String!, $badgeSize: BadgeImageSize) {
            user(login: $login) {
              id
              broadcastBadges { id setID version title description imageURL(size: $badgeSize) clickAction clickURL }
            }
            badges { id setID version title imageURL(size: $badgeSize) }
          }`,
          { login: input.login, badgeSize: or(input.badgeSize, "QUADRUPLE") }
        )
      )
  ),
  defineTool(
    "twitch_chat_pinned",
    "Pinned chat",
    "Pinned chat messages on a channel.",
    z.object({ login, first }),
    (ctx, input) =>
      runTool(ctx, () =>
        client(ctx).query(
          `query PinnedChat($login: String!, $first: Int) {
            user(login: $login) {
              id login
              channel {
                id
                pinnedChatMessages(first: $first) {
                  pageInfo { hasNextPage }
                  edges {
                    cursor
                    node {
                      id type startsAt endsAt updatedAt
                      pinnedBy { id login displayName }
                      pinnedMessage {
                        id sentAt
                        content { text }
                        sender { id login displayName }
                      }
                    }
                  }
                }
              }
            }
          }`,
          { login: input.login, first: or(input.first, 10) }
        )
      )
  ),
  defineTool(
    "twitch_emotes",
    "Channel emotes",
    "Subscriber emotes for a channel.",
    z.object({ login }),
    (ctx, input) =>
      runTool(ctx, () =>
        client(ctx).query(
          `query ChannelEmotes($login: String!) {
            user(login: $login) {
              id login
              channel { id }
              subscriptionProducts { id name emotes { id token } }
            }
          }`,
          { login: input.login }
        )
      )
  ),
  defineTool(
    "twitch_emote",
    "Emote",
    "Single emote by id.",
    z.object({ id: z.string().min(1).describe("Emote id.") }),
    (ctx, input) =>
      runTool(ctx, () =>
        client(ctx).query(
          `query Emote($id: ID!) {
            emote(id: $id) {
              id token type setID subscriptionTier
              owner { id login displayName }
              bitsBadgeTierSummary { threshold }
            }
          }`,
          { id: input.id }
        )
      )
  ),
  defineTool(
    "twitch_cheer_emotes",
    "Cheer emotes",
    "Global cheermotes plus a channel's cheer groups. Omit login for global only.",
    z.object({ login: login.optional() }),
    (ctx, input) =>
      runTool(ctx, () =>
        client(ctx).query(
          `query CheerEmotes($login: String) {
            cheerConfig {
              displayConfig {
                backgrounds
                colors { bits color }
                scales
                types { animation extension }
              }
              groups { templateURL nodes { prefix tiers { bits } } }
            }
            user(login: $login) {
              id login
              cheer { cheerGroups { templateURL nodes { prefix tiers { bits } } } }
            }
          }`,
          { login: input.login ?? null }
        )
      )
  ),
  defineTool(
    "twitch_playback_token",
    "Playback token",
    "Access token + signature for a live channel, VOD, or clip.",
    z.object({
      login: login.optional(),
      vodId: z.string().optional().describe("VOD id when requesting VOD playback."),
      clipSlug: z.string().optional().describe("Clip slug when requesting clip playback."),
      platform,
      playerType,
      playerBackend
    }),
    (ctx, input) =>
      runTool(ctx, async () => {
        const gql = client(ctx);
        const plat = or(input.platform, "web");
        const pType = or(input.playerType, "site");
        if (input.clipSlug !== undefined) {
          return gql.query(
            `query ClipPlayback($slug: ID!, $platform: String!, $playerType: String!) {
              clip(slug: $slug) {
                id
                playbackAccessToken(params: { platform: $platform, playerType: $playerType }) { value signature }
                videoQualities { frameRate quality sourceURL }
              }
            }`,
            { slug: input.clipSlug, platform: plat, playerType: pType }
          );
        }
        if (input.vodId !== undefined) {
          return gql.query(
            `query VodPlayback($id: ID!, $platform: String!, $playerType: String!, $playerBackend: String!) {
              videoPlaybackAccessToken(id: $id, params: { platform: $platform, playerBackend: $playerBackend, playerType: $playerType }) {
                value signature
              }
            }`,
            { id: input.vodId, platform: plat, playerType: pType, playerBackend: or(input.playerBackend, "mediaplayer") }
          );
        }
        if (input.login !== undefined) {
          return gql.query(
            `query StreamPlayback($login: String!, $playerType: String!, $platform: String!) {
              streamPlaybackAccessToken(channelName: $login, params: { platform: $platform, playerType: $playerType }) {
                value signature
              }
            }`,
            { login: input.login, playerType: pType, platform: plat }
          );
        }
        throw new Error("Provide login, vodId, or clipSlug.");
      })
  ),
  defineTool(
    "twitch_hls",
    "HLS playlist",
    "Playback token plus Usher m3u8 for a live channel or VOD.",
    z.object({
      login: login.optional(),
      vodId: z.string().optional().describe("VOD id when requesting a VOD playlist."),
      platform,
      playerType,
      playerBackend,
      player,
      supportedCodecs
    }),
    (ctx, input) =>
      runTool(ctx, async () => {
        const gql = client(ctx);
        const plat = or(input.platform, "web");
        const pType = or(input.playerType, "site");
        const usherOpts = {
          platform: plat,
          ...(input.player === undefined ? {} : { player: input.player }),
          ...(input.supportedCodecs === undefined ? {} : { supportedCodecs: input.supportedCodecs })
        };
        if (input.vodId !== undefined) {
          const tokenPayload = await gql.query(
            `query VodPlayback($id: ID!, $platform: String!, $playerType: String!, $playerBackend: String!) {
              videoPlaybackAccessToken(id: $id, params: { platform: $platform, playerBackend: $playerBackend, playerType: $playerType }) {
                value signature
              }
            }`,
            { id: input.vodId, platform: plat, playerType: pType, playerBackend: or(input.playerBackend, "mediaplayer") }
          );
          const access = playbackAccess(tokenPayload, "videoPlaybackAccessToken");
          const usher = await gql.usherPlaylist("vod", input.vodId, access, usherOpts);
          return { kind: "vod", id: input.vodId, signature: access.signature, ...usher };
        }
        if (input.login !== undefined) {
          const tokenPayload = await gql.query(
            `query StreamPlayback($login: String!, $playerType: String!, $platform: String!) {
              streamPlaybackAccessToken(channelName: $login, params: { platform: $platform, playerType: $playerType }) {
                value signature
              }
            }`,
            { login: input.login, playerType: pType, platform: plat }
          );
          const access = playbackAccess(tokenPayload, "streamPlaybackAccessToken");
          const usher = await gql.usherPlaylist("live", input.login, access, usherOpts);
          return { kind: "live", login: input.login, signature: access.signature, ...usher };
        }
        throw new Error("Provide login or vodId.");
      })
  ),
  defineTool(
    "twitch_followers",
    "Followers",
    "Followers of a channel.",
    z.object({ login, first, after }),
    (ctx, input) =>
      runTool(ctx, () =>
        client(ctx).query(
          `query Followers($login: String!, $first: Int!, $after: Cursor) {
            user(login: $login) {
              id
              followers(first: $first, after: $after) {
                totalCount
                pageInfo { hasNextPage }
                edges { cursor followedAt node { id login displayName } }
              }
            }
          }`,
          { login: input.login, first: or(input.first, 20), after: input.after ?? null }
        )
      )
  ),
  defineTool(
    "twitch_chatters",
    "Chatters",
    "Channel mods and VIPs. The full chatter list is integrity-gated on GQL.",
    z.object({ login }),
    (ctx, input) =>
      runTool(ctx, () =>
        client(ctx).query(
          `query Chatters($login: String!) {
            user(login: $login) {
              id login
              mods { edges { node { id login displayName } } }
              vips { edges { node { id login displayName } } }
            }
          }`,
          { login: input.login }
        )
      )
  ),
  defineTool(
    "twitch_hype_train",
    "Hype train",
    "Active hype train on a channel.",
    z.object({ login }),
    (ctx, input) =>
      runTool(ctx, () =>
        client(ctx).query(
          `query HypeTrain($login: String!) {
            user(login: $login) {
              id
              channel { hypeTrain { execution { id progress { goal remainingSeconds level { value goal } } } } }
            }
          }`,
          { login: input.login }
        )
      )
  ),
  defineTool(
    "twitch_community_points",
    "Channel points",
    "Channel points rewards.",
    z.object({ login }),
    (ctx, input) =>
      runTool(ctx, () =>
        client(ctx).query(
          `query CommunityPoints($login: String!) {
            user(login: $login) {
              id
              channel {
                communityPointsSettings {
                  name
                  image { url }
                  automaticRewards { id isEnabled }
                  customRewards { id title cost isEnabled isPaused prompt }
                }
              }
            }
          }`,
          { login: input.login }
        )
      )
  ),
  defineTool(
    "twitch_comments",
    "VOD comments",
    "Chat comments on a VOD.",
    z.object({
      videoId: z.string().min(1).describe("VOD/video id."),
      first,
      after,
      offsetSeconds
    }),
    (ctx, input) =>
      runTool(ctx, () =>
        client(ctx).query(
          `query VideoComments($videoID: ID!, $first: Int, $after: Cursor, $offset: Int) {
            video(id: $videoID) {
              id
              comments(first: $first, after: $after, contentOffsetSeconds: $offset) {
                pageInfo { hasNextPage }
                edges {
                  cursor
                  node {
                    id createdAt contentOffsetSeconds
                    commenter { login displayName }
                    message { fragments { text } }
                  }
                }
              }
            }
          }`,
          {
            videoID: input.videoId,
            first: or(input.first, 50),
            after: input.after ?? null,
            offset: input.offsetSeconds ?? null
          }
        )
      )
  )
];
