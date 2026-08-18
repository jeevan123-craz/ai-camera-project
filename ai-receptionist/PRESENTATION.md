# MedGuard AI — AI Implementation Deep Dive

**Focus of this presentation: how the AI engine itself is built** — model architecture, prompt engineering, the action protocol, and reliability design. The booking/WhatsApp/admin/prescription features exist as the product surface *around* this engine, and are summarized briefly at the end.

---

## 1. AI Engine at a Glance

| Layer | Choice | Why |
|---|---|---|
| Primary LLM | Google Gemini 2.5 Flash (`@google/genai`) | Fast, cheap, strong instruction-following for a low-latency voice/chat loop |
| Fallback LLM | Groq — Llama 3.3 70B Versatile (`groq-sdk`) | Free/fast standby inference; keeps the receptionist answering if Gemini errors or hits quota |
| Interface pattern | Plain-text generation with an embedded **tag protocol** (no native function-calling API used) | One prompt, one parsing layer works identically across two structurally different providers |
| State | Provider-neutral in-memory conversation history per session | Lets a single conversation be served by either provider turn-to-turn without losing context |

All of this lives in one file, [`ai.js`](ai.js), which every channel (browser chat, browser voice, WhatsApp) calls through the same `processUserInput()` function.

---

## 2. Architecture of the AI Engine

```
                         ┌─────────────────────────────┐
                         │   processUserInput(          │
                         │     callSid, userInput,       │
                         │     language, patientHistory) │
                         └───────────────┬───────────────┘
                                         │
                 ┌───────────────────────┼───────────────────────┐
                 │ 1. Load/init this session's history            │
                 │ 2. Pull LIVE available slots from Google Calendar│
                 │ 3. Build a fresh system instruction every turn  │
                 └───────────────────────┬───────────────────────┘
                                         ▼
                         ┌─────────────────────────────┐
                         │   callGemini(system, hist,   │◄── try first
                         │              userInput)      │
                         └───────────────┬───────────────┘
                                 success │   │ throws
                                         │   ▼
                                         │  ┌─────────────────────────────┐
                                         │  │  callGroq(system, hist,      │
                                         │  │           userInput)          │  ← standby fallback
                                         │  └───────────────┬───────────────┘
                                         ▼                   ▼
                              raw text response (persona reply + [ACTION_TAGS])
                                         │
                                         ▼
                       returned to caller (server.js / whatsapp.js),
                       which regex-parses the tags and executes real
                       side effects (Calendar / Sheets / Gmail / WhatsApp)
```

The AI layer **never touches Calendar, Sheets, or Gmail directly** — it only decides *what should happen* and encodes that decision as text. The callers own execution. This keeps the LLM boundary clean and easy to reason about / test in isolation.

---

## 3. Prompt Engineering — the System Instruction

The system instruction is **rebuilt on every single turn** (not cached), because it has to reflect live state: current calendar availability changes turn to turn as slots get booked.

What gets dynamically injected:

| Injected block | Source | Purpose |
|---|---|---|
| Clinic policies & FAQs | `knowledge_base.txt` (loaded once at boot) | Grounds answers about hours, pricing, insurance, parking, etc. |


```js
const formattedSlots = availableSlots.map(slot => {
    const d = new Date(slot);
    const readable = d.toLocaleString('en-US', {
        timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric',
        month: 'short', hour: '2-digit', minute: '2-digit', hour12: false
    });
    return `${readable} -> ${slot}`;
});
```

Key prompt-engineering decisions baked into the instruction text:
- **Redundancy guard** — explicit rule telling the model not to re-introduce itself every turn (a common small-model failure mode in multi-turn chat)
- **Silent vs. explicit doctor suggestion** — if a patient just states a symptom, the model must *silently* pick the right doctor and proceed; it must only render the visual `DOCTORS_CHART` when the patient *explicitly* asks who's available. This distinction is spelled out with contrastive examples in the prompt.
- **"Never read the slot list aloud"** — a UX constraint pushed into the prompt itself: the model must summarize in one short sentence and emit a `[TABLE: ...]` tag instead of listing every slot in prose, because this is a voice interface and a long spoken list is unusable.
- **Speak-then-tag rule for bookings** — the model is required to state the confirmed date/time in natural spoken language *and* emit the machine-readable `[BOOK: ...]` tag, since the tag itself is silently stripped before TTS and the patient would otherwise hear nothing about *when* their appointment is.

---

## 4. The Tag-Based Action Protocol (a hand-rolled alternative to function-calling)

Instead of using each provider's native tool/function-calling API (which would require maintaining two different schemas for Gemini and Groq), the model is instructed to emit **plain-text control tags** inline at the end of its natural-language reply. A single regex-based parser — shared by both the browser and WhatsApp channels — extracts and executes them.

