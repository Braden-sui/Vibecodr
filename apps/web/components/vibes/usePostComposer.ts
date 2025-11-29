'use client';

import { useCallback, useState, type KeyboardEvent } from "react";
import type { FeedPost } from "@/lib/api";
import { normalizeTag } from "@/lib/tags";

export type VibeType = FeedPost["type"];

export const MAX_TAGS = 3;

export function usePostComposer() {
  const [vibeType, setVibeType] = useState<VibeType>("thought");
  const [isExpanded, setIsExpanded] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const addTag = useCallback((raw: string) => {
    const normalized = normalizeTag(raw);
    if (!normalized) {
      setTagInput("");
      return;
    }

    setSelectedTags((prev) => {
      if (prev.includes(normalized) || prev.length >= MAX_TAGS) {
        return prev;
      }
      return [...prev, normalized];
    });
    setTagInput("");
  }, []);

  const removeTag = useCallback((tag: string) => {
    setSelectedTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  const handleTagKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" || event.key === "," || event.key === " ") {
        event.preventDefault();
        addTag(tagInput);
      }
    },
    [addTag, tagInput],
  );

  const clearTags = useCallback(() => {
    setSelectedTags([]);
    setTagInput("");
  }, []);

  const resetPost = useCallback(() => {
    setIsExpanded(false);
    setTitle("");
    setDescription("");
    setLinkUrl("");
    clearTags();
  }, [clearTags]);

  return {
    vibeType,
    setVibeType,
    isExpanded,
    setIsExpanded,
    title,
    setTitle,
    description,
    setDescription,
    linkUrl,
    setLinkUrl,
    tagInput,
    setTagInput,
    selectedTags,
    addTag,
    removeTag,
    handleTagKeyDown,
    clearTags,
    resetPost,
  };
}
