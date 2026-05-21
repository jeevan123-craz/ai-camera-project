const CONFIG = {
    cameraUrl: localStorage.getItem('cameraUrl') || "",
    cameraSource: localStorage.getItem('cameraSource') || 'webcam', // 'webcam' or 'ip'
    refreshRate: 1000, // ms for IP camera refresh
    detectionInterval: 200, // ms for AI detection (throttled)
    telegramToken: localStorage.getItem('telegramToken') || "",
    telegramChatId: localStorage.getItem('telegramChatId') || "",
    telegramProxyUrl: localStorage.getItem('telegramProxyUrl') || "",
};

// Global State
let handModel = null;
let faceModel = null;
let yoloModel = null;
let isEmergency = false;
let isEating = false;
let lastEatingTime = 0;
let lastFaceDetectedTime = Date.now();
let emergencyAudioContext = null;
let emergencyOscillator = null;
let animationId = null;
let stream = null;
let manualEmergency = false;

// BUG FIX #5/#6 – hold-to-confirm + eating smoothing
let emergencyHoldStart = null;       // timestamp when open-hand hold began
const EMERGENCY_HOLD_MS = 2000;      // 2 seconds to confirm
let eatingFrameCount = 0;            // consecutive eating detection frames
const EATING_FRAMES_REQUIRED = 3;    // need 3 in a row

// BUG FIX #8 – patient-absent Telegram
let patientAbsentTelegramSent = false;

// NEW FEATURE #6 – session stats
const sessionStartTime = Date.now();
let eatingEventsToday = parseInt(localStorage.getItem('eatingEventsToday') || '0');
let alertCountToday = parseInt(localStorage.getItem('alertCountToday') || '0');

// NEW FEATURE #9 – persistent eating chart data
const CHART_STORAGE_KEY = 'eatingChartData';

// Visitor State
let visitorCount = 0;
let currentVisitors = 0;
let lastVisitorCount = 0;

// DOM Elements
const webcamVideo = document.getElementById("webcamVideo");
const ipCameraImage = document.getElementById("ipCameraImage");
const canvas = document.getElementById("canvas");
const ctx = canvas ? canvas.getContext("2d") : null;
const loadingMsg = document.getElementById("loadingMsg");
const eventLog = document.getElementById("eventLog");
const alertSound = document.getElementById("alertSound");
const emergencyOverlay = document.getElementById("emergencyOverlay");

const camSourceSelect = document.getElementById("camSourceSelect");
const faceStatusText = document.getElementById("faceStatusText");
const faceStatusDiv = document.getElementById("faceStatus");

// Status Update Helper
function updateStatus(msg, isError = false) {
    if (loadingMsg) {
        loadingMsg.style.display = 'block';
        loadingMsg.innerText = msg;
        if (isError) {
            loadingMsg.style.color = '#ff4444';
            loadingMsg.style.backgroundColor = 'rgba(0,0,0,0.8)';
            loadingMsg.style.padding = '10px';
            loadingMsg.style.borderRadius = '5px';
        } else {
            loadingMsg.style.color = 'white';
            loadingMsg.style.backgroundColor = 'transparent';
        }
    }
    console.log(`[Status] ${msg}`);
}

// Initialize Camera
async function initCamera() {
    updateStatus("Initializing Camera...");

    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }

    if (CONFIG.cameraSource === 'webcam') {
        webcamVideo.style.display = 'block';
        ipCameraImage.style.display = 'none';
        if (canvas) canvas.style.transform = "scaleX(-1)";

        try {
            updateStatus("Requesting Webcam Access...");
            stream = await navigator.mediaDevices.getUserMedia({ video: true });
            webcamVideo.srcObject = stream;

            await new Promise((resolve) => {
                webcamVideo.onloadedmetadata = () => {
                    webcamVideo.play();
                    canvas.width = webcamVideo.videoWidth;
                    canvas.height = webcamVideo.videoHeight;
                    resolve();
                };
            });
            updateStatus("Webcam Active");

        } catch (err) {
            console.error("Webcam error:", err);
            // BUG FIX #10: Show a clear error, do NOT silently switch to IP mode
            updateStatus(`❌ Webcam Access Denied: ${err.message}. Please allow camera access and refresh.`, true);
            // Do NOT auto-switch – if no IP URL is configured it would show a broken feed
        }
    } else {
        webcamVideo.srcObject = null;
        webcamVideo.style.display = 'none';
        ipCameraImage.style.display = 'block';
        if (canvas) canvas.style.transform = "scaleX(1)";
        updateIpCameraFeed();
        updateStatus("IP Camera Mode Active");
    }
}

// Simplified IP Camera Handler with Robust Retry
let ipCamTimeout = null;

