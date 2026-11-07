import { WebSocketServer } from "ws";
import {
  DEFAULT_SERVER_PORT,
  type ClientMessage,
  type ServerMessage,
} from "@tma/shared";

const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);

// Bind to loopback only: this server is meant for the local machine.
const wss = new WebSocketServer({ host: "127.0.0.1", port });

wss.on("listening", () => {
  console.log(`[server] listening on ws://127.0.0.1:${port}`);
});

wss.on("connection", (socket) => {
  console.log("[server] client connected");

  socket.on("message", (raw) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      const error: ServerMessage = { type: "error", message: "Invalid JSON" };
      socket.send(JSON.stringify(error));
      return;
    }
    console.log("[server] received", message.type);
  });

  socket.on("close", () => console.log("[server] client disconnected"));
});

const shutdown = () => {
  wss.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
