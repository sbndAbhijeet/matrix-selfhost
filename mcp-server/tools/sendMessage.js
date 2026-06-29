import { getClient } from "../matrixClient.js";

/**
 * Sends a message to a Matrix room.
 * Supports both plain text and HTML formatting.
 * 
 * @param {Object} params
 * @param {string} params.roomId - The ID of the room to send the message to.
 * @param {string} params.body - The plain text body of the message.
 * @param {string} [params.formattedBody] - Optional HTML formatted body of the message.
 * @returns {Promise<{ eventId: string }>} Resolves with the event ID.
 */
export async function sendMessage({ roomId, body, formattedBody }) {
  const client = await getClient();
  const room = client.getRoom(roomId);
  if (!room) {
    throw new Error(`Room "${roomId}" not found.`);
  }

  const content = {
    msgtype: "m.text",
    body: body,
  };

  if (formattedBody) {
    content.format = "org.matrix.custom.html";
    content.formatted_body = formattedBody;
  }

  const response = await client.sendMessage(roomId, content);
  return { eventId: response.event_id };
}

/**
 * MCP tool wrapper for sending a message.
 */
export async function sendMessageTool({ roomId, body, formattedBody }) {
  try {
    const result = await sendMessage({ roomId, body, formattedBody });
    return {
      content: [
        {
          type: "text",
          text: `Message sent successfully. Event ID: ${result.eventId}`,
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `ERROR: ${err.message}`,
        },
      ],
    };
  }
}
