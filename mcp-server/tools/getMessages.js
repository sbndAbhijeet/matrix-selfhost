import { getClient, isRoomEncrypted } from "../matrixClient.js";
import { getCachedMessage } from "../cryptoCache.js";

export async function getMessages({ roomId, limit = 30 }) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    return { content: [{ type: "text", text: "limit must be an integer from 1 to 200." }] };
  }

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

  const messageEvents = () => room.getLiveTimeline().getEvents()
    .filter((e) => e.getType() === "m.room.message");

  let historyProblem = null;
  // scrollback() fetches at most one page; a page may also contain non-message events.
  for (let page = 0; messageEvents().length < limit && room.oldState.paginationToken !== null; page++) {
    if (page === 20) {
      historyProblem = "Stopped after 20 history pages; older messages may exist.";
      break;
    }
    const beforeCount = room.getLiveTimeline().getEvents().length;
    const beforeToken = room.oldState.paginationToken;
    try {
      await client.scrollback(room, 50);
    } catch (err) {
      console.error(`[getMessages] scrollback failed for ${roomId}:`, err.message);
      historyProblem = `History fetch failed: ${err.message}`;
      break;
    }
    if (room.getLiveTimeline().getEvents().length === beforeCount &&
        room.oldState.paginationToken === beforeToken) {
      historyProblem = "History fetch made no progress; older messages may exist.";
      break;
    }
  }

  const events = messageEvents().slice(-limit);

  if (events.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: historyProblem
            ? `No messages loaded in "${room.name}". ${historyProblem}`
            : `No messages found in "${room.name}".`,
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
  const header = `📋 ${historyProblem ? "Available" : "Last"} ${messages.length} messages from "${room.name}"${encNote}:\n\n`;

  // tells the user if we got fewer messages than requested
  const truncationNote =
    historyProblem
      ? `\n\n⚠️ Incomplete history: ${historyProblem} Requested ${limit}, loaded ${messages.length}.`
      : messages.length < limit
        ? `\n\nNote: Reached the beginning of available room history (${messages.length} messages; requested ${limit}).`
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
