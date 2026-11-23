/* ════════════════════════════════════════════════
   MedGuard AI Receptionist — Browser Client
   Features:
     · WebSocket live dashboard (appointments + slots)
     · Browser Voice Call via Web Speech API (STT)
     · Google Cloud TTS for natural AI voice
     · Conversation state machine (idle/listening/thinking/speaking)
   ════════════════════════════════════════════════ */

'use strict';

// ── DOM References ───────────────────────────────
const $ = id => document.getElementById(id);

const DOM = {
    badgeDot:       $('badgeDot'),
    badgeLabel:     $('badgeLabel'),
    micBtn:         $('micBtn'),
    micWrapper:     $('micWrapper'),
    iconMic:        $('iconMic'),
    iconEnd:        $('iconEnd'),
    endCallBtn:     $('endCallBtn'),
    langSwitch:     $('langSwitch'),
    statusDot:      $('statusDot'),
    statusLabel:    $('statusLabel'),
    waveform:       $('waveform'),
    transcriptBody: $('transcriptBody'),
    transcriptEmpty:$('transcriptEmpty'),
    clearBtn:       $('clearBtn'),
    browserWarning: $('browserWarning'),
};

// ── App State ────────────────────────────────────
const state = {
    phase:        'idle',   // 'idle' | 'listening' | 'thinking' | 'speaking'
    callActive:   false,
    sessionId:    null,
    phoneNumber:  sessionStorage.getItem('mg_patient_phone') || '',
    recognition:  null,
    processing:   false,    // guard: prevent double-send
    language:     'en-US',  // 'en-US' or 'ta-IN'
};

// ── Session ID (persisted per browser tab) ───────
function initSession() {
    let sid = sessionStorage.getItem('mg_receptionist_sid');
    if (!sid) {
        sid = 'browser-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
        sessionStorage.setItem('mg_receptionist_sid', sid);
    }
    state.sessionId = sid;
}

// ════════════════════════════════════════════════
// WebSocket — Live Dashboard
// ════════════════════════════════════════════════
function initWebSocket() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws    = new WebSocket(`${proto}//${location.host}`);

    ws.onopen = () => {
        DOM.badgeDot.className   = 'badge-dot online';
        DOM.badgeLabel.textContent = 'System Online';
    };

    ws.onclose = () => {
        DOM.badgeDot.className   = 'badge-dot offline';
        DOM.badgeLabel.textContent = 'Reconnecting…';
        setTimeout(initWebSocket, 5000);
    };

    ws.onerror = () => {
        DOM.badgeDot.className   = 'badge-dot offline';
        DOM.badgeLabel.textContent = 'Connection Error';
    };

    // The dashboard panel (appointments/slots/logs/WhatsApp status) this used to drive was
    // moved to the admin portal — this page no longer has anywhere to render it, so the
    // connection badge (handled in onopen/onclose/onerror above) is all we need here.
    ws.onmessage = () => {};
}

