"use client";

import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

declare global {
  interface Window {
    MusicKit?: {
      configure: (config: { developerToken: string }) => Promise<MusicKitInstance>;
      getInstance: () => MusicKitInstance;
    };
  }
}

interface MusicKitInstance {
  // v3 resolves the Music User Token string directly; some builds wrap it
  authorize: () => Promise<string | { musicUserToken: string }>;
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
        throw new Error(body?.error ?? "Could not get a developer token");
      }
      const { developerToken } = (await tokenRes.json()) as { developerToken: string };

      await loadMusicKit();
      const instance = await window.MusicKit!.configure({ developerToken });

      setState("authorizing");
      const result = await instance.authorize();
      const musicUserToken =
        typeof result === "string" ? result : result?.musicUserToken;
      if (!musicUserToken || musicUserToken.length < 20) {
        throw new Error("Apple did not return a valid token");
      }

      const res = await fetch("/api/apple/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ musicUserToken }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Apple Music rejected the connection");
      }
      window.location.href = "/onboarding?connected=apple";
    } catch (err) {
      setState("error");
      setError((err as Error).message);
    }
  }

  return (
    <VStack gap={1}>
      <Button
        label={
          state === "idle"
            ? "Connect"
            : state === "loading"
              ? "Loading"
              : state === "authorizing"
                ? "Waiting for authorization"
                : "Try again"
        }
        variant="primary"
        isLoading={state === "loading" || state === "authorizing"}
        isDisabled={disabled}
        onClick={() => void connect()}
      />
      {error && <Text type="supporting">{error}</Text>}
    </VStack>
  );
}

function loadMusicKit(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.MusicKit) return resolve();
    const script = document.createElement("script");
    script.src = MUSICKIT_SRC;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load MusicKit"));
    document.body.appendChild(script);
  });
}
