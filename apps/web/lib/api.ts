import type { ApiFeedPost } from "@vibecodr/shared";
import type { UpdateProfilePayload } from "@/lib/profile/schema";
import { getWorkerApiBase } from "@/lib/worker-api";

// Tiny API client for the Worker API.

function workerUrl(path: string): string {
  const base = getWorkerApiBase();
  if (!path) return base;
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

type ModerationPostAction = "quarantine" | "unquarantine" | "remove";

type ModerationCommentAction = "remove";

export const moderationApi = {
  moderatePost(postId: string, action: ModerationPostAction, init?: RequestInit) {
    return fetch(workerUrl(`/moderation/posts/${postId}/action`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      body: JSON.stringify({ action }),
      ...init,
    });
  },
  moderateComment(commentId: string, action: ModerationCommentAction, init?: RequestInit) {
    return fetch(workerUrl(`/moderation/comments/${commentId}/action`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      body: JSON.stringify({ action }),
      ...init,
    });
  },
  report(
    input: { targetType: "post" | "comment"; targetId: string; reason: string; details?: string },
    init?: RequestInit,
  ) {
    const { targetType, targetId, reason, details } = input;
    return fetch(workerUrl("/moderation/report"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      body: JSON.stringify({
        targetType,
        targetId,
        reason,
        details,
      }),
      ...init,
    });
  },
  listFlaggedPosts(
    options?: { status?: string; limit?: number; offset?: number },
    init?: RequestInit,
  ) {
    const params = new URLSearchParams();
    if (options?.status) {
      params.set("status", options.status);
    }
    if (options?.limit != null) {
      params.set("limit", String(options.limit));
    }
    if (options?.offset != null) {
      params.set("offset", String(options.offset));
    }
    const query = params.toString();
    const url = query
      ? workerUrl(`/moderation/flagged-posts?${query}`)
      : workerUrl("/moderation/flagged-posts");
    return fetch(url, init);
  },
  getPostStatus(postId: string, init?: RequestInit) {
    return fetch(workerUrl(`/moderation/posts/${postId}/status`), init);
  },
  getAuditLog(options?: { limit?: number; offset?: number }, init?: RequestInit) {
    const params = new URLSearchParams();
    if (options?.limit != null) {
      params.set("limit", String(options.limit));
    }
    if (options?.offset != null) {
      params.set("offset", String(options.offset));
    }
    const query = params.toString();
    const url = query ? workerUrl(`/moderation/audit?${query}`) : workerUrl("/moderation/audit");
    return fetch(url, init);
  },
  listReports(
    options?: { status?: string; limit?: number; offset?: number },
    init?: RequestInit,
  ) {
    const params = new URLSearchParams();
    if (options?.status) {
      params.set("status", options.status);
    }
    if (options?.limit != null) {
      params.set("limit", String(options.limit));
    }
    if (options?.offset != null) {
      params.set("offset", String(options.offset));
    }
    const query = params.toString();
    const url = query
      ? workerUrl(`/moderation/reports?${query}`)
      : workerUrl("/moderation/reports");
    return fetch(url, init);
  },
  resolveReport(reportId: string, action: "dismiss" | "quarantine", init?: RequestInit) {
    return fetch(workerUrl(`/moderation/reports/${reportId}/resolve`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      body: JSON.stringify({ action }),
      ...init,
    });
  },
} as const;

export const commentsApi = {
  fetch(postId: string, options?: { limit?: number }, init?: RequestInit) {
    const params = new URLSearchParams();
    if (options?.limit != null) {
      params.set("limit", String(options.limit));
    }
    const query = params.toString();
    const url = query
      ? workerUrl(`/posts/${postId}/comments?${query}`)
      : workerUrl(`/posts/${postId}/comments`);

    return fetch(url, init);
  },
  create(postId: string, body: string, options?: { parentCommentId?: string }, init?: RequestInit) {
    const { headers: initHeaders, ...rest } = init ?? {};
    const payload: Record<string, unknown> = { body };
    if (options?.parentCommentId) {
      payload.parentCommentId = options.parentCommentId;
    }
    return fetch(workerUrl(`/posts/${postId}/comments`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(initHeaders || {}),
      },
      body: JSON.stringify(payload),
      ...rest,
    });
  },
  delete(commentId: string, init?: RequestInit) {
    return fetch(workerUrl(`/comments/${commentId}`), {
      method: "DELETE",
      ...init,
    });
  },
} as const;

// Shared feed post type used by HomePageClient, FeedCard, and Player page.
type FeedCapsule = {
  id: string;
  runner: "client-static" | "webcontainer";
  capabilities?: {
    net?: string[];
    storage?: boolean;
    workers?: boolean;
  };
  params?: unknown[];
  artifactId?: string | null;
};

