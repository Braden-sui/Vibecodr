import { useCallback } from "react";
import { useAuth } from "@clerk/clerk-react";

export function redirectToSignIn(redirectUrl?: string) {
  if (typeof window === "undefined") return;
  const target = redirectUrl ?? `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/sign-in?redirect_url=${encodeURIComponent(target)}`);
}

/**
 * Build RequestInit with Authorization header for authenticated API calls.
 * Returns undefined if no token is available.
 *
 * @param getToken - Clerk's getToken function from useAuth()
 * @returns RequestInit with Authorization header, or undefined if not authenticated
 */
export async function buildAuthInit(
  getToken: ReturnType<typeof useAuth>["getToken"]
): Promise<RequestInit | undefined> {
  if (typeof getToken !== "function") return undefined;
  const token = await getToken({ template: "workers" });
  if (!token) return undefined;
  return {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };
}

/**
 * Hook that returns a memoized buildAuthInit function.
 * Use this in components to avoid recreating the function on every render.
 *
 * @example
 * const buildAuthInit = useBuildAuthInit();
 * const init = await buildAuthInit();
 * const response = await someApi.call(init);
 */
export function useBuildAuthInit(): () => Promise<RequestInit | undefined> {
  const { getToken } = useAuth();

  return useCallback(async (): Promise<RequestInit | undefined> => {
    return buildAuthInit(getToken);
  }, [getToken]);
}
