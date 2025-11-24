import { json } from "./responses";

export const DEFAULT_FEED_LIMIT = 20;
export const MAX_FEED_LIMIT = 50;

export type PaginationValidationResult =
  | { ok: true; limit: number; offset: number }
  | { ok: false; response: Response };

// WHY: Prevent unbounded feed queries that would explode downstream fan-out (likes/comments/runs).
// INVARIANT: limit is clamped to MAX_FEED_LIMIT and >= 1; offset is a non-negative integer.
export function validateFeedPagination(url: URL): PaginationValidationResult {
  const limitRaw = url.searchParams.get("limit");
  const offsetRaw = url.searchParams.get("offset");

  const parsedLimit = limitRaw && limitRaw.trim().length > 0 ? Number(limitRaw) : DEFAULT_FEED_LIMIT;
  const parsedOffset = offsetRaw && offsetRaw.trim().length > 0 ? Number(offsetRaw) : 0;

  if (!Number.isFinite(parsedLimit) || !Number.isInteger(parsedLimit)) {
    return {
      ok: false,
      response: json(
        {
          error: "E-VIBECODR-0401 invalid pagination",
          message: "limit must be an integer",
        },
        400
      ),
    };
  }

  if (parsedLimit <= 0) {
    return {
      ok: false,
      response: json(
        {
          error: "E-VIBECODR-0402 invalid pagination",
          message: "limit must be at least 1",
        },
        400
      ),
    };
  }

  if (!Number.isFinite(parsedOffset) || !Number.isInteger(parsedOffset)) {
    return {
      ok: false,
      response: json(
        {
          error: "E-VIBECODR-0403 invalid pagination",
          message: "offset must be an integer",
        },
        400
      ),
    };
  }

  if (parsedOffset < 0) {
    return {
      ok: false,
      response: json(
        {
          error: "E-VIBECODR-0404 invalid pagination",
          message: "offset cannot be negative",
        },
        400
      ),
    };
  }

  const limit = Math.min(parsedLimit, MAX_FEED_LIMIT);
  const offset = parsedOffset;

  return { ok: true, limit, offset };
}
