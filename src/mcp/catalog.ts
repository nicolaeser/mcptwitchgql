import { tools as twitch } from "../tools/twitch/index.js";

export const TOOL_CATALOG = [
  ...twitch
];

export const TOOL_NAMES = TOOL_CATALOG.map((entry) => entry.name);
