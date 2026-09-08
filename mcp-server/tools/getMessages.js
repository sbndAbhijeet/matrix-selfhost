import { getClient, isRoomEncrypted } from "../matrixClient.js";
import { getCachedMessage } from "../cryptoCache.js";

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

  // requests a bit more than the user asked for so we have a buffer
  const fetchLimit = Math.max(limit, 50); // at least 50, or whatever the user asked
  try {
    await client.scrollback(room, fetchLimit);
  } catch (err) {
    console.error(`[getMessages] scrollback failed for ${roomId}:`, err.message);
    //continue anyway with whatever is already in the timeline
  }

  // Now read the timeline (it should contain more messages)
  const events = room
    .getLiveTimeline()
    .getEvents()
    .filter((e) => e.getType() === "m.room.message")
    .slice(-limit); // still respect the limit the user requested

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

  const messages = await Promise.all(
    events.map(async (e) => {
      const time = new Date(e.getTs()).toLocaleString();
      const sender = e.getSender();

      if (e.isDecryptionFailure()) {
        try {
          const cached = await getCachedMessage(e.getId());
          if (cached) {
            const body = cached.body;
            if (cached.msgtype === "m.image") {
              return `[${time}] ${sender}: [image: ${body}] (🔑 decrypted from cache)`;
            }
            if (cached.msgtype === "m.file") {
              return `[${time}] ${sender}: [file: ${body}] (🔑 decrypted from cache)`;
            }
            return `[${time}] ${sender}: ${body} (🔑 decrypted from cache)`;
          }
        } catch (err) {
          // Fall through
        }

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
    })
  );

  const encNote = encrypted ? " 🔒 (end-to-end encrypted)" : "";
  const header = `📋 Last ${messages.length} messages from "${room.name}"${encNote}:\n\n`;

  // tells the user if we got fewer messages than requested
  const truncationNote =
    messages.length < limit
      ? `\n\nNote: Only ${messages.length} messages were available (requested ${limit}). Older history may exist on the server.`
      : "";

  const footer =
    decryptFailures > 0
      ? `\n\n⚠️ ${decryptFailures} message(s) could not be decrypted. This usually means the room keys for those messages haven't been shared with this device yet.`
      : "";

  return {
    content: [
      {
        type: "text",
        text: header + messages.join("\n") + truncationNote + footer,
      },
    ],
  };
}