const updateIpCameraFeed = () => {
    if (CONFIG.cameraSource !== 'ip') return;
    if (!CONFIG.cameraUrl) {
        updateStatus("No IP Camera URL Configured", true);
        return;
    }

    if (ipCamTimeout) clearTimeout(ipCamTimeout);

    // Prepare Candidates
    // 1. Exact URL provided by user
    // 2. Base + /video (MJPEG Stream)
    // 3. Base + /shot.jpg (Snapshot)
    let base = CONFIG.cameraUrl.replace(/\/+$/, ''); // Remove trailing slashes

    // If the user already provided a specific path (like /video), we should still try it first.
    // But we also want to try variants if that fails.

    const candidates = [
        base,
        base + '/video',
        base + '/shot.jpg',
        base + '/mjpeg'
    ];

    // Remove duplicates
    const uniqueCandidates = [...new Set(candidates)];

    let attemptIndex = 0;

    const loadFrame = () => {
        if (CONFIG.cameraSource !== 'ip') return;

        const targetUrl = uniqueCandidates[attemptIndex];

        // Update Status
        updateStatus(`Connecting to: ...${targetUrl.slice(-15)}`, false);
        console.log(`[IP Cam] Trying: ${targetUrl}`);

        // Construct Proxy URL
        const proxyBase = '/camera?url=';
        const encodedTarget = encodeURIComponent(targetUrl);
        const proxyUrl = `${proxyBase}${encodedTarget}&t=${Date.now()}`;

        ipCameraImage.src = proxyUrl;

        // Store for static refresh logic
        ipCameraImage.dataset.currentUrl = targetUrl;
    };

    // Attach Handlers (Idempotent)
    if (!ipCameraImage.hasAttribute('data-handlers-attached')) {
        ipCameraImage.setAttribute('data-handlers-attached', 'true');

        ipCameraImage.onload = () => {
            updateStatus("IP Camera Active");
            ipCameraImage.style.display = 'block';
            console.log(`[IP Cam] Success with: ${ipCameraImage.dataset.currentUrl}`);

            // Check if Static Image -> Refresh loop
            // We assume /shot.jpg or ending in .jpg is static
            const url = ipCameraImage.dataset.currentUrl || '';
            const isStatic = url.includes('shot.jpg') || url.match(/\.(jpg|jpeg|png)$/i);

            if (isStatic) {
                ipCamTimeout = setTimeout(loadFrame, CONFIG.refreshRate);
            }
        };

        ipCameraImage.onerror = () => {
            console.warn(`[IP Cam] Failed to load: ${uniqueCandidates[attemptIndex]}`);

            attemptIndex++;
            if (attemptIndex < uniqueCandidates.length) {
                // Try next candidate immediately
                loadFrame();
            } else {
                // All candidates failed
                updateStatus("Connection Failed. Checking next in 5s...", true);
                attemptIndex = 0; // Reset to try again from top
                ipCamTimeout = setTimeout(loadFrame, 5000);
            }
        };
    }

    // Start
    loadFrame();
};

// Camera Source Change Listener
if (camSourceSelect) {
    camSourceSelect.value = CONFIG.cameraSource;
    camSourceSelect.addEventListener('change', (e) => {
        CONFIG.cameraSource = e.target.value;
        localStorage.setItem('cameraSource', CONFIG.cameraSource);
        initCamera();
    });
}

// Helper Functions
function dist(p1, p2) {
    return Math.sqrt(Math.pow(p1[0] - p2[0], 2) + Math.pow(p1[1] - p2[1], 2));
}

function drawHand(landmarks) {
    if (!ctx) return;
    ctx.fillStyle = isEmergency ? "#ef4444" : "#38bdf8";
    for (let i = 0; i < landmarks.length; i++) {
        const x = landmarks[i][0];
        const y = landmarks[i][1];
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, 3 * Math.PI);
        ctx.fill();
    }
}

function isHandOpen(landmarks) {
    const wrist = landmarks[0];
    const fingers = [
        { tip: 4, base: 2 },   // Thumb
        { tip: 8, base: 5 },   // Index
        { tip: 12, base: 9 },  // Middle
        { tip: 16, base: 13 }, // Ring
        { tip: 20, base: 17 }  // Pinky
    ];

    let extendedCount = 0;
    for (const finger of fingers) {
        const tipPos = landmarks[finger.tip];
        const basePos = landmarks[finger.base];
        const tipDist = dist(tipPos, wrist);
        const baseDist = dist(basePos, wrist);
        if (tipDist > baseDist * 1.2) {
            extendedCount++;
        }
    }
    return extendedCount === 5;
}

// Emergency Logic
function triggerEmergency() {
    isEmergency = true;
    if (emergencyOverlay) emergencyOverlay.style.display = "flex";
    alertCountToday++;
    localStorage.setItem('alertCountToday', alertCountToday);
    const alertEl = document.getElementById('alertCount');
    if (alertEl) alertEl.innerText = alertCountToday;
    logEvent("EMERGENCY: HELP REQUIRED", "eating", true); // BUG FIX #7: send Telegram
    startSiren();
}

function stopEmergency() {
    isEmergency = false;
    if (emergencyOverlay) emergencyOverlay.style.display = "none";
    stopSiren();
}