| Tag | Syntax | Executes |
|---|---|---|
| Book | `[BOOK: ISOTime\|PatientName\|TriageSummary\|Doctor\|Email]` | `calendar.bookAppointment()` → Sheets log → confirmation email |
| Cancel | `[CANCEL: PatientName]` | `calendar.cancelAppointment()` |
| Reschedule | `[RESCHEDULE: OldISO\|NewISO\|PatientName\|Reason\|Doctor]` | cancel + rebook via `calendar.rescheduleAppointment()` |
| Slot picker | `[TABLE: iso1, iso2, ...]` | Rendered client-side as a clickable, day-grouped time grid |
| Doctors chart | `[DOCTORS_CHART: Name\|Specialty, ...]` | Rendered client-side as a photo + specialty table |
| WhatsApp send | `[SEND_WHATSAPP: +Number]` | `whatsapp.sendDirectMessage()` with clinic info |

Dispatch logic (same pattern repeated per-channel in `server.js` and `whatsapp.js`):

```js
const bookRegex = /\[BOOK:\s*([^\]]+)\]/i;
const match = aiResponse.match(bookRegex);
if (match) {
    const [time, patientName, reason, doctorNameRaw, email] =
        match[1].split('|').map(s => (s || '').trim());
    const result = await calendar.bookAppointment(patientName, time, reason, doctorNameRaw || 'Any', email);
    if (result.success) {
        await sheets.logAppointment(patientName, "Browser", time, "Browser Chat", doctorNameRaw, reason, email);
        if (email) gmail.sendAppointmentConfirmation(email, { patientName, time, doctorName: doctorNameRaw, reason, tokenNumber });
    }
    aiResponse = aiResponse.replace(bookRegex, '').trim(); // tag never shown/spoken to the patient
}
```

**Why this design, trade-offs included:**
- ✅ One prompt, one parser, works identically whether Gemini or Groq answered the turn — no per-provider schema maintenance
- ✅ Easy to extend — adding a new capability is "add a tag + a regex + a handler," no SDK-specific tool definitions
- ✅ Tags are transparently strippable before TTS/display, so the control channel never leaks into what the patient sees or hears
- ⚠️ Less strict than native structured tool-calling — correctness depends on the model reliably reproducing exact tag syntax, so the prompt has to be very explicit (and is, with worked examples for every tag)

---

## 5. Dual-Provider Failover (Reliability Engineering)| Returning-patient context | Google Sheets lookup (WhatsApp only) | Lets the AI greet a returning patient with their last visit/doctor/reason |
| Doctor roster (12 doctors + specialties) | Hardcoded in the prompt | Enables symptom → specialist matching and the doctors chart |
| Live available slots | `calendar.getAvailableSlots()`, converted to **readable IST time → exact ISO string** pairs | Prevents the model from inventing or mis-timezoning appointment times |
| Language override | UI toggle (`en-US` / `ta-IN`) | Forces full Tamil responses while keeping tag syntax in English |

Excerpt — turning raw ISO slots into a model-friendly, unambiguous mapping so the LLM never has to do timezone math itself:

```js
try {
    responseText = await callGemini(systemInstruction, neutralHistory, userInput);
} catch (geminiError) {
    console.error("Error with Gemini API, falling back to Groq standby:", geminiError.message);
    if (!groqClient) {
        return "I'm sorry, I'm having trouble connecting to my system right now. Could you please call back later?";
    }
    try {
        responseText = await callGroq(systemInstruction, neutralHistory, userInput);
    } catch (groqError) {
        return "I'm sorry, I'm having trouble connecting to my system right now. Could you please call back later?";
    }
}
```

This turns *any* Gemini failure — quota exhaustion, transient network error, outage — into a single retried turn on a completely different provider, invisible to the patient. Two things make this possible:

1. **Provider-neutral history.** Conversation turns are stored as `{ role: 'user' | 'assistant', content }`, then converted to each provider's required shape only at call time:
   ```js
   function toGeminiHistory(neutralHistory) {
       return neutralHistory.map(h => ({
           role: h.role === 'assistant' ? 'model' : 'user',
           parts: [{ text: h.content }],
       }));
   }
   function toGroqMessages(systemInstruction, neutralHistory, userInput) {
       return [{ role: 'system', content: systemInstruction }, ...neutralHistory, { role: 'user', content: userInput }];
   }
   ```
2. **One shared system instruction string** — since both providers accept slightly different call shapes (Gemini: `systemInstruction` config field; Groq: a `system` role message), the *content* of the instructions is identical either way, so behavior doesn't drift depending on which model answers.

Net effect: a conversation can be served by Gemini on turn 1, silently fail over to Groq on turn 2, and back to Gemini on turn 3 — with full context preserved throughout and no special-casing in the calling code (`server.js` / `whatsapp.js` just call `processUserInput()` and get text back either way).

---

## 6. Conversation State & Memory

- History is kept **in-memory**, keyed by `callSid` — a generated `sessionId` for browser tabs, or the caller's phone number for WhatsApp
- `clearCallHistory()` is exposed to reset a session
- Returning-patient context (WhatsApp only) is pulled from Google Sheets **before** the AI call and injected as a one-shot context block, not stored in the rolling history — keeps prior-visit context available without bloating every future turn's token count

**Known limitation (honest, presentation-ready):** history is process-memory only — a server restart clears all active conversations. This is an intentional simplicity trade-off for a demo/single-instance deployment, not yet backed by persistent session storage.

