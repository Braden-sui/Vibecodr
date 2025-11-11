import { auth, currentUser } from "@clerk/nextjs/server";

export async function requireAuth() {
  const { userId } = await auth();
  if (!userId) {
    throw new Error("Unauthorized");
  }
  return userId;
}

export async function getCurrentUser() {
  const user = await currentUser();
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    handle: user.username || `user_${user.id.slice(0, 8)}`,
    name: user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : null,
    avatarUrl: user.imageUrl,
    email: user.emailAddresses[0]?.emailAddress,
  };
}