function startSiren() {
    if (!emergencyAudioContext) {
        try {
            emergencyAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) { console.error("AudioContext not supported"); return; }
    }

    if (emergencyAudioContext.state === 'suspended') {
        emergencyAudioContext.resume();
    }
    if (emergencyOscillator) return;

    emergencyOscillator = emergencyAudioContext.createOscillator();
    emergencyOscillator.type = 'sawtooth';
    emergencyOscillator.frequency.setValueAtTime(440, emergencyAudioContext.currentTime);
    emergencyOscillator.frequency.linearRampToValueAtTime(880, emergencyAudioContext.currentTime + 0.5);
    emergencyOscillator.frequency.linearRampToValueAtTime(440, emergencyAudioContext.currentTime + 1.0);

    const gainNode = emergencyAudioContext.createGain();
    gainNode.gain.value = 0.5;
    emergencyOscillator.connect(gainNode);
    gainNode.connect(emergencyAudioContext.destination);
    emergencyOscillator.start();

    const sirenInterval = setInterval(() => {
        if (!isEmergency || !emergencyOscillator) {
            clearInterval(sirenInterval);
            return;
        }
        const time = emergencyAudioContext.currentTime;
        emergencyOscillator.frequency.setValueAtTime(440, time);
        emergencyOscillator.frequency.linearRampToValueAtTime(880, time + 0.5);
    }, 1000);
}

function stopSiren() {
    if (emergencyOscillator) {
        try {
            emergencyOscillator.stop();
            emergencyOscillator.disconnect();
        } catch (e) { }
        emergencyOscillator = null;
    }
}

// Eating Detection Logic
function triggerEatingEvent() {
    const now = Date.now();
    if (now - lastEatingTime < 3000) return;

    isEating = true;
    lastEatingTime = now;

    // FEATURE #6: update eating stat counter
    eatingEventsToday++;
    localStorage.setItem('eatingEventsToday', eatingEventsToday);
    const eatEl = document.getElementById('eatingEventsCount');
    if (eatEl) eatEl.innerText = eatingEventsToday;

    if (alertSound) alertSound.play().catch(e => { });
    logEvent("Eating Detected", "normal"); // no Telegram for eating (BUG FIX #7)
    updateActivityChart();
}

// Telegram Logic
let telegramDebounceTimers = {};

async function sendTelegramMessage(message) {
    const token = CONFIG.telegramToken;
    const chatId = CONFIG.telegramChatId;

    console.log(`[Telegram] Checking config... Token: ${token ? 'SET' : 'MISSING'}, ChatID: ${chatId ? 'SET' : 'MISSING'}`);

    if (!token || !chatId) {
        console.warn("[Telegram] Missing Bot Token or Chat ID. Cannot send message.");
        return;
    }

    // Debounce similar messages to avoid spamming the API (10 seconds)
    if (telegramDebounceTimers[message] && Date.now() - telegramDebounceTimers[message] < 10000) {
        console.log(`[Telegram] Skipped duplicate message: ${message}`);
        return;
    }
    telegramDebounceTimers[message] = Date.now();

    const url = `/telegram`;
    console.log(`[Telegram] Sending message to Chat ID ${chatId} via Proxy: ${message}`);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                token: token,
                chatId: chatId,
                text: "🚨 *MedGuard Alert*\n" + message,
                proxyUrl: CONFIG.telegramProxyUrl // Relay custom proxy config to backend
            })
        });

        const data = await response.json();
        if (!response.ok) {
            console.error("[Telegram] API Error Response:", data);
        } else {
            console.log("[Telegram] Message sent successfully via Proxy!");
        }
    } catch (e) {
        console.error("[Telegram] Network/Fetch Error:", e);
    }
}

function logEvent(message, type = "normal", sendTelegram = false) {
    if (!eventLog) return;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const div = document.createElement("div");
    div.className = "event-item";
    div.innerHTML = `
        <span class="event-time">${time}</span>
        <span class="event-type ${type}">${message}</span>
    `;
    eventLog.prepend(div);

    // NEW FEATURE #8: Persist last 200 events to localStorage
    const saved = JSON.parse(localStorage.getItem('eventLog') || '[]');
    saved.unshift({ time, message, type });
    if (saved.length > 200) saved.length = 200;
    localStorage.setItem('eventLog', JSON.stringify(saved));

    // BUG FIX #7: Only send Telegram when explicitly requested
    if (sendTelegram) {
        sendTelegramMessage(message);
    }

    // Sync to Proxy for AI Assistant
    syncStatsToProxy();
}

async function syncStatsToProxy() {
    const stats = {
        patientPresent: (Date.now() - lastFaceDetectedTime < 5000),
        isEmergency,
        isEating,
        eatingEventsToday,
        alertCountToday,
        visitorCount,
        lastEvent: JSON.parse(localStorage.getItem('eventLog') || '[]')[0] || null
    };

    try {
        await fetch('http://localhost:8081/update-stats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(stats)
        });
    } catch (e) {
        // Silently fail if proxy isn't running
    }
}

// Auto-sync every 10 seconds
setInterval(syncStatsToProxy, 10000);