function esc(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Doctor headshots (sourced from kmchhospitals.com/all-doctors/). Kept out of the
// AI prompt on purpose — long URLs repeated across every chat turn risk the model
// mangling them. The AI only ever needs to say the doctor's name; we look up the photo here.
const DOCTOR_PHOTOS = {
    'Dr. K.I. Joseph': 'https://kmchhospitals.com/wp-content/uploads/2025/01/Dr.-K.I.-Joseph.png',
    'Dr. Thomas Alexander': 'https://kmchhospitals.com/wp-content/uploads/2024/04/Dr.-Thomas-Alexander-kmch.png',
    'Dr. S. Pavithra': 'https://kmchhospitals.com/wp-content/uploads/2025/07/Dr-Pavitra-Derma.png',
    'Dr. K. Baskaran': 'https://kmchhospitals.com/wp-content/uploads/2025/07/Dr-Baskaran-ortho.png',
    'Dr. D. Ashwath': 'https://kmchhospitals.com/wp-content/uploads/2025/07/Dr.-D.-Ashwath-.png',
    'Dr. S. Aravindh': 'https://kmchhospitals.com/wp-content/uploads/2025/01/Dr.-S.-Aravindh-Gastro.webp',
    'Dr. P. Baskar': 'https://kmchhospitals.com/wp-content/uploads/2025/07/Dr-Baskar.png',
    'Dr. A.N. Murugan': 'https://kmchhospitals.com/wp-content/uploads/2025/07/Dr.A.N.-Murgan.png',
    'Dr. Jayanthi Veerappan': 'https://kmchhospitals.com/wp-content/uploads/2025/07/Dr.Jayanthi-Veerappan.png',
    'Dr. P.B. Barani Kumar': 'https://kmchhospitals.com/wp-content/uploads/2025/07/Dr.Baranikumar.png',
    'Dr. T.R. Sivagnanam': 'https://kmchhospitals.com/wp-content/uploads/2025/01/Dr-Sivagnanam-diabetology.png',
    'Dr. J. Venugopal': 'https://kmchhospitals.com/wp-content/uploads/2025/07/Dr.Venugopal.png',
};
const DOCTOR_PHOTO_FALLBACK = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="20" fill="#6366f1"/><text x="50%" y="56%" font-size="18" text-anchor="middle" fill="white" font-family="sans-serif">🩺</text></svg>`
);
// Normalized lookup (strips spacing/punctuation) so minor formatting drift from the
// LLM's output (e.g. "Dr K I Joseph" vs "Dr. K.I. Joseph") still resolves to a photo.
function normalizeDoctorName(name) {
    return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
const DOCTOR_PHOTOS_NORMALIZED = Object.fromEntries(
    Object.entries(DOCTOR_PHOTOS).map(([k, v]) => [normalizeDoctorName(k), v])
);
function getDoctorPhoto(name) {
    return DOCTOR_PHOTOS_NORMALIZED[normalizeDoctorName(name)] || DOCTOR_PHOTO_FALLBACK;
}

// Roster for the "Meet our specialists" showcase (specialties mirror the clinic
// prompt in ai.js — kept here so the grid can render without a round-trip).
const DOCTORS = [
    { name: 'Dr. K.I. Joseph',        specialty: 'General Physician' },
    { name: 'Dr. Thomas Alexander',   specialty: 'Cardiologist' },
    { name: 'Dr. S. Pavithra',        specialty: 'Dermatologist' },
    { name: 'Dr. K. Baskaran',        specialty: 'Orthopedic Surgeon' },
    { name: 'Dr. D. Ashwath',         specialty: 'Pediatrician' },
    { name: 'Dr. S. Aravindh',        specialty: 'Gastroenterologist' },
    { name: 'Dr. P. Baskar',          specialty: 'Neurologist' },
    { name: 'Dr. A.N. Murugan',       specialty: 'ENT Specialist' },
    { name: 'Dr. Jayanthi Veerappan', specialty: 'Gynecologist' },
    { name: 'Dr. P.B. Barani Kumar',  specialty: 'Urologist' },
    { name: 'Dr. T.R. Sivagnanam',    specialty: 'Diabetologist' },
    { name: 'Dr. J. Venugopal',       specialty: 'Pulmonologist' },
];

// (Old appointments/slots/logs/WhatsApp panel removed — see the ws.onmessage comment above.
// That live data now only renders in the admin portal, which has its own WebSocket handler.)

// ════════════════════════════════════════════════
// TTS — Voice Engine (Google Browser TTS or ElevenLabs)
// ════════════════════════════════════════════════
let currentAudio = null;

function getVoiceEngine() {
    const toggle = document.getElementById('voiceEngineSwitch');
    return (toggle && toggle.checked) ? 'elevenlabs' : 'browser';
}

async function speak(text) {
    return new Promise(async (resolve) => {
        setPhase('speaking');
        
        // Stop any currently playing audio (ElevenLabs)
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }
        // Stop any currently playing browser speech (Browser TTS)
        window.speechSynthesis.cancel();

        // Clean out specific tags from spoken text
        let cleanText = text || '';
        cleanText = cleanText.replace(/\[BOOK:\s*[^\]]+\]/gi, '');
        cleanText = cleanText.replace(/\[SEND_WHATSAPP:\s*[^\]]+\]/gi, '');
        cleanText = cleanText.replace(/\[TABLE:\s*[^\]]+\]/gi, '');
        cleanText = cleanText.replace(/\[DOCTORS_CHART(?::\s*[^\]]+)?\]/gi, '');
        cleanText = cleanText.replace(/\s+/g, ' ').trim();

        if (!cleanText) {
            resolve();
            return;
        }

        const engine = getVoiceEngine();

        if (engine === 'browser') {
            // -- GOOGLE BROWSER TTS --
            const utterance = new SpeechSynthesisUtterance(cleanText);
            utterance.lang = state.language;
            
            // Try to find a good Female voice first, fallback to Google/Natural, then any matching lang
            const voices = window.speechSynthesis.getVoices();
            const voice = voices.find(v => v.lang === state.language && (v.name.includes('Female') || v.name.includes('Zira') || v.name.includes('Samantha') || v.name.includes('Victoria') || v.name.includes('Jenny')))
                       || voices.find(v => v.lang === state.language && (v.name.includes('Google') || v.name.includes('Natural')))
                       || voices.find(v => v.lang === state.language)
                       || voices.find(v => v.lang.startsWith(state.language.split('-')[0]));
            
            if (voice) utterance.voice = voice;
            utterance.rate = 1.0;
            utterance.pitch = 1.0;

            utterance.onend = () => resolve();
            utterance.onerror = (e) => {
                console.error('Browser TTS error:', e);
                resolve();
            };
            
            window.speechSynthesis.speak(utterance);
        } else {
            // -- ELEVENLABS --
            try {
                const res = await fetch('/api/tts-elevenlabs', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: cleanText, lang: state.language })
                });

                if (!res.ok) {
                    // Fallback to browser TTS if ElevenLabs fails
                    console.warn('ElevenLabs TTS failed, falling back to Browser TTS');
                    document.getElementById('voiceEngineSwitch').checked = false; // toggle off visually
                    return speak(cleanText).then(resolve);
                }

                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                currentAudio = new Audio(url);
                
                currentAudio.onended = () => {
                    URL.revokeObjectURL(url);
                    currentAudio = null;
                    resolve();
                };
                
                currentAudio.onerror = () => {
                    URL.revokeObjectURL(url);
                    currentAudio = null;
                    resolve();
                };

                await currentAudio.play();
            } catch (err) {
                console.error('ElevenLabs TTS error:', err);
                resolve();
            }
        }
    });
}

// ════════════════════════════════════════════════
// Speech Recognition (STT)
// ════════════════════════════════════════════════
function checkSpeechSupport() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
        DOM.browserWarning.classList.remove('hidden');
        DOM.micBtn.disabled = true;
        DOM.micBtn.style.opacity = '0.35';
        DOM.micBtn.style.cursor  = 'not-allowed';
        return null;
    }
    return SR;
}

function buildRecognition(SR) {
    const r = new SR();
    r.lang             = state.language;
    r.continuous       = false;
    r.interimResults   = true;
    r.maxAlternatives  = 1;

    let interimBubble = null;

    r.onstart = () => {
        state.processing = false;
        setPhase('listening');
        interimBubble = null;
    };

    r.onresult = (event) => {
        if (state.processing) return;

        let interimText = '';
        let finalText   = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const t = event.results[i][0].transcript;
            if (event.results[i].isFinal) finalText   += t;
            else                           interimText += t;
        }

        // Show interim (greyed italic) bubble
        if (interimText) {
            if (!interimBubble) {
                interimBubble = addBubble('user', interimText, true);
            } else {
                interimBubble.querySelector('.bubble-text').textContent = interimText;
            }
        }

        // Final result — process it
        if (finalText.trim()) {
            if (interimBubble) {
                interimBubble.querySelector('.bubble-text').textContent = finalText;
                interimBubble.classList.remove('interim');
                interimBubble = null;
            } else {
                addBubble('user', finalText);
            }
            processUserSpeech(finalText.trim());
        }
    };

    r.onerror = (event) => {
        if (event.error === 'no-speech') {
            // Silence — restart listening if call is still active
            if (state.callActive && !state.processing) startListening();
            return;
        }
        if (event.error === 'aborted') return;
        
        console.error('SpeechRecognition error:', event.error);
        
        if (event.error === 'not-allowed') {
            alert("Microphone access was denied. Please click the site settings (padlock icon in the URL bar), allow microphone access, and reload the page. You can also use the text chat below.");
            endCall();
        } else {
            setPhase('idle');
        }
    };

    r.onend = () => {
        // Auto-restart if we're still in call and not processing
        if (state.callActive && state.phase === 'listening' && !state.processing) {
            startListening();
        }
    };

    return r;
}

// ── Recognition Start / Stop ─────────────────────
function startListening() {
    if (!state.recognition || !state.callActive) return;
    try { state.recognition.start(); } catch (_) { /* already running */ }
}

function stopListening() {
    state.processing = true;
    try { state.recognition.stop(); } catch (_) { /* noop */ }
}

// ════════════════════════════════════════════════
// Call Flow
// ════════════════════════════════════════════════
async function processUserSpeech(text) {
    stopListening();
    setPhase('thinking');
    addTypingIndicator();

    const result = await sendToAI(text);
    removeTypingIndicator();
    if (result.reply) addBubble('ai', result.reply, false, result.error);

    if (result.booked) {
        playSuccessSound();
    } else if (result.error) {
        playErrorSound();
    }

    await speak(result.reply || "I'm sorry, I couldn't process that. Please try again.");

    // Continue conversation loop
    if (state.callActive) startListening();
}

// Shared text-message flow used by the chat form, quick-chips, and doctor cards.
// (Voice input has its own path via processUserSpeech, which also speaks the reply.)
async function handleUserMessage(text) {
    text = (text || '').trim();
    if (!text || state.processing) return;
    state.processing = true;

    // Check if user provided their phone number directly
    const pMatch = text.match(/(?:\+?91[\s-]?)?([6-9]\d{9})/);
    if (pMatch) {
        state.phoneNumber = pMatch[1];
        sessionStorage.setItem('mg_patient_phone', state.phoneNumber);
    }

    addBubble('user', text);
    playMessageSentSound();

    setPhase('thinking');
    addTypingIndicator();
    const result = await sendToAI(text);
    removeTypingIndicator();
    if (result.reply) addBubble('ai', result.reply, false, result.error);

    if (result.callInitiated) {
        const callCard = document.createElement('div');
        callCard.className = 'bubble ai';
        callCard.innerHTML = `
            <div class="bubble-label">📞 Live Cellular Confirmation Call</div>
            <div class="bubble-text" style="border-left: 3px solid #ec4899; background: rgba(236,72,153,0.08); padding: 0.9rem;">
                <div style="font-weight: 700; color: #ec4899; font-size: 0.95rem; margin-bottom: 0.3rem;">🚀 Automated Confirmation Call Ringing!</div>
                <div style="font-size: 0.86rem; color: #f1f5f9; line-height: 1.5;">
                    Our Nothing Phone 2a cellular gateway is dialing <strong>+91 ${result.phone || state.phoneNumber}</strong> right now with <strong>ElevenLabs Voice</strong>.
                </div>
                <div style="font-size: 0.8rem; color: #f472b6; margin-top: 0.4rem;">
                    📲 Please pick up your phone to hear your appointment details confirmed live!
                </div>
            </div>
        `;
        DOM.transcriptBody.appendChild(callCard);
        DOM.transcriptBody.scrollTop = DOM.transcriptBody.scrollHeight;
    }

    if (result.booked)      playSuccessSound();
    else if (result.error)  playErrorSound();

    setPhase('idle');
    state.processing = false;
}

async function sendToAI(message) {
    try {
        const res = await fetch('/chat', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ 
                sessionId: state.sessionId, 
                message, 
                language: state.language,
                phone: state.phoneNumber 
            }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return {
            reply: data.reply || '',
            booked: !!data.booked,
            callInitiated: !!data.callInitiated,
            phone: data.phone || state.phoneNumber
        };
    } catch (err) {
        console.error('AI request failed:', err);
        return {
            reply: "I'm sorry, I'm having a connection issue right now. Please try again.",
            booked: false,
            error: true
        };
    }
}

// ── UI Sounds & Synthesizer ──────────────────────
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSynthTone(freqs, durations, type = 'sine', gainSequence = [0.15, 0.005]) {
    try {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        let time = audioCtx.currentTime;
        freqs.forEach((freq, idx) => {
            const osc = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            
            osc.type = type;
            osc.frequency.setValueAtTime(freq, time);
            
            const dur = durations[idx] || 0.1;
            
            gainNode.gain.setValueAtTime(gainSequence[0], time);
            gainNode.gain.exponentialRampToValueAtTime(gainSequence[1], time + dur);
            
            osc.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            
            osc.start(time);
            osc.stop(time + dur);
            
            time += dur * 0.8; // overlap slightly
        });
    } catch (e) {
        console.error("Failed to play synth sound:", e);
    }
}

function playClickSound() {
    playSynthTone([600, 300], [0.05, 0.05], 'sine', [0.12, 0.005]);
}

// Success chime: rising major arpeggio (C5 -> E5 -> G5 -> C6)
function playSuccessSound() {
    playSynthTone([523.25, 659.25, 783.99, 1046.50], [0.12, 0.12, 0.12, 0.32], 'sine', [0.20, 0.002]);
}

// Call Started: ascending soft notes
function playStartCallSound() {
    playSynthTone([392.00, 523.25], [0.15, 0.25], 'sine', [0.15, 0.005]);
}

// Call Ended: descending soft notes
function playEndCallSound() {
    playSynthTone([523.25, 392.00], [0.15, 0.25], 'sine', [0.15, 0.005]);
}

// Listening beep: clean Siri-like prompt beep
function playListeningSound() {
    playSynthTone([880.00, 1174.66], [0.06, 0.08], 'sine', [0.08, 0.005]);
}

// Error tone: low descending "uh-oh" pair
function playErrorSound() {
    playSynthTone([311.13, 233.08], [0.14, 0.22], 'triangle', [0.14, 0.005]);
}

// Notify chime: soft two-note pop, used when interactive content (slot table / doctors chart) appears
function playNotifyChime() {
    playSynthTone([740.00, 987.77], [0.07, 0.1], 'sine', [0.10, 0.004]);
}

// Message sent: tiny blip for outgoing text messages
function playMessageSentSound() {
    playSynthTone([500], [0.045], 'sine', [0.09, 0.005]);
}

// ════════════════════════════════════════════════
// Mic Button
// ════════════════════════════════════════════════
async function handleMicClick() {
    if (!state.recognition) return;

    if (!state.callActive) {
        // ── START CALL ──
        state.callActive = true;
        playStartCallSound();
        if (DOM.endCallBtn) DOM.endCallBtn.classList.remove('hidden');

        const greeting = state.phoneNumber 
            ? "Hello! I am Alex, assistant of Jeevankishore from MedGuard Clinic. How can I help you today?" 
            : "Hello! I am Alex from MedGuard Clinic. Welcome! Could you please share your phone number so we can confirm your appointment, or tell me how I can help you today?";
        addBubble('ai', greeting);
        await speak(greeting);
        if (state.callActive) startListening();

    } else {
        playClickSound();
        // ── PUSH TO TALK / INTERRUPT ──
        if (state.phase === 'speaking') {
            if (currentAudio) { currentAudio.pause(); currentAudio = null; }
            startListening();
        } else if (state.phase === 'idle') {
            startListening();
        } else if (state.phase === 'listening') {
            stopListening();
        }
    }
}

function endCall() {
    state.callActive = false;
    playEndCallSound();
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    stopListening();
    setPhase('idle');
    if (DOM.endCallBtn) DOM.endCallBtn.classList.add('hidden');
    addBubble('ai', 'Call ended. Have a great day! 👋');
}

// ════════════════════════════════════════════════
// Phase / Visual State Machine
// ════════════════════════════════════════════════
function setPhase(phase) {
    state.phase = phase;

    // Reset dynamic classes
    DOM.micBtn.className     = 'mic-btn';
    DOM.micWrapper.className = 'mic-wrapper';
    DOM.statusDot.className  = 'status-dot';
    DOM.waveform.classList.remove('active');

    switch (phase) {
        case 'idle':
            DOM.statusLabel.textContent = 'Click mic to start';
            break;

        case 'listening':
            DOM.micBtn.classList.add('is-listening');
            DOM.micWrapper.classList.add('is-listening');
            DOM.statusDot.classList.add('is-listening');
            DOM.statusLabel.textContent = 'Listening…';
            DOM.waveform.classList.add('active');
            // Play a soft listening alert beep if call is active
            if (state.callActive) playListeningSound();
            break;

        case 'thinking':
            DOM.micBtn.classList.add('is-thinking');
            DOM.statusDot.classList.add('is-thinking');
            DOM.statusLabel.textContent = 'AI Thinking…';
            break;

        case 'speaking':
            DOM.micBtn.classList.add('is-speaking');
            DOM.micWrapper.classList.add('is-speaking');
            DOM.statusDot.classList.add('is-speaking');
            DOM.statusLabel.textContent = 'AI Speaking…';
            break;
    }
}

// ════════════════════════════════════════════════
// Typing Indicator (shown while AI is "thinking")
// ════════════════════════════════════════════════
function addTypingIndicator() {
    removeTypingIndicator();
    DOM.transcriptEmpty.classList.add('hidden');
    const el = document.createElement('div');
    el.className = 'bubble ai';
    el.id = 'typingIndicator';
    el.innerHTML = `
        <div class="bubble-label">🤖 MedGuard AI</div>
        <div class="bubble-text typing-dots"><span></span><span></span><span></span></div>
    `;
    DOM.transcriptBody.appendChild(el);
    DOM.transcriptBody.scrollTop = DOM.transcriptBody.scrollHeight;
}

function removeTypingIndicator() {
    const el = $('typingIndicator');
    if (el) el.remove();
}

// ════════════════════════════════════════════════
// Transcript Bubbles
// ════════════════════════════════════════════════
function addBubble(role, text, isInterim = false, isError = false) {
    DOM.transcriptEmpty.classList.add('hidden');

    const el = document.createElement('div');
    el.className = `bubble ${role}${isInterim ? ' interim' : ''}${isError ? ' error' : ''}`;

    let cleanTextDisplay = text || '';
    // Strip [BOOK: ...] and [SEND_WHATSAPP: ...] from text bubbles
    cleanTextDisplay = cleanTextDisplay.replace(/\[BOOK:\s*[^\]]+\]/gi, '').replace(/\[SEND_WHATSAPP:\s*[^\]]+\]/gi, '');

    let parsedTableHTML = '';

    // Check if there is a table tag [TABLE: ...]
    const tableRegex = /\[TABLE:\s*([^\]]+)\]/i;
    const tableMatch = cleanTextDisplay.match(tableRegex);

    if (tableMatch) {
        // Strip the [TABLE: ...] tag from display text
        cleanTextDisplay = cleanTextDisplay.replace(/\[TABLE:\s*[^\]]+\]/gi, '').trim();

        const slotsStr = tableMatch[1];
        const slots = slotsStr.split(',').map(s => s.trim()).filter(s => s);

        if (slots.length > 0) {
            const groups = {};
            slots.forEach(slotStr => {
                const d = new Date(slotStr);
                if (isNaN(d.getTime())) return;
                const dateKey = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
                if (!groups[dateKey]) groups[dateKey] = [];
                groups[dateKey].push({
                    iso: slotStr,
                    timeStr: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                });
            });

            parsedTableHTML = `<div class="slot-picker-table">`;
            Object.keys(groups).forEach(dateLabel => {
                parsedTableHTML += `
                    <div class="slot-picker-row">
                        <div class="slot-picker-date">${dateLabel}</div>
                        <div class="slot-picker-times">
                `;
                groups[dateLabel].forEach(slot => {
                    const clickAction = `selectSlot('${slot.iso}', '${slot.timeStr}', '${dateLabel.replace(/'/g, "\\'")}')`;
                    parsedTableHTML += `
                        <button class="slot-picker-btn" onclick="${clickAction}">${slot.timeStr}</button>
                    `;
                });
                parsedTableHTML += `
                        </div>
                    </div>
                `;
            });
            parsedTableHTML += `</div>`;
        }
    }

    let parsedDoctorsChartHTML = '';
    const chartRegex = /\[DOCTORS_CHART(?::\s*([^\]]+))?\]/i;
    const chartMatch = cleanTextDisplay.match(chartRegex);
    if (chartMatch) {
        cleanTextDisplay = cleanTextDisplay.replace(chartRegex, '').trim();

        const doctors = (chartMatch[1] || '').split(',')
            .map(entry => {
                const [name, specialty] = entry.split('|').map(s => (s || '').trim());
                return { name, specialty };
            })
            .filter(d => d.name);

        if (doctors.length > 0) {
            const rows = doctors.map((d, i) => {
                const photo = getDoctorPhoto(d.name);
                return `
                <tr${i < doctors.length - 1 ? ' style="border-bottom: 1px solid rgba(255,255,255,0.1);"' : ''}>
                    <td style="padding: 6px 12px;"><img src="${esc(photo)}" alt="${esc(d.name)}" onerror="this.onerror=null;this.src='${DOCTOR_PHOTO_FALLBACK}';" style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover; display: block; background: rgba(255,255,255,0.08);"></td>
                    <td style="padding: 8px 12px;">${esc(d.name)}</td>
                    <td style="padding: 8px 12px; color: #9ca3af;">${esc(d.specialty || '—')}</td>
                </tr>
            `;
            }).join('');

            parsedDoctorsChartHTML = `
                <div style="margin-top: 10px; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; overflow: hidden; font-size: 0.85rem; width: 100%;">
                    <table style="width: 100%; border-collapse: collapse; text-align: left; color: #fff;">
                        <thead style="background: rgba(255,255,255,0.1);">
                            <tr>
                                <th style="padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.2); width: 52px;"></th>
                                <th style="padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.2);">Doctor Name</th>
                                <th style="padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.2);">Specialty</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            `;
        }
    }

    const formattedText = esc(cleanTextDisplay).replace(/\n/g, '<br>') + parsedTableHTML + parsedDoctorsChartHTML;

    if (parsedTableHTML || parsedDoctorsChartHTML) playNotifyChime();

    const timeStamp = isInterim ? '' :
        `<div class="bubble-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>`;

    el.innerHTML = `
        <div class="bubble-label">${role === 'user' ? 'You' : '🤖 MedGuard AI'}</div>
        <div class="bubble-text" style="line-height: 1.5;">${formattedText}</div>
        ${timeStamp}
    `;
    DOM.transcriptBody.appendChild(el);
    DOM.transcriptBody.scrollTop = DOM.transcriptBody.scrollHeight;
    return el;
}

