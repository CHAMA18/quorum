"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A text-only Napster WebSocket session.
 *
 * The server mints the session and returns a short-lived URL. This hook opens
 * that socket, streams assistant text into the panel, and tears the session
 * down when the panel asks it to. It never sees the Napster API key.
 */

export type NapsterSessionStatus = "idle" | "connecting" | "live" | "closed" | "error";

export interface NapsterSessionMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

export interface NapsterConnectResult {
  ok: boolean;
  error?: string;
  cancelled?: boolean;
}

type SessionResponse = {
  session?: {
    url?: string;
    connectionId?: string;
    expiresAt?: string | null;
  };
  error?: string;
  code?: string;
};

type MessageFrame = {
  type?: string;
  role?: string;
  action?: string;
  item_id?: string;
  response_id?: string;
  content?: string;
  error?: unknown;
};

type ServerEvent = {
  event?: string;
  data?: {
    message?: MessageFrame;
    error?: { message?: string };
    disconnect_after?: number;
  };
};

const MAX_MESSAGE = 8_000;
const OPEN_TIMEOUT_MS = 15_000;

export function useNapsterSession() {
  const [status, setStatus] = useState<NapsterSessionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<NapsterSessionMessage[]>([]);

  const socketRef = useRef<WebSocket | null>(null);
  const intentionalCloseRef = useRef(false);
  const attemptRef = useRef(0);
  const sequenceRef = useRef(0);

  const upsertAssistant = useCallback((id: string, content: string, replace: boolean) => {
    const text = content.slice(0, MAX_MESSAGE);
    if (!text) return;
    setMessages((prev) => {
      const index = prev.findIndex((message) => message.id === id);
      if (index === -1) {
        return [...prev, { id, role: "assistant", text }];
      }
      const next = prev.slice();
      next[index] = {
        ...next[index],
        text: replace ? text : `${next[index].text}${text}`.slice(0, MAX_MESSAGE),
      };
      return next;
    });
  }, []);

  const close = useCallback(() => {
    attemptRef.current += 1;
    intentionalCloseRef.current = true;
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket && socket.readyState <= WebSocket.OPEN) {
      try {
        socket.close();
      } catch {
        /* already closed */
      }
    }
    setBusy(false);
    setStatus("idle");
  }, []);

  const connect = useCallback(async (): Promise<NapsterConnectResult> => {
    const attempt = ++attemptRef.current;
    const previous = socketRef.current;
    socketRef.current = null;
    if (previous) {
      previous.onclose = null;
      previous.onerror = null;
      try {
        previous.close();
      } catch {
        /* already closed */
      }
    }
    intentionalCloseRef.current = false;

    setMessages([]);
    setError(null);
    setNotice(null);
    setBusy(false);
    setStatus("connecting");

    let response: Response;
    try {
      response = await fetch("/api/napster/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
    } catch {
      if (attempt !== attemptRef.current) return { ok: false, cancelled: true };
      const message = "The Napster session could not be requested.";
      setStatus("error");
      setError(message);
      return { ok: false, error: message };
    }

    if (attempt !== attemptRef.current) return { ok: false, cancelled: true };
    const body = (await response.json().catch(() => ({}))) as SessionResponse;
    if (attempt !== attemptRef.current) return { ok: false, cancelled: true };
    const url = body.session?.url;
    if (!response.ok || typeof url !== "string" || !url) {
      const message = (body.error ?? "Napster did not start a session.").trim();
      setStatus("error");
      setError(message);
      return { ok: false, error: message };
    }

    return await new Promise<NapsterConnectResult>((resolve) => {
      let settled = false;
      let timeout = 0;
      const settle = (result: NapsterConnectResult) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        if (!result.ok && result.error) {
          setStatus("error");
          setError(result.error);
        }
        resolve(result);
      };

      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch {
        settle({ ok: false, error: "The browser could not open the Napster session." });
        return;
      }
      socketRef.current = socket;

      timeout = window.setTimeout(() => {
        try {
          socket.close();
        } catch {
          /* already closed */
        }
        if (attempt !== attemptRef.current) {
          settle({ ok: false, cancelled: true });
          return;
        }
        settle({ ok: false, error: "Napster did not open the session in time." });
      }, OPEN_TIMEOUT_MS);

      socket.onopen = () => {
        if (attempt !== attemptRef.current) {
          try {
            socket.close();
          } catch {
            /* already closed */
          }
          settle({ ok: false, cancelled: true });
          return;
        }
        if (settled) {
          try {
            socket.close();
          } catch {
            /* already closed */
          }
          return;
        }
        setStatus("live");
        settle({ ok: true });
      };

      socket.onerror = () => {
        if (attempt !== attemptRef.current) {
          settle({ ok: false, cancelled: true });
          return;
        }
        if (!settled) {
          settle({ ok: false, error: "The browser could not reach the Napster session." });
        } else {
          setNotice("The Napster connection reported an error.");
        }
      };

      socket.onclose = () => {
        if (attempt !== attemptRef.current) {
          settle({ ok: false, cancelled: true });
          return;
        }
        socketRef.current = null;
        setBusy(false);
        if (intentionalCloseRef.current) {
          setStatus("idle");
          return;
        }
        if (!settled) {
          settle({ ok: false, error: "The Napster session closed before it opened." });
          return;
        }
        setStatus((current) => (current === "error" ? "error" : "closed"));
      };

      socket.onmessage = (event) => {
        if (attempt !== attemptRef.current) return;
        let payload: ServerEvent;
        try {
          payload = JSON.parse(String(event.data)) as ServerEvent;
        } catch {
          return;
        }

        if (payload.event === "message_received") {
          const message = payload.data?.message;
          if (!message || message.type === "session") return;
          if (message.role !== "assistant") return;

          const itemId = message.item_id ?? message.response_id;
          if (!itemId) return;
          const turnId = `napster:${itemId}`;

          if (message.action === "delta" && message.content) {
            upsertAssistant(turnId, message.content, false);
            return;
          }
          if (message.action === "completed" && message.content) {
            upsertAssistant(turnId, message.content, true);
            setBusy(false);
            return;
          }
          if (message.action === "cancelled") {
            setBusy(false);
            return;
          }
          if (message.action === "failed") {
            setBusy(false);
            setNotice("The Napster reply could not be completed. Try asking again.");
          }
          return;
        }

        if (payload.event === "session_expired") {
          setBusy(false);
          setStatus("closed");
          setNotice("The Napster session reached its time limit. Start a new one.");
          return;
        }
        if (payload.event === "no_credits_left") {
          setBusy(false);
          setStatus("error");
          setError("The Napster organization has no credits left.");
          return;
        }
        if (payload.event === "provider_connection_aborted") {
          setBusy(false);
          setStatus("error");
          setError(
            payload.data?.error?.message
              ? `Napster could not start the agent: ${payload.data.error.message}`
              : "Napster could not start the agent for this session.",
          );
          return;
        }
        if (payload.event === "reaching_rate_limits") {
          setNotice("Napster is close to its provider rate limit.");
          return;
        }
        if (payload.event === "avatar_connection_warning") {
          setNotice("This Napster session will close if it stays idle.");
        }
      };
    });
  }, [upsertAssistant]);

  const send = useCallback((raw: string) => {
    const text = raw.trim();
    if (!text) return false;
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError("The Napster session is not connected. Start a new one or use Quorum chat.");
      return false;
    }

    sequenceRef.current += 1;
    setMessages((prev) => [
      ...prev,
      { id: `user:${sequenceRef.current}`, role: "user", text: text.slice(0, 2_000) },
    ]);
    try {
      socket.send(
        JSON.stringify({
          type: "send_message",
          data: {
            role: "user",
            text: text.slice(0, 2_000),
            trigger_response: true,
            delay: false,
          },
        }),
      );
    } catch {
      setError("The message could not be sent to Napster.");
      return false;
    }
    setBusy(true);
    setError(null);
    return true;
  }, []);

  useEffect(() => {
    return () => {
      intentionalCloseRef.current = true;
      try {
        socketRef.current?.close();
      } catch {
        /* already closed */
      }
    };
  }, []);

  return {
    status,
    error,
    notice,
    busy,
    messages,
    connect,
    send,
    close,
  };
}
