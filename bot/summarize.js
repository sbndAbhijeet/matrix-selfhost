import OpenAI from "openai";
import "dotenv/config";

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export async function summarizeChatContext(cleanText) {
    const res = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages:[
            {
                role: "system",
                content: "Summarize Matrix room chat briefly with key points and action items."
            },
            {
                role: "user",
                content: cleanText
            }
        ]
    });

    return res.choices[0].message.content;
}