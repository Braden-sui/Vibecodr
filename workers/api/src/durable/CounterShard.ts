const JSON_HEADERS = { "content-type": "application/json" };
const DEFAULT_FLUSH_MS = 5000;
const FLUSH_BACKOFF_MS = 1000;

type CounterRequest =
  | {
      op: "incrementPost";
      postId: string;
      likesDelta?: number;
      commentsDelta?: number;
      runsDelta?: number;
      remixesDelta?: number;
      shadow?: boolean;
    }
  | {
      op: "incrementUser";
      userId: string;
      followersDelta?: number;
      followingDelta?: number;
      postsDelta?: number;
      runsDelta?: number;
      remixesDelta?: number;
      shadow?: boolean;
    }
  | { op: "flush" };

type PostDelta = {
  likes: number;
  comments: number;
  runs: number;
  remixes: number;
  dirty: boolean;
};

type UserDelta = {
  followers: number;
  following: number;
  posts: number;
  runs: number;
  remixes: number;
  dirty: boolean;
};

export class CounterShard {
  private posts = new Map<string, PostDelta>();
  private users = new Map<string, UserDelta>();
  private nextFlushAt = Date.now() + DEFAULT_FLUSH_MS;

  constructor(private readonly state: DurableObjectState, private readonly env: any) {}

  async fetch(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204 });
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

    let body: CounterRequest;
    try {
      body = (await req.json()) as CounterRequest;
    } catch {
      return new Response(JSON.stringify({ error: "invalid json" }), { status: 400, headers: JSON_HEADERS });
    }

    switch (body.op) {
      case "incrementPost": {
        const postId = typeof body.postId === "string" && body.postId.length > 0 ? body.postId : null;
        if (!postId) {
          return new Response(JSON.stringify({ error: "postId required" }), { status: 400, headers: JSON_HEADERS });
        }

        const likes = toNumber(body.likesDelta);
        const comments = toNumber(body.commentsDelta);
        const runs = toNumber(body.runsDelta);
        const remixes = toNumber(body.remixesDelta);
        if (likes === 0 && comments === 0 && runs === 0 && remixes === 0) {
          return new Response(JSON.stringify({ error: "no deltas provided" }), { status: 400, headers: JSON_HEADERS });
        }

        if (body.shadow === true) {
          return new Response(JSON.stringify({ ok: true, shadow: true }), { status: 202, headers: JSON_HEADERS });
        }

        const current = this.posts.get(postId) ?? { likes: 0, comments: 0, runs: 0, remixes: 0, dirty: false };
        const next: PostDelta = {
          likes: current.likes + likes,
          comments: current.comments + comments,
          runs: current.runs + runs,
          remixes: current.remixes + remixes,
          dirty: true,
        };
        this.posts.set(postId, next);
        this.scheduleFlush();
        return new Response(JSON.stringify({ ok: true }), { status: 202, headers: JSON_HEADERS });
      }
      case "incrementUser": {
        const userId = typeof body.userId === "string" && body.userId.length > 0 ? body.userId : null;
        if (!userId) {
          return new Response(JSON.stringify({ error: "userId required" }), { status: 400, headers: JSON_HEADERS });
        }

        const followers = toNumber(body.followersDelta);
        const following = toNumber(body.followingDelta);
        const posts = toNumber(body.postsDelta);
        const runs = toNumber(body.runsDelta);
        const remixes = toNumber(body.remixesDelta);
        if (followers === 0 && following === 0 && posts === 0 && runs === 0 && remixes === 0) {
          return new Response(JSON.stringify({ error: "no deltas provided" }), { status: 400, headers: JSON_HEADERS });
        }

        if (body.shadow === true) {
          return new Response(JSON.stringify({ ok: true, shadow: true }), { status: 202, headers: JSON_HEADERS });
        }

        const current = this.users.get(userId) ?? {
          followers: 0,
          following: 0,
          posts: 0,
          runs: 0,
          remixes: 0,
          dirty: false,
        };
        const next: UserDelta = {
          followers: current.followers + followers,
          following: current.following + following,
          posts: current.posts + posts,
          runs: current.runs + runs,
          remixes: current.remixes + remixes,
          dirty: true,
        };
        this.users.set(userId, next);
        this.scheduleFlush();
        return new Response(JSON.stringify({ ok: true }), { status: 202, headers: JSON_HEADERS });
      }
      case "flush": {
        await this.flush();
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: JSON_HEADERS });
      }
      default:
        return new Response(JSON.stringify({ error: "unsupported op" }), { status: 400, headers: JSON_HEADERS });
    }
  }

  async alarm(): Promise<void> {
    await this.flush();
  }

  private scheduleFlush() {
    const now = Date.now();
    if (now >= this.nextFlushAt) {
      this.nextFlushAt = now + DEFAULT_FLUSH_MS;
    }
    this.state.storage.setAlarm(this.nextFlushAt).catch(() => {});
  }

  private async flush(): Promise<void> {
    const db = (this.env as any)?.DB as D1Database | undefined;
    if (!db) {
      console.error("E-VIBECODR-2142 counter shard missing DB binding", {
        shard: safeShardId(this.state),
      });
      this.scheduleRetry();
      return;
    }

    const statements: D1PreparedStatement[] = [];
    let postCount = 0;
    let userCount = 0;

    for (const [postId, delta] of this.posts) {
      if (!delta.dirty) continue;
      const { sql, binds } = buildPostUpdate(delta, postId);
      if (sql) {
        statements.push(db.prepare(sql).bind(...binds));
        postCount += 1;
      }
    }

    for (const [userId, delta] of this.users) {
      if (!delta.dirty) continue;
      const { sql, binds } = buildUserUpdate(delta, userId);
      if (sql) {
        statements.push(db.prepare(sql).bind(...binds));
        userCount += 1;
      }
    }

    if (statements.length === 0) {
      this.nextFlushAt = Date.now() + DEFAULT_FLUSH_MS;
      this.state.storage.setAlarm(this.nextFlushAt).catch(() => {});
      return;
    }

    const start = Date.now();
    try {
      await db.batch(statements);
      this.resetDeltas();
      const durationMs = Date.now() - start;
      console.info("E-VIBECODR-2141 counter shard flushed", {
        shard: safeShardId(this.state),
        posts: postCount,
        users: userCount,
        statements: statements.length,
        durationMs,
      });
      this.nextFlushAt = Date.now() + DEFAULT_FLUSH_MS;
      this.state.storage.setAlarm(this.nextFlushAt).catch(() => {});
    } catch (err) {
      console.error("E-VIBECODR-2140 counter shard flush failed", {
        shard: safeShardId(this.state),
        error: err instanceof Error ? err.message : String(err),
        statements: statements.length,
        posts: postCount,
        users: userCount,
      });
      this.scheduleRetry();
    }
  }

  private resetDeltas() {
    for (const [postId, delta] of this.posts) {
      if (!delta.dirty) continue;
      this.posts.set(postId, { likes: 0, comments: 0, runs: 0, remixes: 0, dirty: false });
    }
    for (const [userId, delta] of this.users) {
      if (!delta.dirty) continue;
      this.users.set(userId, { followers: 0, following: 0, posts: 0, runs: 0, remixes: 0, dirty: false });
    }
  }

  private scheduleRetry() {
    const next = Date.now() + FLUSH_BACKOFF_MS;
    this.nextFlushAt = next;
    this.state.storage.setAlarm(next).catch(() => {});
  }
}

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function buildPostUpdate(delta: PostDelta, postId: string): { sql: string | null; binds: Array<string | number> } {
  const sets: string[] = [];
  const binds: Array<string | number> = [];

  if (delta.likes !== 0) {
    sets.push("likes_count = MAX(likes_count + ?, 0)");
    binds.push(delta.likes);
  }
  if (delta.comments !== 0) {
    sets.push("comments_count = MAX(comments_count + ?, 0)");
    binds.push(delta.comments);
  }
  if (delta.runs !== 0) {
    sets.push("runs_count = MAX(runs_count + ?, 0)");
    binds.push(delta.runs);
  }
  if (delta.remixes !== 0) {
    sets.push("remixes_count = MAX(remixes_count + ?, 0)");
    binds.push(delta.remixes);
  }

  if (sets.length === 0) {
    return { sql: null, binds: [] };
  }

  binds.push(postId);
  return {
    sql: `UPDATE posts SET ${sets.join(", ")} WHERE id = ?`,
    binds,
  };
}

