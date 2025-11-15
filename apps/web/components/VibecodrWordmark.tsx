"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

const TARGET_TEXT = "Vibecodr";
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function scrambleChar(char: string) {
  if (char === " ") {
    return " ";
  }
  return LETTERS.charAt(Math.floor(Math.random() * LETTERS.length));
}

export function VibecodrWordmark() {
  const [displayText, setDisplayText] = useState(TARGET_TEXT);
  const frameRef = useRef<number | null>(null);
  const progressRef = useRef(0);

  const stopAnimation = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const runAnimation = useCallback(() => {
    const progress = progressRef.current;
    const chars = TARGET_TEXT.split("").map((char, index) => {
      if (index < progress) return char;
      return scrambleChar(char);
    });
    setDisplayText(chars.join(""));

    // Slow the animation down to ~40% of the original speed.
    progressRef.current = Math.min(TARGET_TEXT.length, progress + 0.12);
    if (progressRef.current >= TARGET_TEXT.length) {
      stopAnimation();
      setDisplayText(TARGET_TEXT);
      return;
    }

    frameRef.current = requestAnimationFrame(runAnimation);
  }, [stopAnimation]);

  const handleMouseEnter = () => {
    stopAnimation();
    progressRef.current = 0;
    frameRef.current = requestAnimationFrame(runAnimation);
  };

  useEffect(() => () => stopAnimation(), [stopAnimation]);

  return (
    <Link
      href="/"
      className="text-xl font-bold tracking-tight transition-colors hover:text-primary"
      onMouseEnter={handleMouseEnter}
      aria-label="Vibecodr home"
    >
      {displayText}
    </Link>
  );
}
