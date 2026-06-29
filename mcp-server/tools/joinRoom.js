import { getClient } from "../matrixClient.js";

/**
 * Joins a Matrix room by its ID or alias.
 * 
 * @param {Object} params
 * @param {string} params.roomIdOrAlias - The ID or alias of the room to join (e.g. #alias:server.com or !roomid:server.com).
 * @returns {Promise<{ roomId: string }>} Resolves with the joined room ID.
 */
export async function joinRoom({ roomIdOrAlias }) {
  const client = await getClient();
  const room = await client.joinRoom(roomIdOrAlias);
  
  // matrix-js-sdk's joinRoom usually resolves to a Room object, but handle raw API response as fallback
  const roomId = room?.roomId || room?.room_id || roomIdOrAlias;
  return { roomId };
}

/**
 * MCP tool wrapper for joining a room.
 */
export async function joinRoomTool({ roomIdOrAlias }) {
  try {
    const result = await joinRoom({ roomIdOrAlias });
    return {
      content: [
        {
          type: "text",
          text: `Successfully joined room: ${result.roomId}`,
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `ERROR: Failed to join room "${roomIdOrAlias}". ${err.message}`,
        },
      ],
    };
  }
}
