"use client";
import { useEffect, useState } from "react";

/**
 * What the share and round-code blocks both need from the browser (lifted out of `PlaySettings`, R3-1):
 * the real host a link is built on, whether this phone has a share sheet, and a "Copied" that clears itself.
 * The origin is only known in the browser, so it is read after mount (empty on the server render).
 */
export function useCopy() {
  const [origin, setOrigin] = useState("");
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    // Whether this phone or browser has a share sheet; one that has not copies the message instead.
    setCanShare(typeof navigator.share === "function");
  }, []);

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(""), 1600);
    });
  };

  return { origin, canShare, copied, copy };
}