---

## 7. Multilingual AI (English ⇄ Tamil)

One toggle in the UI threads all the way through the stack:

```
UI language switch (EN/TA)
   → SpeechRecognition.lang  (STT listens in the right language)
   → processUserInput(..., language, ...)
        → if 'ta-IN': appended hard instruction —
          "You MUST respond ENTIRELY in Tamil (தமிழ்)... 
           booking and whatsapp tags must still remain in English exact syntax"
   → /api/tts voice selection: 'ta-IN-PallaviNeural' vs 'en-US-JennyNeural'
```

The interesting constraint here is the **split requirement**: natural language must switch languages, but the machine-readable tags (`[BOOK: ...]`, `[TABLE: ...]`, etc.) must stay in fixed English syntax regardless of conversation language, since the same regex parser handles both languages. That rule is stated explicitly in the appended instruction so the model doesn't try to localize the tags themselves.

---

## 8. Symptom Triage & Clinical Reasoning

The model is instructed to run a lightweight triage flow rather than book blind:
1. If the patient states symptoms, ask 2–3 quick follow-up questions (kept short — this is a live voice call, not a form)
2. Silently map symptoms → the correct specialist from the 12-doctor roster (e.g. "chest pain" → Cardiologist) without showing the full roster unless asked
3. Roll the triage answers into a `TriageSummary` that gets written into the `[BOOK: ...]` tag, so the doctor sees *why* the patient is coming, not just their name and a time slot

---

## 9. Voice AI Pipeline (STT → LLM → TTS)

```
Browser mic → Web Speech API (STT, streaming interim + final results)
      → POST /chat  { sessionId, message, language }
      → ai.js → Gemini/Groq → tagged text response
      → tags stripped for speech → POST /api/tts
      → node-edge-tts (Microsoft Edge neural voices) → MP3 stream → <audio> playback
```

Latency/UX-aware design choices:
- Interim STT results render as a greyed "typing" bubble before the final transcript is sent — feels responsive even before the AI replies
- The prompt itself enforces short, non-listy responses ("DO NOT be overly talkative") since this is a spoken phone-call-like interface, not a text chat window
- TTS playback rate is tuned to `0.98x` for a slightly more natural cadence

---

## 10. Supporting Product Surface (brief — built *around* the AI core)

- **Appointment lifecycle**: real Google Calendar bookings/cancels/reschedules, mirrored to Google Sheets
- **WhatsApp channel**: `whatsapp-web.js` bot using the identical AI engine and tag protocol as the browser
- **Admin dashboard**: live WebSocket view of bookings, doctors, and an activity log; doctor can publish prescriptions
- **E-Prescriptions**: patient lookup portal + branded emailed prescription
- **Blinkit medicine delivery**: one-click simulated order flow from a prescription
- **Notifications**: branded Gmail HTML emails for confirmations and prescriptions; synthesized (asset-free) UI sounds via Web Audio API

*(Full breakdown of these available on request — this presentation is scoped to the AI engine.)*

---

## 11. Tech Stack Summary

| Category | Stack |
|---|---|
| AI / LLM | Gemini 2.5 Flash (`@google/genai`), Groq Llama 3.3 70B (`groq-sdk`) |
| Voice | Web Speech API (STT), Microsoft Edge Neural TTS (`node-edge-tts`) |
| Backend | Node.js 18, Express 5, WebSocket (`ws`), `node-cron` |
| Google Integrations | Calendar API, Sheets API, Gmail API (`googleapis`, OAuth2) |
| Messaging | `whatsapp-web.js` + Puppeteer/Chromium |
| Frontend | Vanilla HTML/CSS/JS, custom dark glassmorphic design system |
| Deployment | Docker (`node:18-slim`), Render.com |

---

## 12. Why This AI Implementation Is Notable

- **Provider-agnostic by design** — the same prompt and parser drive two structurally different LLM APIs (Gemini's chat-session object vs. Groq's stateless OpenAI-style completion)
- **The model's output *is* the API call** — a self-contained text protocol replaces native function-calling, chosen deliberately for cross-provider uniformity
- **Live-state-aware prompting** — the system instruction is regenerated every turn from real calendar availability, not a static prompt template
- **Reliability engineered at the AI layer, not just the infra layer** — failover happens *inside* the AI call, so every calling context (voice, text, WhatsApp) gets it for free
- **UX constraints enforced through the prompt itself** — e.g. "never read long lists aloud," speak-then-tag booking confirmations — because this is a voice-first interface, not just a chatbot

---

## 13. Limitations & Future AI Enhancements

- Migrate the tag protocol to native structured output / function-calling APIs for stricter guarantees on malformed responses
- Replace the static `knowledge_base.txt` prompt injection with real RAG (embeddings + vector search) to scale beyond one clinic's FAQ set
- Persist conversation history (currently in-memory only, lost on restart) to a durable store keyed by session
- Stream LLM responses token-by-token to cut perceived latency on the voice channel
- Add automated prompt/behavior regression tests — currently no eval harness for the tag protocol or triage behavior
