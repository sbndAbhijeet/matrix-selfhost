import * as sdk from "matrix-js-sdk";
import "dotenv/config";

import {summarizeChatContext} from "./summarize.js";

const baseUrl = "http://localhost:8008";


const client = sdk.createClient({baseUrl});

async function loginAndInit() {
  const loginResponse = await client.login("m.login.password", {
    user: process.env.BOT_USER,
    password: process.env.BOT_PASSWORD,
  });

  console.log("Logged in as:", loginResponse.user_id);

  
  await registerBotListener();
  client.startClient();
}

function extractRecentMessages(room, limit = 20) {
    return room.timeline
        .filter(e => e.getType() === 'm.room.message')
        .map(e => ({
            sender: e.getSender(),
            body: e.getContent().body,
            timestamp: new Date(e.getTs()).toISOString()
        }))
        .filter(m => m.body && !m.body.startsWith("/summarize"))
        .slice(-limit);
}

function formatMessagesForSummary(messages) {
    return messages
        .map(m => `${m.sender}:${m.body}`)
        .join("\n");
}

async function handleSummarizeCommand(room){
    const messages = extractRecentMessages(room);
    const cleanText = formatMessagesForSummary(messages);

    const summary = cleanText
        ? await summarizeChatContext(cleanText)
        : "No recent messages found to summarize.";
    
    await client.sendTextMessage(room.roomId, `Summary:\n${summary}`);
}

async function registerBotListener() {
    // Auto-join when invited
    client.on("RoomMember.membership", async (event, member) => {
        if (member.membership === "invite" && member.userId === client.getUserId()) {
        try {
            console.log(`Invited to ${member.roomId}, joining...`);
            await client.joinRoom(member.roomId);
            console.log(`Joined room ${member.roomId}`);
        } catch (err) {
            console.error("Failed to auto-join:", err);
        }
        }
    });


    //handle messages
    client.on("Room.timeline", async (event, room, toStartOfTimeline) => {
        if (toStartOfTimeline) return;
        if(event.getType() !== "m.room.message") return;

        const sender = event.getSender();
        const body = event.getContent().body;

        //ignoring bot own messages
        if(sender === process.env.BOT_USER) return;

        //ignoring older commands
        const eventAgeMs = Date.now() - event.getTs();
        if (eventAgeMs > 5000) return;

        if(body === "/summarize"){
            console.log("Summarize command received in room:", room.name);
            try {
                await handleSummarizeCommand(room);
            } catch (error) {
                console.error("Error handling summarize command:", error);
                await client.sendTextMessage(room.roomId, "Sorry, I couldn't summarize the room right now.");
            }
        }
    });

    client.once("sync", (state) => {
        if (state === "PREPARED") {
            console.log("Bot listener is ready.");
        }
    });

    await client.startClient();
}

await loginAndInit();