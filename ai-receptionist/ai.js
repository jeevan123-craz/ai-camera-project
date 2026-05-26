const { GoogleGenAI } = require("@google/genai");
const calendar = require('./calendar');
require('dotenv').config();

// Explicitly use GEMINI_API_KEY to avoid conflict with GOOGLE_API_KEY system env var
const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY is not set in .env');
const genAI = new GoogleGenAI({ apiKey: GEMINI_KEY });

// In-memory store for conversation history per call
const activeCalls = {};

async function processUserInput(callSid, userInput, language = 'en-US') {
    // Initialize history for this call if it doesn't exist
    if (!activeCalls[callSid]) {
        activeCalls[callSid] = { history: [] };
    }

    // Get current calendar state to inject into system prompt
    const availableSlots = await calendar.getAvailableSlots();

    let systemInstruction = `You are a helpful, professional, and friendly AI receptionist named Alex, assistant of Jeevankishore from MedGuard Clinic.
Your job is to answer incoming patient queries (via WhatsApp or Browser), answer basic questions, and schedule appointments.
Always keep your responses relatively brief, as you are speaking over a phone line or messaging.

Current Available Appointment Slots:
${availableSlots.length > 0 ? availableSlots.join('\n') : 'No slots available right now.'}

Instructions for Booking:
1. If a patient wants to book, ask them for their preferred time from the available slots.
2. Ask the patient for their name.
3. IMPORTANT: You MUST ask the patient for the reason for their visit or their symptoms before confirming.
4. Once you have the time, name, and reason, you must confirm it.
5. TO BOOK THE APPOINTMENT in the system, you MUST include the exact string [BOOK: YYYY-MM-DDTHH:MM:SS|PatientName|Reason] at the very end of your response.
6. Example: "Great, I have booked your appointment for tomorrow for your headache. [BOOK: 2026-05-24T09:00:00|John Doe|Headache]"
7. Do NOT output the [BOOK: ...] tag unless the patient has confirmed the time, name, AND reason.

Sending Information to Phone:
1. If a user asks you to send them confirmation, clinic location, or emergency hotline numbers to their phone, ask for their WhatsApp phone number (with country code).
2. CRITICAL: If the user HAS PROVIDED their phone number (e.g., "+1234567890") in the chat, you MUST append the exact string [SEND_WHATSAPP: <THEIR_NUMBER>] at the very end of your reply.
3. Example: "I have sent the clinic location and emergency details to your WhatsApp. [SEND_WHATSAPP: +1234567890]"
4. Never output the tag if they haven't provided a number yet.`;

    if (language === 'ta-IN') {
        systemInstruction += `\n\nCRITICAL LANGUAGE INSTRUCTION: The user is speaking in Tamil. You MUST respond ENTIRELY in Tamil (தமிழ்) using natural, friendly conversational Tamil. The booking and whatsapp tags must still remain in English exact syntax.`;
    }

    try {
        const chat = genAI.chats.create({
            model: "gemini-2.5-flash-lite",
            config: {
                systemInstruction,
                temperature: 0.7,
            },
            history: activeCalls[callSid].history,
        });

        const response = await chat.sendMessage({ message: userInput });
        const responseText = response.text;

        // Update history
        activeCalls[callSid].history.push({ role: "user",  parts: [{ text: userInput }] });
        activeCalls[callSid].history.push({ role: "model", parts: [{ text: responseText }] });

        return responseText;

    } catch (error) {
        console.error("Error with Gemini API:", error);
        return "I'm sorry, I'm having trouble connecting to my system right now. Could you please call back later?";
    }
}

function clearCallHistory(callSid) {
    delete activeCalls[callSid];
}

module.exports = { processUserInput, clearCallHistory };