// AI Model Initialization
async function initModels() {
    try {
        await initCamera();
    } catch (e) {
        console.error("Camera Init Error in initModels:", e);
    }

    // Wrapper to enforce timeout
    const loadAI = async () => {
        let loadedAnything = false;

        // 1. Initialize TensorFlow
        try {
            updateStatus("Checking AI Libraries...");
            if (typeof tf === 'undefined') throw new Error("TensorFlow.js Library Missing! Check Internet Connection.");

            updateStatus("Initializing TensorFlow...");
            await tf.ready();
            await tf.setBackend('webgl');
            console.log("TF Backend:", tf.getBackend());
        } catch (err) {
            console.error("TF Init Error:", err);
            updateStatus(`TF Init Failed: ${err.message}`, true);
            return false;
        }

        // 2. Load Models
        try {
            updateStatus("Loading Handpose Model...");
            if (typeof handpose === 'undefined') throw new Error("Handpose Library Missing");
            handModel = await handpose.load();
            loadedAnything = true;
            console.log("Handpose loaded");
        } catch (e) {
            console.warn("Handpose failed:", e);
            updateStatus("Handpose Failed to Load", true);
        }

        try {
            updateStatus("Loading Face Model...");
            if (typeof blazeface === 'undefined') throw new Error("Blazeface Library Missing");
            faceModel = await blazeface.load();
            loadedAnything = true;
            console.log("Blazeface loaded");
        } catch (e) {
            console.warn("Blazeface failed:", e);
            updateStatus("Blazeface Failed to Load", true);
        }

        try {
            updateStatus("Loading YOLO Model...");
            if (typeof cocoSsd === 'undefined') throw new Error("COCO-SSD Library Missing");
            yoloModel = await cocoSsd.load();
            loadedAnything = true;
            console.log("COCO-SSD loaded");
        } catch (e) {
            console.warn("COCO-SSD failed:", e);
            updateStatus("COCO-SSD Failed to Load", true);
        }

        return loadedAnything;
    };

    const timeout = new Promise((resolve) => {
        setTimeout(() => resolve('TIMEOUT'), 15000); // Increased timeout to 15s for slower connections
    });

    try {
        const result = await Promise.race([loadAI(), timeout]);

        if (result === 'TIMEOUT') {
            console.warn("AI Loading Timed Out");
            updateStatus("AI Loading Timed Out - Check Connection", true);

            // Allow retry or continue without AI
            setTimeout(() => {
                if (loadingMsg) loadingMsg.style.display = "none";
            }, 3000);

        } else if (result === true) {
            console.log("AI Loaded Successfully");
            updateStatus("System Ready");
            setTimeout(() => {
                if (loadingMsg) loadingMsg.style.display = "none";
            }, 1000);

            if (faceStatusDiv) faceStatusDiv.style.display = "block";
        } else {
            // TF Failed or both models failed
            updateStatus("AI Init Failed - Camera Only Mode", true);
            setTimeout(() => { if (loadingMsg) loadingMsg.style.display = "none"; }, 3000);
        }
    } catch (e) {
        console.error("Critical AI Error:", e);
        updateStatus(`Critical Error: ${e.message}`, true);
        // if (loadingMsg) loadingMsg.style.display = "none";
    }

    // Always start detection loop, even if models failed
    startDetectionLoop();
}

let lastDetectionTime = 0;

