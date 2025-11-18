import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import securityHeaders from "./securityHeaders";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/post/:id",
  "/profile/:handle",
  "/u/:handle",
  "/player/:postId",
]);

const { applySecurityHeaders, EMBED_PATH_PREFIX } = securityHeaders;

function isEmbedRoute(pathname: string): boolean {
  return pathname === EMBED_PATH_PREFIX || pathname.startsWith(`${EMBED_PATH_PREFIX}/`);
}

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }

  const embedRequest = isEmbedRoute(request.nextUrl.pathname);
  const response = NextResponse.next();

  applySecurityHeaders(response, { allowEmbedding: embedRequest });

  if (embedRequest) {
    response.headers.delete("X-Frame-Options");
  } else {
    response.headers.set("X-Frame-Options", "DENY");
  }

  return response;
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