function buildUserUpdate(delta: UserDelta, userId: string): { sql: string | null; binds: Array<string | number> } {
  const sets: string[] = [];
  const binds: Array<string | number> = [];

  if (delta.followers !== 0) {
    sets.push("followers_count = MAX(followers_count + ?, 0)");
    binds.push(delta.followers);
  }
  if (delta.following !== 0) {
    sets.push("following_count = MAX(following_count + ?, 0)");
    binds.push(delta.following);
  }
  if (delta.posts !== 0) {
    sets.push("posts_count = MAX(posts_count + ?, 0)");
    binds.push(delta.posts);
  }
  if (delta.runs !== 0) {
    sets.push("runs_count = MAX(runs_count + ?, 0)");
    binds.push(delta.runs);
  }
  if (delta.remixes !== 0) {
    sets.push("remixes_count = MAX(remixes_count + ?, 0)");
    binds.push(delta.remixes);
  }

  if (sets.length === 0) {
    return { sql: null, binds: [] };
  }

  binds.push(userId);
  return {
    sql: `UPDATE users SET ${sets.join(", ")} WHERE id = ?`,
    binds,
  };
}

function safeShardId(state: DurableObjectState): string {
  try {
    // DurableObjectId implements toString()
    return String((state as any)?.id ?? "unknown");
  } catch {
    return "unknown";
  }
}