function startDetectionLoop() {
    const loop = async (timestamp) => {
        let activeElement = CONFIG.cameraSource === 'webcam' ? webcamVideo : ipCameraImage;

        if (CONFIG.cameraSource === 'webcam') {
            if (webcamVideo.readyState !== 4) {
                animationId = requestAnimationFrame(loop);
                return;
            }
        } else {
            if (!ipCameraImage.complete || ipCameraImage.naturalWidth === 0) {
                animationId = requestAnimationFrame(loop);
                return;
            }
        }

        // Throttle detection to save resources
        if (timestamp - lastDetectionTime < CONFIG.detectionInterval) {
            animationId = requestAnimationFrame(loop);
            return;
        }
        lastDetectionTime = timestamp;

        // Draw video frame to canvas
        if (CONFIG.cameraSource === 'ip') {
            canvas.width = ipCameraImage.naturalWidth || 640;
            canvas.height = ipCameraImage.naturalHeight || 480;
            try {
                ctx.drawImage(ipCameraImage, 0, 0, canvas.width, canvas.height);
            } catch (e) { }
        } else {
            // For webcam, video is already playing, just draw it
            try {
                ctx.drawImage(webcamVideo, 0, 0, canvas.width, canvas.height);
            } catch (e) { }
        }

        // If no AI models, just inform user on canvas
        if (!handModel && !faceModel) {
            animationId = requestAnimationFrame(loop);
            return;
        }

        // 1. Face Detection
        if (faceModel) {
            try {
                const faces = await faceModel.estimateFaces(activeElement, false);
                if (faces.length > 0) {
                    lastFaceDetectedTime = Date.now();

                    // SAVE FACE BOX FOR EATING LOGIC
                    const face = faces[0];
                    window.currentFaceBox = {
                        x: face.topLeft[0],
                        y: face.topLeft[1],
                        width: face.bottomRight[0] - face.topLeft[0],
                        height: face.bottomRight[1] - face.topLeft[1]
                    };

                    if (faces.length > 1) {
                        const visitors = faces.length - 1;
                        faceStatusText.innerText = `Visitor Detected (${visitors})`;
                        faceStatusDiv.className = 'face-status-info';

                        currentVisitors = visitors;
                        if (visitors > lastVisitorCount) {
                            visitorCount += (visitors - lastVisitorCount);
                            document.getElementById('totalVisitors').innerText = visitorCount;
                            logEvent(`New Visitor Detected`, 'normal');
                        }
                        lastVisitorCount = visitors;
                        document.getElementById('currentVisitors').innerText = currentVisitors;
                    } else {
                        faceStatusText.innerText = "Patient Active";
                        faceStatusDiv.className = 'face-status-active';
                        currentVisitors = 0;
                        lastVisitorCount = 0;
                        document.getElementById('currentVisitors').innerText = 0;
                    }

                    // Reset patient-absent flag when face returns
                    patientAbsentTelegramSent = false;

                    // Face badge (Feature #12)
                    const bFaceOn = document.getElementById('badgeFace');
                    if (bFaceOn) { bFaceOn.style.display = 'inline'; bFaceOn.style.color = '#4ade80'; }

                    // Draw face box
                    faces.forEach(face => {
                        const start = face.topLeft;
                        const end = face.bottomRight;
                        const size = [end[0] - start[0], end[1] - start[1]];
                        ctx.strokeStyle = '#38bdf8';
                        ctx.lineWidth = 2;
                        ctx.strokeRect(start[0], start[1], size[0], size[1]);
                    });
                } else {
                    window.currentFaceBox = null; // No face
                    const timeSinceLastFace = Date.now() - lastFaceDetectedTime;

                    // BUG FIX #8 / FEATURE #4: send ONE Telegram after 10s absent
                    if (timeSinceLastFace > 10000 && !patientAbsentTelegramSent) {
                        patientAbsentTelegramSent = true;
                        sendTelegramMessage('\u26a0\ufe0f Patient not visible for 10+ seconds.');
                        logEvent('Patient Not Detected (10s)', 'eating');
                        alertCountToday++;
                        localStorage.setItem('alertCountToday', alertCountToday);
                        const alertEl = document.getElementById('alertCount');
                        if (alertEl) alertEl.innerText = alertCountToday;
                    }

                    if (timeSinceLastFace > 5000) {
                        faceStatusText.innerText = "Patient Not Detected!";
                        faceStatusDiv.className = 'face-status-danger';
                    } else {
                        faceStatusText.innerText = "Detecting...";
                        faceStatusDiv.className = 'face-status-warning';
                    }

                    // Update badges
                    const bFace = document.getElementById('badgeFace');
                    if (bFace) { bFace.style.display = 'none'; }
                }
            } catch (e) {
                console.warn("Face detection error:", e);
            }
        }

        // 2. Hand Detection
        if (handModel) {
            try {
                const predictions = await handModel.estimateHands(activeElement);
                if (predictions.length > 0) {
                    const hand = predictions[0];
                    drawHand(hand.landmarks);
                    processHandLogic(hand.landmarks, predictions.length);
                    // Hand badge (Feature #12)
                    const bH = document.getElementById('badgeHand');
                    if (bH) { bH.style.display = 'inline'; bH.style.color = '#38bdf8'; }
                } else {
                    if (isEmergency && !manualEmergency) stopEmergency();
                    if (isEating) isEating = false;
                    eatingFrameCount = 0;
                    emergencyHoldStart = null;
                    const holdBar = document.getElementById('emergencyHoldBar');
                    if (holdBar) holdBar.style.display = 'none';
                    const bH = document.getElementById('badgeHand');
                    if (bH) bH.style.display = 'none';
                    const bE = document.getElementById('badgeEating');
                    if (bE) bE.style.display = 'none';
                }
            } catch (e) {
                console.warn("Hand detection error:", e);
            }
        }

        // 3. YOLO Object Detection
        if (yoloModel) {
            try {
                const predictions = await yoloModel.detect(activeElement);
                if (predictions.length > 0) {
                    predictions.forEach(prediction => {
                        const [x, y, width, height] = prediction.bbox;
                        const score = Math.round(prediction.score * 100);

                        // Only show if confidence is > 50%
                        if (score > 50) {
                            ctx.strokeStyle = '#4ade80'; // Green for generic objects
                            ctx.lineWidth = 2;
                            ctx.strokeRect(x, y, width, height);

                            ctx.fillStyle = '#4ade80';
                            ctx.font = '14px Arial';
                            ctx.fillText(`${prediction.class} (${score}%)`, x, y > 20 ? y - 5 : y + 20);

                            // Special check for certain objects that might be relevant
                            if (prediction.class === 'bottle' || prediction.class === 'cup') {
                                logEvent(`Patient interacting with ${prediction.class}`, 'normal');
                            }
                        }
                    });
                }
            } catch (e) {
                console.warn("YOLO detection error:", e);
            }
        }

        animationId = requestAnimationFrame(loop);
    };
    animationId = requestAnimationFrame(loop);
}

