const { GoogleGenAI } = require("@google/genai");
require('dotenv').config();

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function listModels() {
    try {
        const response = await genAI.models.list();
        const models = response;
        for await (const model of response) {
            console.log(model.name, model.displayName);
        }
    } catch (e) {
        console.error("Error:", e);
    }
}

listModels();
