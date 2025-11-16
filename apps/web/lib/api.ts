// Tiny API client for the Worker API. Consider centralizing auth headers here later.

type ModerationPostAction = "quarantine" | "remove";

type ModerationCommentAction = "remove";

export const moderationApi = {
  moderatePost(postId: string, action: ModerationPostAction) {
    return fetch(`/api/moderation/posts/${postId}/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action }),
    });
  },
  moderateComment(commentId: string, action: ModerationCommentAction) {
    return fetch(`/api/moderation/comments/${commentId}/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action }),
    });
  },
  report(input: { targetType: "post" | "comment"; targetId: string; reason: string; details?: string }) {
    const { targetType, targetId, reason, details } = input;
    return fetch("/api/moderation/report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        targetType,
        targetId,
        reason,
        details,
      }),
    });
  },
} as const;

export const commentsApi = {
  fetch(postId: string, options?: { limit?: number }) {
    const params = new URLSearchParams();
    if (options?.limit != null) {
      params.set("limit", String(options.limit));
    }
    const query = params.toString();
    const url = query
      ? `/api/posts/${postId}/comments?${query}`
      : `/api/posts/${postId}/comments`;

    return fetch(url);
  },
  create(postId: string, body: string) {
    return fetch(`/api/posts/${postId}/comments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    });
  },
  delete(commentId: string) {
    return fetch(`/api/comments/${commentId}`, {
      method: "DELETE",
    });
  },
} as const;

// Shared feed post type used by HomePageClient, FeedCard, and Player page.
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
  capsule?: {
    id: string;
    // Runner and capabilities are derived from capsule manifest_json in the Worker.
    runner: "client-static" | "webcontainer";
    capabilities?: {
      net?: string[];
      storage?: boolean;
      workers?: boolean;
    };
    params?: unknown[];
    artifactId?: string | null;
  } | null;
  coverKey?: string | null;
  tags?: string[];
  stats: {
    runs: number;
    comments: number;
    likes: number;
    remixes: number;
  };
  createdAt: string;
};

type ApiFeedPostCapsule = {
  id?: string | number;
  runner?: "client-static" | "webcontainer" | string;
  capabilities?: {
    net?: string[];
    storage?: boolean;
    workers?: boolean;
  };
  params?: unknown[];
  artifactId?: string | number | null;
} | null;

export type ApiFeedPostPayload = {
  id: string | number;
  type?: "app" | "report" | string;
  title?: string;
  description?: string | null;
  author?: {
    id?: string | number;
    handle?: string;
    name?: string | null;
    avatarUrl?: string | null;
  };
  capsule?: ApiFeedPostCapsule;
  coverKey?: string | null;
  tags?: string[] | null;
  stats?: {
    runs?: number;
    comments?: number;
    likes?: number;
    remixes?: number;
  };
  createdAt?: number | string;
};

// Map Worker ApiFeedPost payload into the client-side FeedPost shape.
export function mapApiFeedPostToFeedPost(apiPost: ApiFeedPostPayload): FeedPost {
  const capsule = apiPost.capsule
    ? {
        id: String(apiPost.capsule.id),
        runner: (apiPost.capsule.runner || "client-static") as "client-static" | "webcontainer",
        capabilities: apiPost.capsule.capabilities,
        params: apiPost.capsule.params,
        artifactId:
          apiPost.capsule.artifactId != null
            ? String(apiPost.capsule.artifactId)
            : null,
      }
    : null;

  const createdAtValue = apiPost.createdAt;
  const createdAt = typeof createdAtValue === "number"
    ? new Date(createdAtValue * 1000).toISOString()
    : String(createdAtValue ?? "");

  return {
    id: String(apiPost.id),
    type: apiPost.type === "app" ? "app" : "report",
    title: String(apiPost.title ?? ""),
    description: apiPost.description ?? undefined,
    author: {
      id: String(apiPost.author?.id ?? ""),
      handle: String(apiPost.author?.handle ?? ""),
      name: apiPost.author?.name ?? null,
      avatarUrl: apiPost.author?.avatarUrl ?? null,
    },
    capsule,
    coverKey: apiPost.coverKey ?? null,
    tags: Array.isArray(apiPost.tags) ? apiPost.tags : [],
    stats: {
      runs: Number(apiPost.stats?.runs ?? 0),
      comments: Number(apiPost.stats?.comments ?? 0),
      likes: Number(apiPost.stats?.likes ?? 0),
      remixes: Number(apiPost.stats?.remixes ?? 0),
    },
    createdAt,
  };
}

export const postsApi = {
  create(input: {
    title: string;
    description?: string;
    type?: "app" | "report";
    capsuleId?: string | null;
    tags?: string[];
    coverKey?: string | null;
  }) {
    const { title, description, type = "report", capsuleId, tags, coverKey } = input;
    return fetch("/api/posts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title,
        description,
        type,
        capsuleId: capsuleId ?? undefined,
        tags,
        coverKey: coverKey ?? undefined,
      }),
    });
  },
  get(postId: string) {
    return fetch(`/api/posts/${postId}`);
  },
  list(params: {
    mode: "latest" | "following" | "foryou";
    limit?: number;
    q?: string;
    tags?: string[];
  }) {
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

    return fetch(`/api/posts?${search.toString()}`);
  },
  like(postId: string) {
    return fetch(`/api/posts/${postId}/like`, {
      method: "POST",
    });
  },
  unlike(postId: string) {
    return fetch(`/api/posts/${postId}/like`, {
      method: "DELETE",
    });
  },
} as const;

export const coversApi = {
  upload(file: File) {
    const contentType = file.type || "application/octet-stream";
    return fetch("/api/covers", {
      method: "POST",
      headers: {
        "Content-Type": contentType,
      },
      body: file,
    });
  },
} as const;

export const usersApi = {
  getProfile(handle: string) {
    return fetch(`/api/users/${handle}`);
  },
  getPosts(handle: string, options?: { limit?: number }) {
    const params = new URLSearchParams();
    if (options?.limit != null) {
      params.set("limit", String(options.limit));
    }
    const query = params.toString();
    const url = query
      ? `/api/users/${handle}/posts?${query}`
      : `/api/users/${handle}/posts`;
    return fetch(url);
  },
  checkFollowing(userId: string, targetId: string) {
    return fetch(`/api/users/${userId}/check-following?targetId=${targetId}`);
  },
  follow(userId: string) {
    return fetch(`/api/users/${userId}/follow`, {
      method: "POST",
    });
  },
  unfollow(userId: string) {
    return fetch(`/api/users/${userId}/follow`, {
      method: "DELETE",
    });
  },
} as const;

export const notificationsApi = {
  getUnreadCount() {
    return fetch("/api/notifications/unread-count");
  },
  summary(options?: { limit?: number; offset?: number }) {
    const params = new URLSearchParams();
    if (options?.limit != null) {
      params.set("limit", String(options.limit));
    }
    if (options?.offset != null) {
      params.set("offset", String(options.offset));
    }
    const query = params.toString();
    const url = query ? `/api/notifications/summary?${query}` : "/api/notifications/summary";
    return fetch(url);
  },
  list(options?: { limit?: number }) {
    const params = new URLSearchParams();
    if (options?.limit != null) {
      params.set("limit", String(options.limit));
    }
    const query = params.toString();
    const url = query ? `/api/notifications?${query}` : "/api/notifications";
    return fetch(url);
  },
  markRead(notificationIds?: string[]) {
    return fetch("/api/notifications/mark-read", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ notificationIds }),
    });
  },
} as const;

export const quotaApi = {
  getUserQuota() {
    return fetch("/api/user/quota");
  },
} as const;

export const capsulesApi = {
  manifest(capsuleId: string) {
    return fetch(`/api/capsules/${capsuleId}/manifest`);
  },
  bundleSrc(capsuleId: string) {
    return `/api/capsules/${capsuleId}/bundle`;
  },
  publish(formData: FormData) {
    return fetch("/api/capsules/publish", {
      method: "POST",
      body: formData,
    });
  },
  importGithub(input: { url: string; branch?: string }) {
    return fetch("/api/import/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
  },
  importZip(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    return fetch("/api/import/zip", {
      method: "POST",
      body: formData,
    });
  },
} as const;