function processHandLogic(landmarks, handCount) {
    const holdBar  = document.getElementById('emergencyHoldBar');
    const holdFill = document.getElementById('emergencyHoldFill');
    const bEating  = document.getElementById('badgeEating');

    // 1. EMERGENCY HOLD-TO-CONFIRM (BUG FIX #5, FEATURE #1)
    if (isHandOpen(landmarks)) {
        ctx.fillStyle = "rgba(239, 68, 68, 0.8)";
        ctx.fillRect(0, 0, canvas.width, 40);
        ctx.fillStyle = "white";
        ctx.font = "bold 22px Arial";

        if (!emergencyHoldStart) emergencyHoldStart = Date.now();
        const held = Date.now() - emergencyHoldStart;
        const pct  = Math.min(100, (held / EMERGENCY_HOLD_MS) * 100);

        ctx.fillText(`⚠️ Hold to confirm EMERGENCY... ${Math.ceil((EMERGENCY_HOLD_MS - held) / 1000)}s`, 20, 28);

        if (holdBar)  { holdBar.style.display  = 'block'; }
        if (holdFill) { holdFill.style.width    = pct + '%'; }

        if (held >= EMERGENCY_HOLD_MS && !isEmergency) {
            triggerEmergency();
        }
        // Reset eating while holding
        eatingFrameCount = 0;
        return;
    } else {
        // Hand no longer open — cancel hold
        emergencyHoldStart = null;
        if (holdBar)  holdBar.style.display  = 'none';
        if (holdFill) holdFill.style.width   = '0%';
        if (isEmergency && !manualEmergency) stopEmergency();
    }

    // 2. EATING DETECTION with smoothing (BUG FIX #6, FEATURE #2)
    const indexTip = landmarks[8];
    let mouthX, mouthY;

    if (window.currentFaceBox) {
        mouthX = window.currentFaceBox.x + (window.currentFaceBox.width * 0.5);
        mouthY = window.currentFaceBox.y + (window.currentFaceBox.height * 0.75);
        ctx.strokeStyle = "#4ade80";
        ctx.beginPath();
        ctx.arc(mouthX, mouthY, 40, 0, 2 * Math.PI);
        ctx.stroke();
    } else {
        mouthX = canvas.width / 2;
        mouthY = canvas.height * 0.45;
    }

    const distToMouth = Math.sqrt(
        Math.pow(indexTip[0] - mouthX, 2) + Math.pow(indexTip[1] - mouthY, 2)
    );

    if (distToMouth < 60) {
        eatingFrameCount++;
        ctx.fillStyle = "#4ade80";
        ctx.font = "bold 28px Arial";
        ctx.fillText(`🥣 EATING (${eatingFrameCount}/${EATING_FRAMES_REQUIRED})`, indexTip[0] + 20, indexTip[1]);
        ctx.beginPath();
        ctx.moveTo(indexTip[0], indexTip[1]);
        ctx.lineTo(mouthX, mouthY);
        ctx.lineWidth = 4;
        ctx.strokeStyle = "#4ade80";
        ctx.stroke();

        if (bEating) { bEating.style.display = 'inline'; bEating.style.color = '#4ade80'; }

        // Only trigger after EATING_FRAMES_REQUIRED consecutive frames
        if (eatingFrameCount >= EATING_FRAMES_REQUIRED && !isEating) {
            triggerEatingEvent();
        }
    } else {
        eatingFrameCount = 0;
        isEating = false;
        if (bEating) bEating.style.display = 'none';
    }
}

// Feature Buttons
const btnSnapshot = document.getElementById("btnSnapshot");
if (btnSnapshot) {
    btnSnapshot.addEventListener("click", () => {
        let activeElement = CONFIG.cameraSource === 'webcam' ? webcamVideo : ipCameraImage;
        if (!activeElement) return;

        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = (CONFIG.cameraSource === 'webcam') ? activeElement.videoWidth : activeElement.naturalWidth;
        tempCanvas.height = (CONFIG.cameraSource === 'webcam') ? activeElement.videoHeight : activeElement.naturalHeight;
        const tempCtx = tempCanvas.getContext("2d");

        tempCtx.drawImage(activeElement, 0, 0, tempCanvas.width, tempCanvas.height);
        tempCtx.fillStyle = "white";
        tempCtx.font = "20px Arial";
        tempCtx.fillText("MedGuard Snapshot - " + new Date().toLocaleString(), 20, 40);

        const link = document.createElement("a");
        link.download = `snapshot-${Date.now()}.png`;
        link.href = tempCanvas.toDataURL("image/png");
        link.click();
    });
}

const btnFullscreen = document.getElementById("btnFullscreen");
if (btnFullscreen) {
    btnFullscreen.addEventListener("click", () => {
        const container = document.getElementById("cameraContainer");
        if (!container) return;
        if (!document.fullscreenElement) {
            container.requestFullscreen().catch(err => {
                console.error(`Error attempting to enable fullscreen: ${err.message}`);
            });
        } else {
            document.exitFullscreen();
        }
    });
}

