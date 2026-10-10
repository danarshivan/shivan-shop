import { DurableObject } from "cloudflare:workers";

export class SyncHub extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/broadcast") {
      let payload;
      try { payload = await request.json(); }
      catch { return new Response("Invalid notification", { status: 400 }); }
      if (payload?.type !== "sync") return new Response("Invalid notification", { status: 400 });
      const message = JSON.stringify({ type: "sync" });
      let delivered = 0;
      for (const socket of this.ctx.getWebSockets()) {
        try { socket.send(message); delivered += 1; }
        catch { try { socket.close(1011, "Sync connection failed"); } catch {} }
      }
      return Response.json({ ok: true, delivered });
    }

    if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket) {
    try { socket.close(1008, "This connection is receive-only"); } catch {}
  }

  async webSocketClose(socket, code, reason) {
    try { socket.close(code, reason); } catch {}
  }
}

export default {
  async fetch() {
    return new Response("Not found", { status: 404 });
  },
};
