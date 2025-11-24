import { useEffect } from "react";

export type PageMeta = {
  title?: string;
  description?: string;
  url?: string;
  image?: string;
  type?: string;
  siteName?: string;
  oEmbedUrl?: string;
  canonicalUrl?: string;
};

type ElementAttrs = Record<string, string>;

function upsertElement(tagName: "meta" | "link", attrs: ElementAttrs): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }

  const head = document.head || document.getElementsByTagName("head")[0];

  let existing: HTMLMetaElement | HTMLLinkElement | null = null;
  if (tagName === "meta") {
    if (attrs.property) {
      existing = head.querySelector(`meta[property="${attrs.property}"]`);
    } else if (attrs.name) {
      existing = head.querySelector(`meta[name="${attrs.name}"]`);
    }
  } else if (tagName === "link") {
    if (attrs.rel === "canonical") {
      existing = head.querySelector('link[rel="canonical"]');
    } else if (attrs.rel === "alternate" && attrs.type === "application/json+oembed") {
      existing = head.querySelector('link[rel="alternate"][type="application/json+oembed"]');
    }
  }

  const element = existing ?? (document.createElement(tagName) as HTMLMetaElement | HTMLLinkElement);
  const previous: Record<string, string | null> = {};

  for (const [key, value] of Object.entries(attrs)) {
    previous[key] = element.getAttribute(key);
    element.setAttribute(key, value);
  }

  if (!existing) {
    head.appendChild(element);
  }

  return () => {
    if (!existing) {
      if (element.parentNode === head) {
        head.removeChild(element);
      }
      return;
    }

    for (const [key, value] of Object.entries(previous)) {
      if (value === null) {
        element.removeAttribute(key);
      } else {
        element.setAttribute(key, value);
      }
    }
  };
}

export function usePageMeta(meta: PageMeta) {
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const cleanups: Array<() => void> = [];
    const previousTitle = document.title;
    const siteName = meta.siteName ?? "Vibecodr";
    const description = meta.description ? meta.description.slice(0, 320) : undefined;
    const ogType = meta.type ?? "website";

    if (meta.title) {
      document.title = meta.title;
      cleanups.push(upsertElement("meta", { property: "og:title", content: meta.title }));
      cleanups.push(upsertElement("meta", { name: "twitter:title", content: meta.title }));
    }

    cleanups.push(upsertElement("meta", { property: "og:site_name", content: siteName }));
    cleanups.push(upsertElement("meta", { property: "og:type", content: ogType }));

    if (description) {
      cleanups.push(upsertElement("meta", { name: "description", content: description }));
      cleanups.push(upsertElement("meta", { property: "og:description", content: description }));
      cleanups.push(upsertElement("meta", { name: "twitter:description", content: description }));
    }

    if (meta.url) {
      cleanups.push(upsertElement("meta", { property: "og:url", content: meta.url }));
    }

    if (meta.image) {
      cleanups.push(upsertElement("meta", { property: "og:image", content: meta.image }));
      cleanups.push(upsertElement("meta", { name: "twitter:image", content: meta.image }));
    }

    const twitterCard = meta.image ? "summary_large_image" : "summary";
    cleanups.push(upsertElement("meta", { name: "twitter:card", content: twitterCard }));

    if (meta.canonicalUrl) {
      cleanups.push(upsertElement("link", { rel: "canonical", href: meta.canonicalUrl }));
    }

    if (meta.oEmbedUrl) {
      cleanups.push(
        upsertElement("link", {
          rel: "alternate",
          type: "application/json+oembed",
          href: meta.oEmbedUrl,
        })
      );
    }

    return () => {
      cleanups.forEach((cleanup) => cleanup());
      if (meta.title) {
        document.title = previousTitle;
      }
    };
  }, [
    meta.title,
    meta.description,
    meta.url,
    meta.image,
    meta.type,
    meta.siteName,
    meta.oEmbedUrl,
    meta.canonicalUrl,
  ]);
}