window.selectSlot = (iso, timeStr, dateLabel) => {
    const input = document.getElementById('textChatInput');
    if (input) {
        input.value = `I would like to book the slot on ${dateLabel} at ${timeStr}`;
        input.focus();
        
        // Blink the send button to encourage sending!
        const sendBtn = document.querySelector('#textChatForm button[type="submit"]');
        if (sendBtn) {
            sendBtn.style.transform = 'scale(1.08)';
            sendBtn.style.boxShadow = '0 0 15px rgba(99, 102, 241, 0.6)';
            sendBtn.style.background = '#6366f1';
            setTimeout(() => {
                sendBtn.style.transform = '';
                sendBtn.style.boxShadow = '';
                sendBtn.style.background = '';
            }, 1000);
        }
    }
};

DOM.clearBtn.addEventListener('click', () => {
    // Remove all bubbles but keep the empty placeholder
    [...DOM.transcriptBody.children].forEach(c => {
        if (c.id !== 'transcriptEmpty') c.remove();
    });
    DOM.transcriptEmpty.classList.remove('hidden');
});

// ════════════════════════════════════════════════
// Doctors Showcase
// ════════════════════════════════════════════════
function renderDoctors() {
    const grid = $('doctorsGrid');
    if (!grid) return;

    grid.innerHTML = DOCTORS.map((d, i) => `
        <button class="doctor-card" style="animation-delay:${(i * 0.045).toFixed(3)}s">
            <span class="doctor-avatar-wrap">
                <img class="doctor-avatar" src="${esc(getDoctorPhoto(d.name))}" alt="${esc(d.name)}"
                     onerror="this.onerror=null;this.src='${DOCTOR_PHOTO_FALLBACK}';">
            </span>
            <span class="doctor-info">
                <span class="doctor-name">${esc(d.name)}</span>
                <span class="doctor-specialty">${esc(d.specialty)}</span>
            </span>
        </button>
    `).join('');

    const count = $('doctorCount');
    if (count) count.textContent = DOCTORS.length;

    grid.querySelectorAll('.doctor-card').forEach((card, i) => {
        card.addEventListener('click', () => {
            const d = DOCTORS[i];
            handleUserMessage(`Tell me about ${d.name} (${d.specialty}) — are they available and can I book an appointment?`);
            document.querySelector('.call-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });
}

// ════════════════════════════════════════════════
// Conversation Tools (copy / download)
// ════════════════════════════════════════════════
function collectTranscript() {
    const lines = [];
    DOM.transcriptBody.querySelectorAll('.bubble').forEach(b => {
        if (b.id === 'typingIndicator') return;
        const txtEl = b.querySelector('.bubble-text');
        if (!txtEl) return;
        const t = txtEl.innerText.trim();
        if (!t) return;
        const who = b.classList.contains('user') ? 'You' : 'MedGuard AI';
        lines.push(`${who}: ${t}`);
    });
    return lines.join('\n\n');
}

// ════════════════════════════════════════════════
// Welcome & Patient Phone Capture Flow
// ════════════════════════════════════════════════
function displayWelcomeFlow() {
    if (DOM.transcriptBody.querySelectorAll('.bubble').length > 0) return;
    DOM.transcriptEmpty.classList.add('hidden');

    const savedPhone = sessionStorage.getItem('mg_patient_phone') || state.phoneNumber || '';
    state.phoneNumber = savedPhone;

    const welcomeHtml = `
        <div class="welcome-box">
            <p style="font-size: 0.95rem;"><strong>Hello! I am Alex</strong>, assistant of Jeevankishore from <strong>MedGuard Clinic</strong>. Welcome! 🏥</p>
            <p style="margin-top:0.45rem; font-size:0.85rem; color:var(--text-muted); line-height: 1.5;">
                To keep your consultation records synced and receive an <strong>instant confirmation call</strong> via our SIM gateway, please verify your mobile number below:
            </p>
            <div class="chat-phone-card" id="chatPhoneCard">
                <div class="phone-input-group">
                    <span class="phone-prefix">🇮🇳 +91</span>
                    <input type="tel" id="welcomePhoneInput" placeholder="Enter 10-digit mobile" maxlength="10" value="${savedPhone}">
                    <button id="savePhoneBtn" class="phone-save-btn">${savedPhone ? 'Update' : 'Continue ➔'}</button>
                </div>
                <div class="phone-status-msg" id="phoneStatusMsg">${savedPhone ? '✅ Phone number active: +91 ' + savedPhone : ''}</div>
            </div>
            <p style="margin-top:0.6rem; font-size:0.82rem; color:var(--text-muted);">
                How can I assist you today? You can ask about our 12 specialists, check available slots, or share your symptoms.
            </p>
        </div>
    `;

    const el = document.createElement('div');
    el.className = 'bubble ai welcome-bubble';
    el.innerHTML = `
        <div class="bubble-label">🤖 MedGuard AI · Receptionist</div>
        <div class="bubble-text">${welcomeHtml}</div>
    `;
    DOM.transcriptBody.appendChild(el);
    DOM.transcriptBody.scrollTop = DOM.transcriptBody.scrollHeight;

    const saveBtn = document.getElementById('savePhoneBtn');
    const phoneInput = document.getElementById('welcomePhoneInput');
    const statusMsg = document.getElementById('phoneStatusMsg');
    if (saveBtn && phoneInput) {
        saveBtn.addEventListener('click', () => {
            const val = phoneInput.value.replace(/\D/g, '');
            if (val.length < 10) {
                if (statusMsg) {
                    statusMsg.textContent = '⚠️ Please enter a valid 10-digit mobile number.';
                    statusMsg.style.color = '#f43f5e';
                }
                return;
            }
            state.phoneNumber = val.slice(-10);
            sessionStorage.setItem('mg_patient_phone', state.phoneNumber);
            if (statusMsg) {
                statusMsg.textContent = `✅ Saved (+91 ${state.phoneNumber})! Our AI assistant will call this number on confirmation.`;
                statusMsg.style.color = '#10b981';
            }
            playSuccessSound();
        });
        phoneInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') saveBtn.click();
        });
    }
}

// ════════════════════════════════════════════════
// Boot
// ════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
    initSession();
    initWebSocket();
    state.recognition = checkSpeechSupport() ? buildRecognition(checkSpeechSupport()) : null;
    displayWelcomeFlow();
    
    // Add event listener for Text Chat
    const textChatForm = $('textChatForm');
    const textChatInput = $('textChatInput');
    
    if (textChatForm && textChatInput) {
        textChatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const text = textChatInput.value.trim();
            if (!text) return;
            textChatInput.value = '';
            handleUserMessage(text);
        });
    }

    // Render the specialists grid
    renderDoctors();

    // Quick-action chips → send a canned message
    document.querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('click', () => {
            if (chip.dataset.msg) handleUserMessage(chip.dataset.msg);
        });
    });

    // Conversation tools: copy + download
    const copyBtn = $('copyBtn');
    const downloadBtn = $('downloadBtn');
    if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
            const text = collectTranscript();
            if (!text) return;
            try {
                await navigator.clipboard.writeText(text);
                copyBtn.classList.add('copied');
                setTimeout(() => copyBtn.classList.remove('copied'), 1500);
            } catch (_) { /* clipboard blocked — ignore */ }
        });
    }
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            const text = collectTranscript();
            if (!text) return;
            const header = `MedGuard Clinic — Conversation\n${new Date().toLocaleString()}\n${'─'.repeat(32)}\n\n`;
            const blob = new Blob([header + text], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `medguard-chat-${Date.now()}.txt`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        });
    }

    if (state.recognition) {
        DOM.micBtn.addEventListener('click', handleMicClick);
        if (DOM.endCallBtn) DOM.endCallBtn.addEventListener('click', endCall);
    }
    
    if (DOM.langSwitch) {
        DOM.langSwitch.addEventListener('change', (e) => {
            state.language = e.target.checked ? 'ta-IN' : 'en-US';
            if (state.recognition) state.recognition.lang = state.language;
            
            // Automatically switch to Browser TTS when Tamil is selected
            if (state.language === 'ta-IN') {
                const voiceSwitch = document.getElementById('voiceEngineSwitch');
                if (voiceSwitch) voiceSwitch.checked = false;
            }
        });
    }

    // Pre-load browser TTS voices (Chrome loads async)
    speechSynthesis.getVoices();
    speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();

    setPhase('idle');
    setupTitleCardEvents();
});

