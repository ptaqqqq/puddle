// server-only module
import { WebSocketServer, WebSocket } from 'ws';

let wss: WebSocketServer | null = null;

export function initWSSOnPort(port = 3000) {
  if (wss) return wss; // singleton

  wss = new WebSocketServer({ port });
  wss.on('connection', (ws) => {
    ws.on('message', (msg) => {
      // naive broadcast
      for (const client of wss!.clients) {
        if (client.readyState === WebSocket.OPEN) client.send(msg.toString());
      }
    });
  });

  console.log(`[ws] listening on ws://localhost:${port}`);

  // allow Vite HMR to dispose cleanly
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      wss?.close();
      wss = null;
    });
  }

  return wss;
}
