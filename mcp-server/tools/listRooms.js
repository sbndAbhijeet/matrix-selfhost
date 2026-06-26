import { getClient, isRoomEncrypted } from "../matrixClient.js";

export async function listRooms() {
  try {
    const client = await getClient();
    const rooms = client.getRooms();

    const result = rooms.map((room) => ({
      roomId: room.roomId,
      name: room.name || room.roomId,
      memberCount: room.getJoinedMemberCount(),
      encrypted: isRoomEncrypted(room),
      topic:
        room.currentState
          .getStateEvents("m.room.topic", "")
          ?.getContent()?.topic || null,
    }));

    result.sort((a, b) => Number(a.encrypted) - Number(b.encrypted));

    const lines = result.map(
      (r) =>
        `${r.encrypted ? "🔒 [ENCRYPTED]" : "✅ [UNENCRYPTED]"} ${r.name} (${r.roomId}) — ${r.memberCount} members${r.topic ? ` | Topic: ${r.topic}` : ""}`
    );

    return {
      content: [{ type: "text", text: lines.join("\n") }],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `ERROR: ${err.message}\n\nStack: ${err.stack}`,
        },
      ],
    };
  }
}