// ════════════════════════════════════════════════
// Title Card Overlay & Audio Sound Effects
// ════════════════════════════════════════════════
let titleAudioCtx = null;

function getTitleAudioContext() {
    if (!titleAudioCtx) {
        titleAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (titleAudioCtx.state === 'suspended') {
        titleAudioCtx.resume();
    }
    return titleAudioCtx;
}

// Futuristic launch chime sound (major triad synth chord sweep + shimmer)
function playLaunchSound() {
    try {
        const ctx = getTitleAudioContext();
        const now = ctx.currentTime;
        
        // Frequencies for futuristic chord (C4, E4, G4, C5, E5)
        const notes = [261.63, 329.63, 392.00, 523.25, 659.25];
        
        notes.forEach((freq, index) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            const filter = ctx.createBiquadFilter();

            osc.type = index % 2 === 0 ? 'sine' : 'triangle';
            osc.frequency.setValueAtTime(freq, now + index * 0.05);

            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(800, now);
            filter.frequency.exponentialRampToValueAtTime(4000, now + 0.5);

            gain.gain.setValueAtTime(0, now + index * 0.05);
            gain.gain.linearRampToValueAtTime(0.12, now + index * 0.05 + 0.08);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2 + index * 0.1);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);

            osc.start(now + index * 0.05);
            osc.stop(now + 1.4 + index * 0.1);
        });

    } catch (e) { console.error('Audio FX error:', e); }
}

