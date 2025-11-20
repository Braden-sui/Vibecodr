import { describe, it, expect } from "vitest";
import { isModeratorOrAdmin, type AuthenticatedUser } from "../../src/auth";

function makeUser(claims: Partial<AuthenticatedUser["claims"]>): AuthenticatedUser {
  const baseClaims: AuthenticatedUser["claims"] = {
    iss: "https://clerk.example",
    sub: "user-1",
    exp: Math.floor(Date.now() / 1000) + 3600,
  } as AuthenticatedUser["claims"];

  return {
    userId: "user-1",
    sessionId: "session-1",
    claims: {
      ...baseClaims,
      ...claims,
    },
  };
}

describe("isModeratorOrAdmin", () => {
  it("returns true for role=admin", () => {
    const user = makeUser({ role: "admin" });
    expect(isModeratorOrAdmin(user)).toBe(true);
  });

  it("returns true for role=moderator", () => {
    const user = makeUser({ role: "moderator" });
    expect(isModeratorOrAdmin(user)).toBe(true);
  });

  it("returns true for isModerator flag on claims", () => {
    const user = makeUser({ isModerator: true });
    expect(isModeratorOrAdmin(user)).toBe(true);
  });

  it("returns true for role in public_metadata", () => {
    const user = makeUser({ public_metadata: { role: "admin" } });
    expect(isModeratorOrAdmin(user)).toBe(true);
  });

  it("returns true for isModerator in public_metadata", () => {
    const user = makeUser({ public_metadata: { isModerator: true } });
    expect(isModeratorOrAdmin(user)).toBe(true);
  });

  it("returns false for normal user", () => {
    const user = makeUser({});
    expect(isModeratorOrAdmin(user)).toBe(false);
  });
});