export type FeedPost = {
  id: string;
  type: "app" | "report";
  title: string;
  description?: string;
  author: {
    id: string;
    handle: string;
    name?: string | null;
    avatarUrl?: string | null;
  };
  capsule?: FeedCapsule | null;
  coverKey?: string | null;
  tags?: string[];
  stats: {
    runs: number;
    comments: number;
    likes: number;
    remixes: number;
  };
  viewer?: {
    liked?: boolean;
    followingAuthor?: boolean;
  };
  createdAt: string;
};

// Map Worker ApiFeedPost payload into the client-side FeedPost shape.
export function mapApiFeedPostToFeedPost(apiPost: ApiFeedPost): FeedPost {
  const capsulePayload = (apiPost.capsule as Record<string, unknown> & { id: string }) || null;
  const capsule: FeedCapsule | null = capsulePayload
    ? {
        id: String(capsulePayload.id),
        runner: (typeof capsulePayload.runner === "string" ? capsulePayload.runner : "client-static") as
          | "client-static"
          | "webcontainer",
        capabilities: capsulePayload.capabilities as FeedCapsule["capabilities"],
        params: Array.isArray(capsulePayload.params) ? (capsulePayload.params as unknown[]) : undefined,
        artifactId:
          capsulePayload.artifactId != null ? String(capsulePayload.artifactId as string | number) : null,
      }
    : null;

  const createdAtValue = apiPost.createdAt;
  let createdAt: string;
  if (typeof createdAtValue === "number") {
    createdAt = new Date(createdAtValue * 1000).toISOString();
  } else {
    const numeric = Number(createdAtValue);
    if (Number.isFinite(numeric)) {
      createdAt = new Date(numeric * 1000).toISOString();
    } else {
      const parsed = new Date(createdAtValue);
      createdAt = Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
    }
  }

  const viewer = apiPost.viewer
    ? {
        liked: apiPost.viewer.liked === true,
        followingAuthor: apiPost.viewer.followingAuthor === true,
      }
    : undefined;

  return {
    id: String(apiPost.id),
    type: apiPost.type === "app" ? "app" : "report",
    title: apiPost.title,
    description: apiPost.description ?? undefined,
    author: {
      id: String(apiPost.author.id),
      handle: apiPost.author.handle,
      name: apiPost.author.name ?? null,
      avatarUrl: apiPost.author.avatarUrl ?? null,
    },
    capsule,
    coverKey: apiPost.coverKey ?? null,
    tags: apiPost.tags ?? [],
    stats: {
      runs: apiPost.stats.runs,
      comments: apiPost.stats.comments,
      likes: apiPost.stats.likes,
      remixes: apiPost.stats.remixes,
    },
    viewer,
    createdAt,
  };
}

export const postsApi = {
  create: async (
    input: {
      title: string;
      description?: string;
      type?: "app" | "report";
      capsuleId?: string | null;
      tags?: string[];
      coverKey?: string | null;
    },
    init?: RequestInit,
  ) => {
    const { title, description, type = "report", capsuleId, tags, coverKey } = input;
    return fetch(workerUrl("/posts"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      body: JSON.stringify({
        title,
        description,
        type,
        capsuleId: capsuleId ?? undefined,
        tags,
        coverKey: coverKey ?? undefined,
      }),
      ...init,
    });
  },
  get(postId: string, init?: RequestInit) {
    return fetch(workerUrl(`/posts/${postId}`), init);
  },
  list(
    params: {
      mode: "latest" | "following" | "foryou";
      limit?: number;
      q?: string;
      tags?: string[];
    },
    init?: RequestInit,
  ) {
    const search = new URLSearchParams();
    search.set("mode", params.mode);
    if (params.limit != null) {
      search.set("limit", String(params.limit));
    }
    if (params.q && params.q.trim()) {
      search.set("q", params.q.trim());
    }
    if (params.tags && params.tags.length > 0) {
      search.set("tags", params.tags.join(","));
    }

    return fetch(workerUrl(`/posts?${search.toString()}`), init);
  },
  like(postId: string, init?: RequestInit) {
    return fetch(workerUrl(`/posts/${postId}/like`), {
      method: "POST",
      ...init,
    });
  },
  unlike(postId: string, init?: RequestInit) {
    return fetch(workerUrl(`/posts/${postId}/like`), {
      method: "DELETE",
      ...init,
    });
  },
} as const;

export const coversApi = {
  upload(file: File, init?: RequestInit) {
    const contentType = file.type || "application/octet-stream";
    return fetch(workerUrl("/covers"), {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        ...(init?.headers || {}),
      },
      body: file,
      ...init,
    });
  },
} as const;