// Subtle futuristic hover blip sound
function playHoverSound() {
    try {
        const ctx = getTitleAudioContext();
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08);

        gain.gain.setValueAtTime(0.04, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.08);
    } catch (e) {}
}

// Title Card Particle Canvas Animation
function initTitleCardCanvas() {
    const canvas = document.getElementById('titleCardCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationId = null;

    let width = canvas.width = window.innerWidth;
    let height = canvas.height = window.innerHeight;

    const onResize = () => {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
    };
    window.removeEventListener('resize', onResize);
    window.addEventListener('resize', onResize);

    const particles = Array.from({ length: 65 }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.7,
        vy: (Math.random() - 0.5) * 0.7,
        radius: Math.random() * 2 + 1,
        alpha: Math.random() * 0.6 + 0.2
    }));

    function draw() {
        ctx.clearRect(0, 0, width, height);

        // Render moving particles
        particles.forEach((p, i) => {
            p.x += p.vx;
            p.y += p.vy;

            if (p.x < 0 || p.x > width) p.vx *= -1;
            if (p.y < 0 || p.y > height) p.vy *= -1;

            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(165, 180, 252, ${p.alpha})`;
            ctx.fill();

            // Connect nearby particles
            for (let j = i + 1; j < particles.length; j++) {
                const p2 = particles[j];
                const dx = p.x - p2.x;
                const dy = p.y - p2.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < 130) {
                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.strokeStyle = `rgba(99, 102, 241, ${(1 - dist / 130) * 0.25})`;
                    ctx.lineWidth = 0.8;
                    ctx.stroke();
                }
            }
        });

        const overlay = document.getElementById('titleCardOverlay');
        if (overlay && !overlay.classList.contains('dismissed') && overlay.style.display !== 'none') {
            animationId = requestAnimationFrame(draw);
        }
    }

    draw();
}

function setupTitleCardEvents() {
    const overlay = document.getElementById('titleCardOverlay');
    const launchBtn = document.getElementById('launchAppBtn');
    const reopenBtn = document.getElementById('reopenTitleCardBtn');

    initTitleCardCanvas();

    if (launchBtn) {
        launchBtn.addEventListener('mouseenter', () => playHoverSound());
        launchBtn.addEventListener('click', () => {
            playLaunchSound();
            if (overlay) {
                overlay.classList.add('dismissed');
                setTimeout(() => {
                    overlay.style.display = 'none';
                    displayWelcomeFlow();
                }, 650);
            }
        });
    }

    if (reopenBtn) {
        reopenBtn.addEventListener('click', () => {
            if (overlay) {
                overlay.style.display = 'flex';
                overlay.classList.remove('dismissed');
                initTitleCardCanvas();
                playHoverSound();
            }
        });
    }
}

