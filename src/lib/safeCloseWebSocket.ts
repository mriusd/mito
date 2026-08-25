/**
 * Close a browser WebSocket without the common Chrome console noise:
 * "Ping received after close" / "closed before the connection is established"
 * when effects clean up a still-CONNECTING socket (React Strict Mode, rapid market switch).
 */
export function safeCloseWebSocket(ws: WebSocket | null | undefined): void {
  if (!ws) return;
  try {
    ws.onmessage = null;
    ws.onerror = null;
    const state = ws.readyState;
    if (state === WebSocket.CLOSED || state === WebSocket.CLOSING) {
      ws.onopen = null;
      ws.onclose = null;
      return;
    }
    if (state === WebSocket.CONNECTING) {
      const kill = () => {
        try {
          ws.onopen = null;
          ws.onclose = null;
          ws.onerror = null;
          ws.onmessage = null;
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
          }
        } catch {
          /* ignore */
        }
      };
      ws.onopen = kill;
      ws.onerror = kill;
      window.setTimeout(kill, 1500);
      return;
    }
    ws.onopen = null;
    ws.onclose = null;
    ws.close();
  } catch {
    /* ignore */
  }
}