export const usersApi = {
  getProfile(handle: string, init?: RequestInit) {
    return fetch(workerUrl(`/users/${handle}`), init);
  },
  getPosts(handle: string, options?: { limit?: number }, init?: RequestInit) {
    const params = new URLSearchParams();
    if (options?.limit != null) {
      params.set("limit", String(options.limit));
    }
    const query = params.toString();
    const url = query
      ? workerUrl(`/users/${handle}/posts?${query}`)
      : workerUrl(`/users/${handle}/posts`);
    return fetch(url, init);
  },
  checkFollowing(userId: string, targetId: string, init?: RequestInit) {
    return fetch(workerUrl(`/users/${userId}/check-following?targetId=${targetId}`), init);
  },
  follow(userId: string, init?: RequestInit) {
    return fetch(workerUrl(`/users/${userId}/follow`), {
      method: "POST",
      ...init,
    });
  },
  unfollow(userId: string, init?: RequestInit) {
    return fetch(workerUrl(`/users/${userId}/follow`), {
      method: "DELETE",
      ...init,
    });
  },
} as const;

export const notificationsApi = {
  getUnreadCount(init?: RequestInit) {
    return fetch(workerUrl("/notifications/unread-count"), init);
  },
  summary(options?: { limit?: number; offset?: number }, init?: RequestInit) {
    const params = new URLSearchParams();
    if (options?.limit != null) {
      params.set("limit", String(options.limit));
    }
    if (options?.offset != null) {
      params.set("offset", String(options.offset));
    }
    const query = params.toString();
    const url = query ? workerUrl(`/notifications/summary?${query}`) : workerUrl("/notifications/summary");
    return fetch(url, init);
  },
  list(options?: { limit?: number }, init?: RequestInit) {
    const params = new URLSearchParams();
    if (options?.limit != null) {
      params.set("limit", String(options.limit));
    }
    const query = params.toString();
    const url = query ? workerUrl(`/notifications?${query}`) : workerUrl("/notifications");
    return fetch(url, init);
  },
  markRead(notificationIds?: string[], init?: RequestInit) {
    return fetch(workerUrl("/notifications/mark-read"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      body: JSON.stringify({ notificationIds }),
      ...init,
    });
  },
} as const;

export const quotaApi = {
  getUserQuota(init?: RequestInit) {
    return fetch(workerUrl("/user/quota"), init);
  },
} as const;

export const capsulesApi = {
  manifest(capsuleId: string, init?: RequestInit) {
    return fetch(workerUrl(`/capsules/${capsuleId}/manifest`), init);
  },
  bundleSrc(capsuleId: string) {
    return workerUrl(`/capsules/${capsuleId}/bundle`);
  },
  publish(formData: FormData, init?: RequestInit) {
    return fetch(workerUrl("/capsules/publish"), {
      method: "POST",
      body: formData,
      ...init,
    });
  },
  importGithub(input: { url: string; branch?: string }, init?: RequestInit) {
    return fetch(workerUrl("/import/github"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      body: JSON.stringify(input),
      ...init,
    });
  },
} as const;

export const runsApi = {
  complete(
    input: {
      capsuleId: string;
      postId?: string | null;
      runId?: string;
      durationMs?: number;
      status?: "completed" | "failed";
      errorMessage?: string | null;
    },
    init?: RequestInit,
  ) {
    return fetch(workerUrl("/runs/complete"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      body: JSON.stringify(input),
      keepalive: true,
      ...init,
    });
  },
  appendLogs(
    runId: string,
    payload: {
      capsuleId: string;
      postId: string;
      logs: Array<{
        level: string;
        message: string;
        timestamp: number;
        source: string;
        sampleRate: number;
      }>;
    },
    init?: RequestInit,
  ) {
    return fetch(workerUrl(`/runs/${runId}/logs`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      body: JSON.stringify(payload),
      keepalive: true,
      ...init,
    });
  },
} as const;

export const profileApi = {
  get(handle: string, init?: RequestInit) {
    return fetch(workerUrl(`/profile/${encodeURIComponent(handle)}`), init);
  },
  search(query: string, options?: { limit?: number }, init?: RequestInit) {
    const params = new URLSearchParams();
    params.set("q", query);
    if (options?.limit != null) {
      params.set("limit", String(options.limit));
    }
    const queryString = params.toString();
    const url = queryString ? workerUrl(`/profile/search?${queryString}`) : workerUrl("/profile/search");
    return fetch(url, init);
  },
  update: async (payload: UpdateProfilePayload, init?: RequestInit) => {
    return fetch(workerUrl("/profile"), {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      body: JSON.stringify(payload),
      ...init,
    });
  },
} as const;
