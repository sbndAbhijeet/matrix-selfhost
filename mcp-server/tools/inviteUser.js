import { getClient } from "../matrixClient.js";

/**
 * Invites a user to a Matrix room.
 * 
 * @param {Object} params
 * @param {string} params.roomId - The ID of the room.
 * @param {string} params.userId - The ID of the user to invite (e.g. @user:server.com).
 * @returns {Promise<{ success: boolean }>}
 */
export async function inviteUser({ roomId, userId }) {
  const client = await getClient();
  await client.invite(roomId, userId);
  return { success: true };
}

/**
 * MCP tool wrapper for inviting a user to a room.
 */
export async function inviteUserTool({ roomId, userId }) {
  try {
    await inviteUser({ roomId, userId });
    return {
      content: [
        {
          type: "text",
          text: `Successfully invited user ${userId} to room ${roomId}`,
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `ERROR: Failed to invite user "${userId}" to room "${roomId}". ${err.message}`,
        },
      ],
    };
  }
}
