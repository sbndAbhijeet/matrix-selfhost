import { getClient, isRoomEncrypted } from "../matrixClient.js";

export async function getMessages({ roomId, limit = 30 }) {
  const client = await getClient();
  const room = client.getRoom(roomId);

  if (!room) {
    return { content: [{ type: "text", text: `Room "${roomId}" not found. Use list_rooms to see available rooms.` }] };
  }

  // Gracefully block encrypted rooms
  if (isRoomEncrypted(room)) {
    return {
      content: [{
        type: "text",
        text: `🔒 Room "${room.name}" is end-to-end encrypted. I cannot read the messages — they are decrypted only on your Element client, not on the server. This is a known limitation. Encrypted room support is a planned next milestone.`,
      }],
    };
  }

  const messages = room.timeline
    .filter((e) => e.getType() === "m.room.message")
    .slice(-limit)
    .map((e) => {
      const content = e.getContent();
      const time = new Date(e.getTs()).toLocaleString();
      const sender = e.getSender();
      // Handle different message types
      if (content.msgtype === "m.image") {
        return `[${time}] ${sender}: [image: ${content.body}]`;
      }
      if (content.msgtype === "m.file") {
        return `[${time}] ${sender}: [file: ${content.body}]`;
      }
      return `[${time}] ${sender}: ${content.body}`;
    });

  if (messages.length === 0) {
    return { content: [{ type: "text", text: `No messages found in "${room.name}". The timeline may not be fully synced yet.` }] };
  }

  const header = `📋 Last ${messages.length} messages from "${room.name}" (${roomId}):\n\n`;
  return {
    content: [{ type: "text", text: header + messages.join("\n") }],
  };
}