const btnExport = document.getElementById("btnExport");
if (btnExport) {
    btnExport.addEventListener("click", () => {
        if (!eventLog) return;
        let csvContent = "data:text/csv;charset=utf-8,Time,Event\n";
        const items = eventLog.querySelectorAll(".event-item");
        items.forEach(item => {
            const time = item.querySelector(".event-time").innerText;
            const type = item.querySelector(".event-type").innerText;
            csvContent += `${time},${type}\n`;
        });

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "patient_logs.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
}

// Camera Settings
const btnCamSettings = document.getElementById("btnCamSettings");
const camSettingsPanel = document.getElementById("camSettingsPanel");
const camUrlInput = document.getElementById("camUrlInput");
const btnSaveCamUrl = document.getElementById("btnSaveCamUrl");

if (btnCamSettings && camSettingsPanel && camUrlInput) {
    btnCamSettings.addEventListener("click", () => {
        camSettingsPanel.style.display = camSettingsPanel.style.display === "none" ? "flex" : "none";
        camUrlInput.value = CONFIG.cameraUrl;
    });
}

if (btnSaveCamUrl && camUrlInput && camSettingsPanel) {
    btnSaveCamUrl.addEventListener("click", () => {
        const newUrl = camUrlInput.value.trim();
        if (newUrl) {
            CONFIG.cameraUrl = newUrl;
            localStorage.setItem('cameraUrl', newUrl);
            camSettingsPanel.style.display = "none";

            // Reset handlers to allow reconnection
            ipCameraImage.removeAttribute('data-handlers-attached');

            // Trigger reconnection
            updateIpCameraFeed();

            updateStatus("Connecting to new camera URL...", false);
        }
    });
}

// Charts – FEATURE #9: dynamic labels from current hour going back 6h, persisted data
const ctxActivity = document.getElementById('activityChart');
let activityChart = null;

function buildChartLabels() {
    const now = new Date();
    const labels = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 60 * 60 * 1000);
        labels.push(d.getHours().toString().padStart(2, '0') + ':00');
    }
    return labels;
}

function loadChartData(labels) {
    const saved = JSON.parse(localStorage.getItem(CHART_STORAGE_KEY) || '{}');
    return labels.map(l => saved[l] || 0);
}

if (ctxActivity) {
    const chartLabels = buildChartLabels();
    const chartData   = loadChartData(chartLabels);
    activityChart = new Chart(ctxActivity.getContext('2d'), {
        type: 'bar',
        data: {
            labels: chartLabels,
            datasets: [{
                label: 'Eating Events',
                data: chartData,
                backgroundColor: '#38bdf8',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false },
                title: { display: true, text: 'Eating Frequency (Last 6h)', color: '#94a3b8' }
            },
            scales: {
                y: { beginAtZero: true, grid: { color: '#334155' }, ticks: { color: '#94a3b8', stepSize: 1 } },
                x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
            }
        }
    });
}

// BUG FIX #4 / FEATURE #9: find real current hour in labels, persist
function updateActivityChart() {
    if (!activityChart) return;
    const nowHour = new Date().getHours().toString().padStart(2, '0') + ':00';
    const labels  = activityChart.data.labels;
    const idx     = labels.indexOf(nowHour);
    if (idx === -1) return; // current hour not in chart window
    activityChart.data.datasets[0].data[idx]++;
    activityChart.update();
    // Persist
    const saved = JSON.parse(localStorage.getItem(CHART_STORAGE_KEY) || '{}');
    saved[nowHour] = activityChart.data.datasets[0].data[idx];
    localStorage.setItem(CHART_STORAGE_KEY, JSON.stringify(saved));
}

// Settings Modal Logic
const settingsModal = document.getElementById('settingsModal');
const navSettings = document.getElementById('navSettings');
const closeSettingsModal = document.getElementById('closeSettingsModal');
const btnSaveSettings = document.getElementById('btnSaveSettings');

// Inputs
const emailServiceId = document.getElementById('emailServiceId');
const emailTemplateId = document.getElementById('emailTemplateId');
const emailPublicKey = document.getElementById('emailPublicKey');
const telegramTokenInput = document.getElementById('telegramToken');
const telegramChatIdInput = document.getElementById('telegramChatId');
const telegramProxyUrlInput = document.getElementById('telegramProxyUrl');

// FEATURE #5: Patient info helpers
function updateHeaderPatientInfo() {
    const name = localStorage.getItem('patientName') || '—';
    const id   = localStorage.getItem('patientId')   || '—';
    const room = localStorage.getItem('patientRoom') || '—';
    const h = document.getElementById('headerPatientName');
    const p = document.getElementById('headerPatientMeta');
    if (h) h.innerText = `Patient: ${name}`;
    if (p) p.innerText = `ID: #${id} | Room: ${room}`;
}

// Load Settings
function loadSettings() {
    emailServiceId.value = localStorage.getItem('emailServiceId') || '';
    emailTemplateId.value = localStorage.getItem('emailTemplateId') || '';
    emailPublicKey.value = localStorage.getItem('emailPublicKey') || '';
    if (telegramTokenInput) telegramTokenInput.value = CONFIG.telegramToken || '';
    if (telegramChatIdInput) telegramChatIdInput.value = CONFIG.telegramChatId || '';
    if (telegramProxyUrlInput) telegramProxyUrlInput.value = CONFIG.telegramProxyUrl || '';
    // Patient info
    const pn = document.getElementById('patientName');
    const pi = document.getElementById('patientId');
    const pr = document.getElementById('patientRoom');
    if (pn) pn.value = localStorage.getItem('patientName') || '';
    if (pi) pi.value = localStorage.getItem('patientId')   || '';
    if (pr) pr.value = localStorage.getItem('patientRoom') || '';
}

