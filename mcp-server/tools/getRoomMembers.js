import { getClient } from "../matrixClient.js";

/**
 * Retrieves the list of members in a Matrix room.
 * 
 * @param {Object} params
 * @param {string} params.roomId - The ID of the room.
 * @returns {Promise<Array<{ userId: string, displayName: string, membership: string, powerLevel: number }>>}
 */
export async function getRoomMembers({ roomId }) {
  const client = await getClient();
  const room = client.getRoom(roomId);
  if (!room) {
    throw new Error(`Room "${roomId}" not found.`);
  }

  const members = room.getMembers();
  return members.map((m) => ({
    userId: m.userId,
    displayName: m.name || m.userId,
    membership: m.membership,
    powerLevel: m.powerLevel,
  }));
}

/**
 * MCP tool wrapper for listing room members, formatted as a markdown table.
 */
export async function getRoomMembersTool({ roomId }) {
  try {
    const members = await getRoomMembers({ roomId });

    if (members.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No members found in room "${roomId}".`,
          },
        ],
      };
    }

    // Sort members: joined first, then by power level descending, then by display name
    members.sort((a, b) => {
      const aJoined = a.membership === "join" ? 1 : 0;
      const bJoined = b.membership === "join" ? 1 : 0;
      if (aJoined !== bJoined) {
        return bJoined - aJoined; // Joined members first
      }
      if (b.powerLevel !== a.powerLevel) {
        return b.powerLevel - a.powerLevel; // Higher power level first
      }
      return a.displayName.localeCompare(b.displayName);
    });

    const header = `### Members of Room: ${roomId}\n\n`;
    const tableHeader = `| User ID | Display Name | Membership | Power Level |\n| :--- | :--- | :--- | :--- |\n`;
    const rows = members.map(
      (m) =>
        `| ${m.userId} | ${m.displayName} | \`${m.membership}\` | ${m.powerLevel} |`
    );

    return {
      content: [
        {
          type: "text",
          text: header + tableHeader + rows.join("\n"),
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
