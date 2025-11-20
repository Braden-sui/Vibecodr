#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PHASE_PRODUCTION_BUILD } = require("next/constants");
const loadConfig = require("next/dist/server/config").default;
const { buildCustomRoute } = require("next/dist/lib/build-custom-route");
const { normalizeAppPath } = require("next/dist/shared/lib/router/utils/app-paths");
const { isDynamicRoute } = require("next/dist/shared/lib/router/utils/is-dynamic");
const sortPages = require("next/dist/shared/lib/router/utils/sorted-routes").default;
const { getNamedRouteRegex } = require("next/dist/shared/lib/router/utils/route-regex");
const { normalizeRouteRegex } = require("next/dist/lib/load-custom-routes");
const appRouterHeaders = require("next/dist/client/components/app-router-headers");
const {
  RSC_PREFETCH_SUFFIX,
  RSC_SEGMENT_SUFFIX,
  RSC_SEGMENTS_DIR_SUFFIX,
  RSC_SUFFIX,
} = require("next/dist/lib/constants");

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const buildArgs = process.argv.slice(2);
  await runNextBuild(buildArgs);
  await ensureRoutesManifest();
}

async function runNextBuild(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [require.resolve("next/dist/bin/next"), "build", ...args],
      {
        cwd: projectRoot,
        stdio: "inherit",
        env: process.env,
      },
    );
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`next build exited with code ${code}`));
      }
    });
  });
}

async function ensureRoutesManifest() {
  const config = await loadConfig(PHASE_PRODUCTION_BUILD, projectRoot);
  const distDir = path.join(projectRoot, config.distDir ?? ".next");
  const manifestPath = path.join(distDir, "routes-manifest.json");

  console.log(`[debug] distDir: ${distDir}`);
  console.log(`[debug] manifestPath: ${manifestPath}`);

  if (existsSync(manifestPath)) {
    console.log(`[debug] routes-manifest.json exists at ${manifestPath}`);
    // Nothing to do: Next.js produced the manifest as usual.
    return;
  }
  console.log(`[debug] routes-manifest.json does NOT exist. Generating...`);


  const [pagesManifest, appPathsManifest] = await Promise.all([
    readJsonIfExists(path.join(distDir, "server", "pages-manifest.json")),
    readJsonIfExists(path.join(distDir, "server", "app-paths-manifest.json")),
  ]);

  const routeSet = new Set();
  for (const key of Object.keys(pagesManifest)) {
    const normalized = normalizePagesRoute(key);
    if (normalized) {
      routeSet.add(normalized);
    }
  }
  for (const key of Object.keys(appPathsManifest)) {
    const normalized = normalizeAppPath(key);
    if (normalized) {
      routeSet.add(normalized);
    }
  }

  const reservedPages = new Set(["/_app", "/_document", "/_error"]);
  const sortedRoutes = sortPages([...routeSet]);
  const staticRoutes = [];
  const dynamicRoutes = [];

  for (const route of sortedRoutes) {
    if (!route || reservedPages.has(route)) {
      continue;
    }
    const entry = toRouteEntry(route);
    if (isDynamicRoute(route)) {
      dynamicRoutes.push({ ...entry, sourcePage: undefined });
    } else {
      staticRoutes.push(entry);
    }
  }

  const rewrites = await resolveRewrites(config);
  const redirects = await resolveRedirects(config);
  const headers = await resolveHeaders(config);

  const manifest = {
    version: 3,
    pages404: true,
    basePath: config.basePath ?? "",
    redirects,
    rewrites,
    headers,
    staticRoutes,
    dynamicRoutes,
    dataRoutes: [],
    i18n: config.i18n
      ? {
          domains: config.i18n.domains,
          locales: config.i18n.locales,
          defaultLocale: config.i18n.defaultLocale,
          localeDetection: config.i18n.localeDetection,
        }
      : undefined,
    rsc: {
      header: appRouterHeaders.RSC_HEADER,
      didPostponeHeader: appRouterHeaders.NEXT_DID_POSTPONE_HEADER,
      contentTypeHeader: appRouterHeaders.RSC_CONTENT_TYPE_HEADER,
      varyHeader: "RSC, Next-Router-State-Tree, Next-Router-Prefetch",
      prefetchHeader: appRouterHeaders.NEXT_ROUTER_PREFETCH_HEADER,
      suffix: RSC_SUFFIX,
      prefetchSuffix: RSC_PREFETCH_SUFFIX,
      prefetchSegmentHeader: appRouterHeaders.NEXT_ROUTER_SEGMENT_PREFETCH_HEADER,
      prefetchSegmentDirSuffix: RSC_SEGMENTS_DIR_SUFFIX,
      prefetchSegmentSuffix: RSC_SEGMENT_SUFFIX,
    },
    rewriteHeaders: {
      pathHeader: appRouterHeaders.NEXT_REWRITTEN_PATH_HEADER,
      queryHeader: appRouterHeaders.NEXT_REWRITTEN_QUERY_HEADER,
    },
    skipMiddlewareUrlNormalize: Boolean(config.skipMiddlewareUrlNormalize),
    caseSensitive: Boolean(config.experimental?.caseSensitiveRoutes),
  };

  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(
    `[ensure-routes-manifest] created ${path.relative(projectRoot, manifestPath).replace(/\\/g, "/")}`,
  );
}

async function readJsonIfExists(targetPath) {
  try {
    const data = await fs.readFile(targetPath, "utf8");
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

function normalizePagesRoute(route) {
  if (!route) return null;
  if (!route.startsWith("/")) {
    route = `/${route}`;
  }
  if (route === "/index") {
    return "/";
  }
  return route;
}

function toRouteEntry(page) {
  const routeRegex = getNamedRouteRegex(page, { prefixRouteKeys: true });
  return {
    page,
    regex: normalizeRouteRegex(routeRegex.re.source),
    routeKeys: routeRegex.routeKeys,
    namedRegex: routeRegex.namedRegex,
    sourcePage: undefined,
  };
}

async function resolveRewrites(config) {
  const rawRewrites = typeof config.rewrites === "function" ? await config.rewrites() : config.rewrites;
  const convert = (items = []) => items.map((item) => buildCustomRoute("rewrite", item));

  if (!rawRewrites) {
    return { beforeFiles: [], afterFiles: [], fallback: [] };
  }

  if (Array.isArray(rawRewrites)) {
    return {
      beforeFiles: [],
      afterFiles: convert(rawRewrites),
      fallback: [],
    };
  }

  return {
    beforeFiles: convert(rawRewrites.beforeFiles),
    afterFiles: convert(rawRewrites.afterFiles),
    fallback: convert(rawRewrites.fallback),
  };
}

async function resolveRedirects(config) {
  const redirects = typeof config.redirects === "function" ? await config.redirects() : config.redirects;
  if (!redirects?.length) return [];

  const restrictedPaths = ["/_next"].map((p) => (config.basePath ? `${config.basePath}${p}` : p));
  return redirects.map((redirect) => buildCustomRoute("redirect", redirect, restrictedPaths));
}

async function resolveHeaders(config) {
  const headers = typeof config.headers === "function" ? await config.headers() : config.headers;
  if (!headers?.length) return [];
  return headers.map((header) => buildCustomRoute("header", header));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
