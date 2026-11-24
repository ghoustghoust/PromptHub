/**
 * Transport and storage guards shared by the orchestrator core, the desktop
 * bridge and SQLite. The token budget is the real limit; these numbers only
 * stop abnormal payloads and must never be used to silently truncate content.
 */

/** Hard character cap for one assembled writing layer. */
export const MAX_WRITING_LAYER_CHARS = 60_000;

/** The canvas editor refuses to draw more boxes than this. */
export const MAX_LAYOUT_BOXES = 32;

/** Caption, exact text and id guards for one layout box. */
export const MAX_LAYOUT_TEXT_CHARS = 4000;
export const MAX_LAYOUT_ID_CHARS = 128;

/** Persisted canvas sides stay below this to reject malformed drafts. */
export const MAX_LAYOUT_CANVAS_SIDE = 32_768;