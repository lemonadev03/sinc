"use client";

import { useState } from "react";

declare global {
  interface Window {
    MusicKit?: {
      configure: (config: { developerToken: string }) => Promise<MusicKitInstance>;
      getInstance: () => MusicKitInstance;
    };
  }
}

interface MusicKitInstance {
  authorize: () => Promise<{ musicUserToken: string }>;
}

const MUSICKIT_SRC = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";

export function AppleConnectButton({ disabled }: { disabled?: boolean }) {
  const [state, setState] = useState<"idle" | "loading" | "authorizing" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setState("loading");
    setError(null);
    try {
      const tokenRes = await fetch("/api/apple/developer-token");
      if (!tokenRes.ok) {
        const body = (await tokenRes.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "could not get developer token");
      }
      const { developerToken } = (await tokenRes.json()) as { developerToken: string };

      await loadMusicKit();
      const instance = await window.MusicKit!.configure({ developerToken });

      setState("authorizing");
      const { musicUserToken } = await instance.authorize();

      const res = await fetch("/api/apple/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ musicUserToken }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Apple Music connection was rejected");
      }
      window.location.href = "/onboarding?connected=apple";
    } catch (err) {
      setState("error");
      setError((err as Error).message);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" className="btn-primary" disabled={disabled || state !== "idle" && state !== "error"} onClick={() => void connect()}>
        {state === "idle" && "Connect Apple Music"}
        {state === "loading" && "Loading MusicKit…"}
        {state === "authorizing" && "Authorize in the popup…"}
        {state === "error" && "Try again"}
      </button>
      {error && <p className="max-w-xs text-right text-xs text-red-400">{error}</p>}
    </div>
  );
}

function loadMusicKit(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.MusicKit) return resolve();
    const script = document.createElement("script");
    script.src = MUSICKIT_SRC;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("failed to load MusicKit JS"));
    document.body.appendChild(script);
  });
}
