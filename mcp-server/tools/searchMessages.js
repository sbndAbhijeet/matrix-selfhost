import { getClient, isRoomEncrypted } from "../matrixClient.js";

export async function searchMessages({ query }) {
  const client = await getClient();
  const rooms = client.getRooms();
  const results = [];
  let encryptedSkipped = 0;

  for (const room of rooms) {
    if (isRoomEncrypted(room)) {
      encryptedSkipped++;
      continue; // skip silently, report at end
    }

    for (const event of room.timeline) {
      if (event.getType() !== "m.room.message") continue;
      const body = event.getContent().body || "";
      if (!body.toLowerCase().includes(query.toLowerCase())) continue;

      results.push({
        room: room.name || room.roomId,
        roomId: room.roomId,
        sender: event.getSender(),
        body,
        time: new Date(event.getTs()).toLocaleString(),
      });
    }
  }

  if (results.length === 0) {
    const skipNote = encryptedSkipped > 0 ? ` (${encryptedSkipped} encrypted rooms were skipped)` : "";
    return {
      content: [{ type: "text", text: `No messages found containing "${query}"${skipNote}.` }],
    };
  }

  const lines = results.map(
    (r) => `[${r.room}] [${r.time}] ${r.sender}:\n  ${r.body}`
  );

  const footer = encryptedSkipped > 0
    ? `\n\n⚠️ ${encryptedSkipped} encrypted room(s) were skipped — their messages cannot be searched.`
    : "";

  return {
    content: [{ type: "text", text: `Found ${results.length} result(s) for "${query}":\n\n${lines.join("\n\n")}${footer}` }],
  };
}
