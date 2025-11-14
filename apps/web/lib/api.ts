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

export const postsApi = {
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
} as const;
