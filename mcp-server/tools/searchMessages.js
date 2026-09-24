import { getClient, isRoomEncrypted } from "../matrixClient.js";
import { getCachedMessage } from "../cryptoCache.js";

const MAX_RESULTS = 100;
const PAGE_SIZE = 50;

export async function searchMessages({ query }) {
  if (typeof query !== "string" || !query.trim()) {
    return { content: [{ type: "text", text: "Enter a non-empty search query." }] };
  }

  const client = await getClient();
  const rooms = client.getRooms();
  const byId = new Map(rooms.map((room) => [room.roomId, room]));
  const plainRooms = rooms.filter((room) => !isRoomEncrypted(room));
  const encryptedRooms = rooms.filter(isRoomEncrypted);
  const results = [];
  const notes = [];

  if (plainRooms.length) {
    const body = {
      search_categories: {
        room_events: {
          search_term: query,
          order_by: "recent",
          filter: {
            rooms: plainRooms.map((room) => room.roomId),
            types: ["m.room.message"],
            limit: PAGE_SIZE,
          },
        },
      },
    };
    let nextBatch;
    try {
      for (let page = 0; page < 5; page++) {
        const response = await client.search({ body, ...(nextBatch ? { next_batch: nextBatch } : {}) });
        const found = response.search_categories.room_events;
        for (const match of found.results || []) {
          const event = match.result;
          const room = byId.get(event.room_id);
          if (!room || isRoomEncrypted(room) || event.type !== "m.room.message") continue;
          results.push({
            room: room.name || room.roomId,
            roomId: room.roomId,
            eventId: event.event_id,
            sender: event.sender,
            body: event.content?.body || "",
            timeMs: event.origin_server_ts,
            encrypted: false,
          });
        }
        if (!found.next_batch) break;
        if (found.next_batch === nextBatch || !(found.results || []).length) {
          notes.push("Server search pagination stopped making progress; results may be incomplete.");
          break;
        }
        nextBatch = found.next_batch;
        if (page === 4) notes.push("Server search has more matches; showing the first five pages.");
      }
    } catch (err) {
      console.error("[searchMessages] Server search failed:", err.message);
      notes.push(`Server search failed: ${err.message}. Unencrypted history was not fully searched.`);
    }
  }

  let decryptFailures = 0;
  for (const room of encryptedRooms) {
    for (const event of room.getLiveTimeline().getEvents()) {
      if (event.getType() !== "m.room.message") continue;
      let body;
      let fromCache = false;
      if (event.isDecryptionFailure()) {
        try {
          const cached = await getCachedMessage(event.getId());
          body = cached?.body;
          fromCache = !!cached;
        } catch (err) {
          console.error("[searchMessages] Cache lookup failed:", err.message);
        }
        if (!body) {
          decryptFailures++;
          continue;
        }
      } else {
        body = event.getContent()?.body;
      }
      if (!body?.toLowerCase().includes(query.toLowerCase())) continue;
      results.push({
        room: room.name || room.roomId,
        roomId: room.roomId,
        eventId: event.getId(),
        sender: event.getSender(),
        body: fromCache ? `${body} (🔑 decrypted from cache)` : body,
        timeMs: event.getTs(),
        encrypted: true,
      });
    }
  }

  if (encryptedRooms.length) {
    notes.push(`Encrypted search covered only loaded events in ${encryptedRooms.length} room(s); older encrypted history may be missing.`);
  }
  if (decryptFailures) notes.push(`${decryptFailures} loaded encrypted message(s) could not be decrypted and were skipped.`);

  const unique = [...new Map(results.map((result) => [result.eventId, result])).values()]
    .sort((a, b) => b.timeMs - a.timeMs);
  if (unique.length > MAX_RESULTS) notes.push(`Showing ${MAX_RESULTS} of ${unique.length} matches found in searched pages.`);
  const lines = unique.slice(0, MAX_RESULTS).map((result) =>
    `[${result.encrypted ? "🔒 " : ""}${result.room}] [${new Date(result.timeMs).toLocaleString()}] ${result.sender}:\n  ${result.body}`
  );
  const header = unique.length
    ? `Found ${unique.length} result(s) in searched history for "${query}":\n\n${lines.join("\n\n")}`
    : `No matches in searched history for "${query}".`;
  return { content: [{ type: "text", text: header + (notes.length ? `\n\n⚠️ ${notes.join(" ")}` : "") }] };
}
