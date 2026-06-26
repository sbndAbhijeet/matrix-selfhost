import { getClient, isRoomEncrypted } from "../matrixClient.js";

export async function getMessages({ roomId, limit = 30 }) {
  const client = await getClient();
  const room = client.getRoom(roomId);

  if (!room) {
    return {
      content: [
        {
          type: "text",
          text: `Room "${roomId}" not found. Use list_rooms to see available rooms.`,
        },
      ],
    };
  }

  const encrypted = isRoomEncrypted(room);

  const events = room
    .getLiveTimeline()
    .getEvents()
    .filter((e) => e.getType() === "m.room.message")
    .slice(-limit);

  if (events.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `No messages found in "${room.name}". The timeline may not be fully synced yet.`,
        },
      ],
    };
  }

  let decryptFailures = 0;

  const messages = events.map((e) => {
    const time = new Date(e.getTs()).toLocaleString();
    const sender = e.getSender();

    if (e.isDecryptionFailure()) {
      decryptFailures++;
      return `[${time}] ${sender}: [unable to decrypt — key not yet received]`;
    }

    const content = e.getContent();

    if (content.msgtype === "m.image") {
      return `[${time}] ${sender}: [image: ${content.body}]`;
    }
    if (content.msgtype === "m.file") {
      return `[${time}] ${sender}: [file: ${content.body}]`;
    }
    return `[${time}] ${sender}: ${content.body}`;
  });

  const encNote = encrypted ? " 🔒 (end-to-end encrypted)" : "";
  const header = `📋 Last ${messages.length} messages from "${room.name}"${encNote}:\n\n`;

  const footer =
    decryptFailures > 0
      ? `\n\n⚠️ ${decryptFailures} message(s) could not be decrypted. This usually means the room keys for those messages haven't been shared with this device yet. Messages sent after this device joined will decrypt normally.`
      : "";

  return {
    content: [{ type: "text", text: header + messages.join("\n") + footer }],
  };
}