if (navSettings) {
    navSettings.addEventListener('click', (e) => {
        e.preventDefault();
        loadSettings();
        settingsModal.style.display = 'flex';
    });
}

if (closeSettingsModal) {
    closeSettingsModal.addEventListener('click', () => {
        settingsModal.style.display = 'none';
    });
}

if (btnSaveSettings) {
    btnSaveSettings.addEventListener('click', () => {
        // Patient info (FEATURE #5)
        const pn = document.getElementById('patientName');
        const pi = document.getElementById('patientId');
        const pr = document.getElementById('patientRoom');
        if (pn) localStorage.setItem('patientName', pn.value.trim());
        if (pi) localStorage.setItem('patientId',   pi.value.trim());
        if (pr) localStorage.setItem('patientRoom', pr.value.trim());
        updateHeaderPatientInfo();

        localStorage.setItem('emailServiceId',  emailServiceId.value.trim());
        localStorage.setItem('emailTemplateId', emailTemplateId.value.trim());
        localStorage.setItem('emailPublicKey',  emailPublicKey.value.trim());

        if (telegramTokenInput && telegramChatIdInput) {
            CONFIG.telegramToken  = telegramTokenInput.value.trim();
            CONFIG.telegramChatId = telegramChatIdInput.value.trim();
            localStorage.setItem('telegramToken',  CONFIG.telegramToken);
            localStorage.setItem('telegramChatId', CONFIG.telegramChatId);
        }
        if (telegramProxyUrlInput) {
            CONFIG.telegramProxyUrl = telegramProxyUrlInput.value.trim();
            localStorage.setItem('telegramProxyUrl', CONFIG.telegramProxyUrl);
        }

        // BUG FIX #3: EmailJS init in ONE place — only here on settings save
        if (emailPublicKey.value.trim()) {
            emailjs.init({ publicKey: emailPublicKey.value.trim() });
        }

        alert('Settings Saved!');
        settingsModal.style.display = 'none';
    });
}

// Close modal on outside click
window.onclick = function (event) {
    if (event.target == settingsModal) {
        settingsModal.style.display = "none";
    }
}

// EmailJS init on load — use saved key, or fall back to the project's default key.
const savedKey = localStorage.getItem('emailPublicKey') || 'qhsxUESmK8n4qP5XI';
emailjs.init({ publicKey: savedKey });
// Also persist the default so Settings modal shows it pre-filled
if (!localStorage.getItem('emailPublicKey')) {
    localStorage.setItem('emailPublicKey', 'qhsxUESmK8n4qP5XI');
}

// ── STARTUP ────────────────────────────────────────────────

// FEATURE #5: Load patient info into header
updateHeaderPatientInfo();

// FEATURE #8: Restore last 200 events from localStorage
(function restoreEventLog() {
    const saved = JSON.parse(localStorage.getItem('eventLog') || '[]');
    if (!eventLog || saved.length === 0) return;
    // Clear placeholder
    eventLog.innerHTML = '';
    saved.forEach(e => {
        const div = document.createElement('div');
        div.className = 'event-item';
        div.innerHTML = `<span class="event-time">${e.time}</span><span class="event-type ${e.type}">${e.message}</span>`;
        eventLog.appendChild(div);
    });
})();

// FEATURE #6: Session uptime counter
setInterval(() => {
    const el = document.getElementById('sessionUptime');
    if (!el) return;
    const secs = Math.floor((Date.now() - sessionStartTime) / 1000);
    const h = String(Math.floor(secs / 3600)).padStart(2, '0');
    const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    el.innerText = `${h}:${m}:${s}`;
}, 1000);

// FEATURE #10: Daily data reset at midnight
setInterval(() => {
    const now = new Date();
    if (now.getHours() === 0 && now.getMinutes() === 0 && now.getSeconds() < 2) {
        // Reset eating count
        eatingEventsToday = 0;
        localStorage.setItem('eatingEventsToday', '0');
        const eatEl = document.getElementById('eatingEventsCount');
        if (eatEl) eatEl.innerText = '0';
        // Reset alert count
        alertCountToday = 0;
        localStorage.setItem('alertCountToday', '0');
        const alertEl = document.getElementById('alertCount');
        if (alertEl) alertEl.innerText = '0';
        // Reset visitor count
        visitorCount = 0;
        const visEl = document.getElementById('totalVisitors');
        if (visEl) visEl.innerText = '0';
        // Reset chart data
        localStorage.removeItem(CHART_STORAGE_KEY);
        if (activityChart) {
            const newLabels = buildChartLabels();
            activityChart.data.labels = newLabels;
            activityChart.data.datasets[0].data = newLabels.map(() => 0);
            activityChart.update();
        }
        // Reset event log
        localStorage.removeItem('eventLog');
        if (eventLog) eventLog.innerHTML = '';
        console.log('[MedGuard] Daily reset at midnight complete.');
    }
}, 1000);

// ── INIT ───────────────────────────────────────────────────
initModels();
