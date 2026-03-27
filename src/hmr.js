import { WebSocketServer } from "ws";

export function createHMRServer({ port = 3001 } = {}) {
  const clients = new Set();
  const wss = new WebSocketServer({ port });

  wss.on("connection", (ws) => {
    clients.add(ws);

    ws.on("close", () => {
      clients.delete(ws);
    });
  });

  function broadcast(message) {
    const data = JSON.stringify(message);

    for (const client of clients) {
      if (client.readyState === 1) {
        client.send(data);
      }
    }
  }

  function close() {
    for (const client of clients) {
      client.close();
    }
    wss.close();
  }

  return {
    port,
    wss,
    broadcast,
    close
  };
}
