"use client";
import { useEffect, useState } from "react";
import { SignUpPoster } from "./SignUpPoster";

/**
 * The sign-up poster on the event page (2026-10-24): the same poster the
 * organizer prints from Registration (`SignUpPoster`), pointed at the same
 * entry link. The link is made whole from the address the page was opened on,
 * after it has loaded, so the server and the browser draw the same thing first.
 */
export function EventEntryPoster({ path, name, when, where }: { path: string; name: string; when: string; where: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    setUrl(new URL(path, window.location.origin).toString());
  }, [path]);
  if (!url) return null;
  return <SignUpPoster url={url} name={name} when={when} where={where} />;
}
