import { Response } from "express";
import crypto from "crypto";

class SSEManager {
  private clients: Map<string, Response> = new Map();

  addClient(res: Response): string {
    const clientId = crypto.randomUUID();

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    res.write(`data: ${JSON.stringify({ type: "connected", clientId })}\n\n`);

    this.clients.set(clientId, res);

    res.on("close", () => {
      this.clients.delete(clientId);
    });

    return clientId;
  }

  broadcast(event: { type: string; data: unknown }) {
    const message = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
    for (const [, client] of this.clients) {
      client.write(message);
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }
}

export const sseManager = new SSEManager();
