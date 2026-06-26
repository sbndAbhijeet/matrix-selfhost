import { getClient, isRoomEncrypted } from "../matrixClient.js";

export async function searchMessages({ query }) {
  const client = await getClient();
  const rooms = client.getRooms();
  const results = [];
  let encryptedRoomCount = 0;
  let decryptFailures = 0;

  for (const room of rooms) {
    const encrypted = isRoomEncrypted(room);
    if (encrypted) encryptedRoomCount++;

    const events = room.getLiveTimeline().getEvents();

    for (const event of events) {
      if (event.getType() !== "m.room.message") continue;

      if (event.isDecryptionFailure()) {
        decryptFailures++;
        continue;
      }

      const body = event.getContent().body || "";
      if (!body.toLowerCase().includes(query.toLowerCase())) continue;

      results.push({
        room: room.name || room.roomId,
        roomId: room.roomId,
        sender: event.getSender(),
        body,
        time: new Date(event.getTs()).toLocaleString(),
        encrypted,
      });
    }
  }

  if (results.length === 0) {
    const notes = [];
    if (decryptFailures > 0) {
      notes.push(
        `${decryptFailures} message(s) could not be decrypted and were skipped`
      );
    }
    const noteStr = notes.length > 0 ? ` (${notes.join("; ")})` : "";
    return {
      content: [
        {
          type: "text",
          text: `No messages found containing "${query}"${noteStr}.`,
        },
      ],
    };
  }

  const lines = results.map(
    (r) =>
      `[${r.encrypted ? "🔒 " : ""}${r.room}] [${r.time}] ${r.sender}:\n  ${r.body}`
  );

  const footer =
    decryptFailures > 0
      ? `\n\n⚠️ ${decryptFailures} message(s) in encrypted rooms could not be decrypted and were not searched. Messages sent after this device joined will be searchable.`
      : "";

  return {
    content: [
      {
        type: "text",
        text:
          `Found ${results.length} result(s) for "${query}":\n\n` +
          lines.join("\n\n") +
          footer,
      },
    ],
  };
}