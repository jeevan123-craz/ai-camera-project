const { GoogleGenAI } = require("@google/genai");
require('dotenv').config();

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function testModel(modelName) {
    try {
        console.log(`Testing model: ${modelName}`);
        const response = await genAI.models.generateContent({
            model: modelName,
            contents: "say hello",
        });
        console.log(`Success with ${modelName}:`, response.text);
        return true;
    } catch (e) {
        console.error(`Error with ${modelName}:`, e.message);
        return false;
    }
}

async function runTests() {
    const modelsToTest = ["gemini-2.5-flash", "gemini-flash-latest", "gemini-2.0-flash", "gemini-2.0-flash-lite"];
    for (const model of modelsToTest) {
        await testModel(model);
    }
}

runTests();
