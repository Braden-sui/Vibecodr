export function redirectToSignIn(redirectUrl?: string) {
  if (typeof window === "undefined") return;
  const target = redirectUrl ?? `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/sign-in?redirect_url=${encodeURIComponent(target)}`);
}
