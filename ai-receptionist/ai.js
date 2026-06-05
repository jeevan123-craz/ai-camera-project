const { GoogleGenAI } = require("@google/genai");
const calendar = require('./calendar');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const KB_PATH = path.join(__dirname, 'knowledge_base.txt');
let knowledgeBaseText = '';
try {
    knowledgeBaseText = fs.readFileSync(KB_PATH, 'utf-8');
} catch(e) {
    console.error("Could not load knowledge_base.txt");
}

// Explicitly use GEMINI_API_KEY to avoid conflict with GOOGLE_API_KEY system env var
const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY is not set in .env');
const genAI = new GoogleGenAI({ apiKey: GEMINI_KEY });

// In-memory store for conversation history per call
const activeCalls = {};

async function processUserInput(callSid, userInput, language = 'en-US', patientHistory = null) {
    // Initialize history for this call if it doesn't exist
    if (!activeCalls[callSid]) {
        activeCalls[callSid] = { history: [] };
    }

    // Get current calendar state to inject into system prompt
    const availableSlots = await calendar.getAvailableSlots();

    // Map slots to include human-readable time (Asia/Kolkata) to help the AI map user requests to ISO strings
    const formattedSlots = availableSlots.map(slot => {
        const d = new Date(slot);
        const readable = d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
        return `${readable} -> ${slot}`;
    });

    let systemInstruction = `You are a helpful, professional, and friendly AI receptionist named Alex, assistant of Jeevankishore from MedGuard Clinic.
Your job is to answer incoming patient queries (via WhatsApp or Browser), answer basic questions, and schedule appointments.
Always keep your responses brief and concise, as you are speaking over a phone line or messaging. DO NOT be overly talkative.

CLINIC POLICIES & FAQs:
${knowledgeBaseText}

${patientHistory ? `PATIENT HISTORY (RETURNING PATIENT):\nThis patient has visited before. ${patientHistory.lastVisitDate ? 'Last visit on: ' + patientHistory.lastVisitDate + ' for ' + patientHistory.reason + ' with ' + patientHistory.doctor : ''}\nUse this context to greet them warmly back.` : ''}

REDUNDANCY GUARD:
- Do NOT introduce yourself as Alex or Jeevankishore's assistant in every message. You should ONLY introduce yourself in the very first greeting or if explicitly asked who you are.
- In subsequent turns, jump directly into answering the patient's question or helping them with their booking without greeting them by name or repeating your intro.

CLINIC DOCTORS & SPECIALTIES:
- Dr. Sarah Jenkins: General Physician (Fever, cold, flu, general checkups, stomach ache)
- Dr. Michael Chen: Cardiologist (Chest pain, high blood pressure, heart issues)
- Dr. Emily Rodriguez: Dermatologist (Skin rashes, acne, hair loss, moles)
- Dr. David Smith: Orthopedist (Joint pain, fractures, back pain, sports injuries)
- Dr. Priya Patel: Pediatrician (Children's health, vaccinations, child fevers)

DOCTOR SUGGESTION RULES:
- ONLY suggest a doctor if the patient explicitly asks for a recommendation or asks "Which doctor should I see?" or "Who treats [symptom]?". 
- If they just state their symptom and want to book (e.g., "I have a headache, I want to book tomorrow"), DO NOT list doctors. Just proceed with the booking.
- If they do ask, analyze their symptoms and suggest the single most appropriate doctor from the list above.
- If the patient asks "who are available", "who is available today", "who's available", "which doctors are available", or generally asks for a list of available doctors/who is working, you MUST treat this as a request for the doctors list. In this case, you MUST append the exact tag [DOCTORS_CHART] to your response and say something brief like "Here is the list of our available doctors and their specialties:". DO NOT list the doctors in plain text in your response, let the chart handle it.

Current Available Appointment Slots (Readable Time -> Exact ISO String):
${formattedSlots.length > 0 ? formattedSlots.join('\n') : 'No slots available right now.'}

Instructions for Listing Available Slots:
- CRITICAL: Never write out available slot times and dates textually as a bulleted list, text paragraph, or markdown table in your message. Doing so causes the browser to read the long list of times out loud, which is very tedious for the user.
- Instead, you MUST say something brief like: "Please see the available times in the table below and select one:" or "I've loaded the available times below. Please let me know what works for you."
- And you MUST append the exact tag: [TABLE: slot1, slot2, ...] where slot1, slot2, etc. are the exact ISO slot strings available in the system (e.g. [TABLE: 2026-05-29T09:00:00.000Z, 2026-05-29T11:00:00.000Z]).
- This tag will be intercepted by the UI and rendered as a beautiful interactive booking grid.

Instructions for Booking & Symptom Triage:
1. If a patient wants to book, ask them for their preferred time from the available slots and their name.
2. IMPORTANT (TRIAGE): You MUST ask the patient for the reason for their visit or their symptoms. If they provide symptoms (like "stomach pain"), ask 2-3 quick follow-up triage questions (e.g., "How long have you had it?"). Ask them quickly and concisely.
3. Once you have the time, name, reason, and triage answers, confirm the appointment briefly.
4. TO BOOK, you MUST include the exact ISO string of the slot in the format [BOOK: <ISO_STRING>|PatientName|TriageSummary|DoctorName] at the very end of your response. (If no specific doctor is requested, leave it blank or default to General Physician).
5. Example: "Great, I've booked your appointment for your headache. [BOOK: 2026-05-24T09:00:00.000Z|John Doe|Headache for 3 days|Dr. Sarah Jenkins]"
6. Do NOT output the [BOOK: ...] tag unless the patient has confirmed the time, name, AND reason.

Instructions for Cancellations & Rescheduling:
1. If a patient wants to cancel an appointment, ask for the name they used to book. Then append [CANCEL: PatientName] at the end of your response. Example: "I have cancelled your appointment. [CANCEL: John Doe]"
2. If a patient wants to reschedule, ask for their old time, new preferred time, name, and reason. Then append [RESCHEDULE: OldTimeISO|NewTimeISO|PatientName|Reason|DoctorName]. Example: "I have moved your appointment! [RESCHEDULE: 2026-05-23T09:00:00.000Z|2026-05-24T09:00:00.000Z|John Doe|Checkup|Dr. Sarah Jenkins]"

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
