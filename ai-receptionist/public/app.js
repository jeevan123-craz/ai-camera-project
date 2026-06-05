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
    apptList:       $('apptList'),
    apptCount:      $('apptCount'),
    slotsList:      $('slotsList'),
    slotsCount:     $('slotsCount'),
};

// ── App State ────────────────────────────────────
const state = {
    phase:        'idle',   // 'idle' | 'listening' | 'thinking' | 'speaking'
    callActive:   false,
    sessionId:    null,
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

    ws.onmessage = ({ data }) => {
        try {
            const { appointments = [], availableSlots = [], logs = [], whatsappStatus = {} } = JSON.parse(data);
            renderDashboard(appointments, availableSlots, logs, whatsappStatus);
        } catch (e) {
            console.error('WebSocket parse error:', e);
        }
    };
}

// ── Dashboard Render ─────────────────────────────
function fmtTime(iso) {
    const d = new Date(iso);
    return {
        time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        date: d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }),
    };
}

function esc(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderDashboard(appointments, slots, logs = []) {
    // Appointments
    DOM.apptCount.textContent = appointments.length;
    if (!appointments.length) {
        DOM.apptList.innerHTML = '<p class="placeholder-msg">No appointments yet.</p>';
    } else {
        appointments.sort((a, b) => new Date(a.time) - new Date(b.time));
        DOM.apptList.innerHTML = appointments.map(a => {
            const { time, date } = fmtTime(a.time);
            return `<div class="appt-card">
                <div>
                    <div class="appt-time">${esc(time)} <span class="appt-date">· ${esc(date)}</span></div>
                    <div class="appt-name">${esc(a.patientName)}</div>
                </div>
                <span class="confirmed-badge">✓ Confirmed</span>
            </div>`;
        }).join('');
    }

    // Slots
    DOM.slotsCount.textContent = slots.length;
    if (!slots.length) {
        DOM.slotsList.innerHTML = '<p class="placeholder-msg">No slots available.</p>';
    } else {
        DOM.slotsList.innerHTML = slots.map(s => {
            const { time, date } = fmtTime(s);
            return `<span class="slot-tag">${esc(time)} · ${esc(date)}</span>`;
        }).join('');
    }

    // Logs
    const logsCount = $('logsCount');
    const liveLogsList = $('liveLogsList');
    if (logsCount && liveLogsList) {
        logsCount.textContent = logs.length;
        if (!logs.length) {
            liveLogsList.innerHTML = '<p class="placeholder-msg">No activity yet.</p>';
        } else {
            liveLogsList.innerHTML = logs.map(log => {
                const time = new Date(log.timestamp).toLocaleTimeString();
                const icon = log.role === 'user' ? '👤' : (log.role === 'ai' ? '🤖' : '⚙️');
                const extraInfo = log.extra?.ip ? `<div style="font-size: 0.65rem; color: #6b7280; margin-top: 0.25rem;">IP: ${esc(log.extra.ip)} | Device: ${esc(log.extra.userAgent)}</div>` : '';
                return `<div style="margin-bottom: 0.5rem; padding-bottom: 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.1);">
                    <div style="font-size: 0.75rem; color: #9ca3af; margin-bottom: 0.25rem;">[${log.source}] ${time} - ${esc(log.sessionId)}</div>
                    <div><strong>${icon}</strong> ${esc(log.text)}</div>
                    ${extraInfo}
                </div>`;
            }).join('');
        }
    }

    // Render WhatsApp Connection Panel
    const waDot = $('waDot');
    const waLabel = $('waLabel');
    const waBody = $('waBody');

    if (waDot && waLabel && waBody) {
        if (whatsappStatus.ready) {
            waDot.style.background = '#10b981'; // Green
            waLabel.textContent = 'Active & Connected';
            waBody.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; gap: 0.75rem; color: #34d399;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M13.601 2.326A7.854 7.854 0 0 0 7.994 0C3.627 0 .068 3.558.064 7.926c0 1.399.366 2.76 1.057 3.965L0 16l4.204-1.102a7.933 7.933 0 0 0 3.79.907h.003c4.368 0 7.927-3.558 7.929-7.93a7.86 7.86 0 0 0-2.325-5.643h-.003zM8.001 14.55a6.572 6.572 0 0 1-3.356-.92l-.24-.144-2.494.654.666-2.433-.156-.251a6.56 6.56 0 0 1-1.007-3.505c0-3.626 2.957-6.584 6.591-6.584a6.56 6.56 0 0 1 4.66 1.931 6.557 6.557 0 0 1 1.928 4.66c-.004 3.639-2.961 6.592-6.592 6.592zm3.69-4.29c-.202-.101-1.2-.59-1.385-.658-.182-.066-.315-.1-.45.1-.136.2-.527.658-.646.793-.119.135-.239.149-.44.049-2.009-.977-3.21-1.996-3.856-3.111-.17-.291-.018-.448.125-.59.13-.127.29-.34.436-.5.145-.165.193-.275.29-.46.096-.185.048-.347-.024-.49-.071-.144-.645-1.554-.882-2.122-.232-.557-.464-.482-.646-.492-.167-.008-.36-.01-.55-.01s-.5.07-.763.35c-.264.28-1.012 1.01-1.012 2.46 0 1.45.986 2.85 1.124 3.037.137.185 2.017 3.082 4.99 4.364.707.306 1.258.489 1.691.626.711.226 1.36.195 1.871.118.571-.085 1.2-.49 1.37-1.002.17-.51.17-.95.12-1.002-.05-.053-.18-.085-.38-.187z"/>
                    </svg>
                    <strong>Alex Bot is Online & Ready to Receive Messages!</strong>
                    <p style="font-size: 0.85rem; color: #9ca3af; max-width: 400px; margin: 0;">Patients can text your WhatsApp number directly to consult or book appointments.</p>
                </div>
            `;
        } else if (whatsappStatus.qr) {
            waDot.style.background = '#f59e0b'; // Amber
            waLabel.textContent = 'Action Required';
            waBody.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; gap: 1rem;">
                    <p style="font-weight: 500; font-size: 0.95rem; color: #f3f4f6; margin: 0;">Scan this QR code with WhatsApp on your phone to link Alex Bot:</p>
                    <div style="background: white; padding: 1rem; border-radius: 12px; display: inline-block;">
                        <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(whatsappStatus.qr)}" alt="WhatsApp QR Code" style="display: block; width: 200px; height: 200px;" />
                    </div>
                    <ol style="font-size: 0.85rem; text-align: left; max-width: 350px; color: #9ca3af; margin: 0; padding-left: 1.25rem;">
                        <li>Open WhatsApp on your phone</li>
                        <li>Tap <strong>Settings</strong> &rarr; <strong>Linked Devices</strong> &rarr; <strong>Link a Device</strong></li>
                        <li>Point your phone camera at this screen to scan</li>
                    </ol>
                </div>
            `;
        } else {
            waDot.style.background = '#6b7280'; // Grey
            waLabel.textContent = 'Disconnected';
            waBody.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; gap: 0.5rem; color: #9ca3af;">
                    <p>WhatsApp engine is starting up. Please wait...</p>
                </div>
            `;
        }
    }
}

// ════════════════════════════════════════════════
// TTS — Web Speech API (100% Free, No Billing)
// Picks best available English voice automatically
// ════════════════════════════════════════════════
function speak(text) {
    return new Promise((resolve) => {
        setPhase('speaking');
        speechSynthesis.cancel(); // clear any pending speech

        // Clean out specific tags from spoken text
        let cleanText = text || '';
        cleanText = cleanText.replace(/\[BOOK:\s*[^\]]+\]/gi, '');
        cleanText = cleanText.replace(/\[SEND_WHATSAPP:\s*[^\]]+\]/gi, '');
        cleanText = cleanText.replace(/\[TABLE:\s*[^\]]+\]/gi, '');
        cleanText = cleanText.replace(/\[DOCTORS_CHART\]/gi, '');
        cleanText = cleanText.replace(/\s+/g, ' ').trim();

        if (!cleanText) {
            resolve();
            return;
        }

        const utter  = new SpeechSynthesisUtterance(cleanText);
        utter.rate   = 0.92;  // slightly slower = clearer
        utter.pitch  = 1.0;
        utter.volume = 1.0;

        // Priority order: Best natural-sounding beautiful female voices (Jenny, Michelle, Aria, Sonia, etc.)
        const voices = speechSynthesis.getVoices();
        
        if (state.language === 'ta-IN') {
            utter.lang = 'ta-IN'; // Force browser's phonetic engine to Tamil
            // Find a premium female Tamil voice
            utter.voice = 
                voices.find(v => v.lang.includes('ta') && v.name.includes('Pallavi')) ||
                voices.find(v => v.name.includes('Google') && v.name.includes('Tamil')) ||
                voices.find(v => v.lang.includes('ta') && v.name.toLowerCase().includes('female')) ||
                voices.find(v => v.lang.includes('ta')) || 
                voices[0] || null;
        } else {
            utter.lang = 'en-US';
            utter.voice  =
                // 1. Premium Edge/Windows Natural Female Voices (Beautiful & Ultra-realistic)
                voices.find(v => v.name.includes('Jenny Online (Natural)')) ||
                voices.find(v => v.name.includes('Michelle Online (Natural)')) ||
                voices.find(v => v.name.includes('Aria Online (Natural)')) ||
                voices.find(v => v.name.includes('Sonia Online (Natural)')) ||
                voices.find(v => v.name.includes('Natasha Online (Natural)')) ||
                // 2. High-Quality Google Chrome Female Voices
                voices.find(v => v.name === 'Google UK English Female') ||
                voices.find(v => v.name === 'Google US English') ||
                // 3. Fallbacks for other platforms (Safari, Mobile, standard OS)
                voices.find(v => v.name.toLowerCase().includes('female') && v.lang.startsWith('en')) ||
                voices.find(v => v.name.includes('Zira')) ||  // Standard Windows female desktop
                voices.find(v => v.name.includes('Hazel')) || // Standard UK female desktop
                voices.find(v => v.lang === 'en-US') ||
                voices[0] || null;
        }

        utter.onend   = resolve;
        utter.onerror = resolve;
        speechSynthesis.speak(utter);
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

    const reply = await sendToAI(text);
    if (reply) addBubble('ai', reply);

    await speak(reply || "I'm sorry, I couldn't process that. Please try again.");

    // Continue conversation loop
    if (state.callActive) startListening();
}

async function sendToAI(message) {
    try {
        const res = await fetch('/chat', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ sessionId: state.sessionId, message, language: state.language }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { reply } = await res.json();
        return reply || '';
    } catch (err) {
        console.error('AI request failed:', err);
        return "I'm sorry, I'm having a connection issue right now. Please try again.";
    }
}

// ── UI Sounds ────────────────────────────────────
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playClickSound() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, audioCtx.currentTime + 0.1);
    
    gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
}

// ════════════════════════════════════════════════
// Mic Button
// ════════════════════════════════════════════════
async function handleMicClick() {
    playClickSound();
    if (!state.recognition) return;

    if (!state.callActive) {
        // ── START CALL ──
        state.callActive = true;
        if (DOM.endCallBtn) DOM.endCallBtn.classList.remove('hidden');

        const greeting = "Hello! I am Alex, assistant of Jeevankishore from MedGuard Clinic. How can I help you today?";
        addBubble('ai', greeting);
        await speak(greeting);
        if (state.callActive) startListening();

    } else {
        // ── PUSH TO TALK / INTERRUPT ──
        if (state.phase === 'speaking') {
            speechSynthesis.cancel();
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
    speechSynthesis.cancel();
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
// Transcript Bubbles
// ════════════════════════════════════════════════
function addBubble(role, text, isInterim = false) {
    DOM.transcriptEmpty.classList.add('hidden');

    const el = document.createElement('div');
    el.className = `bubble ${role}${isInterim ? ' interim' : ''}`;

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
    const chartRegex = /\[DOCTORS_CHART\]/i;
    if (cleanTextDisplay.match(chartRegex)) {
        cleanTextDisplay = cleanTextDisplay.replace(chartRegex, '').trim();
        parsedDoctorsChartHTML = `
            <div style="margin-top: 10px; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; overflow: hidden; font-size: 0.85rem; width: 100%;">
                <table style="width: 100%; border-collapse: collapse; text-align: left; color: #fff;">
                    <thead style="background: rgba(255,255,255,0.1);">
                        <tr>
                            <th style="padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.2);">Doctor Name</th>
                            <th style="padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.2);">Specialty</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">
                            <td style="padding: 8px 12px;">Dr. Sarah Jenkins</td>
                            <td style="padding: 8px 12px; color: #9ca3af;">General Physician</td>
                        </tr>
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">
                            <td style="padding: 8px 12px;">Dr. Michael Chen</td>
                            <td style="padding: 8px 12px; color: #9ca3af;">Cardiologist</td>
                        </tr>
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">
                            <td style="padding: 8px 12px;">Dr. Emily Rodriguez</td>
                            <td style="padding: 8px 12px; color: #9ca3af;">Dermatologist</td>
                        </tr>
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">
                            <td style="padding: 8px 12px;">Dr. David Smith</td>
                            <td style="padding: 8px 12px; color: #9ca3af;">Orthopedist</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 12px;">Dr. Priya Patel</td>
                            <td style="padding: 8px 12px; color: #9ca3af;">Pediatrician</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `;
    }

    const formattedText = esc(cleanTextDisplay).replace(/\n/g, '<br>') + parsedTableHTML + parsedDoctorsChartHTML;

    el.innerHTML = `
        <div class="bubble-label">${role === 'user' ? 'You' : '🤖 MedGuard AI'}</div>
        <div class="bubble-text" style="line-height: 1.5;">${formattedText}</div>
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
// Boot
// ════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
    initSession();
    initWebSocket();
    state.recognition = checkSpeechSupport() ? buildRecognition(checkSpeechSupport()) : null;
    
    // Add event listener for Text Chat
    const textChatForm = $('textChatForm');
    const textChatInput = $('textChatInput');
    
    if (textChatForm && textChatInput) {
        textChatForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const text = textChatInput.value.trim();
            if (!text) return;
            
            textChatInput.value = '';
            addBubble('user', text);
            
            setPhase('thinking');
            const reply = await sendToAI(text);
            if (reply) addBubble('ai', reply);
            
            setPhase('idle');
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
        });
    }

    // Pre-load browser TTS voices (Chrome loads async)
    speechSynthesis.getVoices();
    speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();

    setPhase('idle');
});
