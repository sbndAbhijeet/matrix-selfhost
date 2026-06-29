import { getClient } from "../matrixClient.js";

/**
 * Leaves a Matrix room.
 * 
 * @param {Object} params
 * @param {string} params.roomId - The ID of the room to leave.
 * @returns {Promise<{ success: boolean }>}
 */
export async function leaveRoom({ roomId }) {
  const client = await getClient();
  await client.leaveRoom(roomId);
  return { success: true };
}

/**
 * MCP tool wrapper for leaving a room.
 */
export async function leaveRoomTool({ roomId }) {
  try {
    await leaveRoom({ roomId });
    return {
      content: [
        {
          type: "text",
          text: `Successfully left room: ${roomId}`,
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `ERROR: Failed to leave room "${roomId}". ${err.message}`,
        },
      ],
    };
  }
}
