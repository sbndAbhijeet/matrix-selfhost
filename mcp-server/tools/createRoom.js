import { getClient } from "../matrixClient.js";

/**
 * Creates a new Matrix room.
 * 
 * @param {Object} params
 * @param {string} [params.name] - The name of the room.
 * @param {string} [params.topic] - The topic of the room.
 * @param {string} [params.visibility] - The visibility of the room ('public' or 'private').
 * @param {string[]} [params.invite] - An array of user IDs to invite to the room.
 * @param {boolean} [params.isEncrypted] - Whether to enable end-to-end encryption on the room.
 * @returns {Promise<{ roomId: string }>} Resolves with the created room ID.
 */
export async function createRoom({ name, topic, visibility, invite, isEncrypted = false }) {
  const client = await getClient();
  
  const options = {};
  if (name) options.name = name;
  if (topic) options.topic = topic;
  if (invite) options.invite = invite;
  
  if (visibility) {
    options.visibility = visibility;
    options.preset = visibility === "public" ? "public_chat" : "private_chat";
  }

  if (isEncrypted) {
    options.initial_state = [
      {
        type: "m.room.encryption",
        state_key: "",
        content: {
          algorithm: "m.megolm.v1.aes-sha2",
        },
      },
    ];
  }

  const response = await client.createRoom(options);
  return { roomId: response.room_id };
}

/**
 * MCP tool wrapper for creating a room.
 */
export async function createRoomTool({ name, topic, visibility, invite, isEncrypted }) {
  try {
    const result = await createRoom({ name, topic, visibility, invite, isEncrypted });
    const encStr = isEncrypted ? " (encrypted)" : "";
    return {
      content: [
        {
          type: "text",
          text: `Successfully created room${encStr}: ${result.roomId}`,
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `ERROR: Failed to create room. ${err.message}`,
        },
      ],
    };
  }
}
