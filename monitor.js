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
let twoHandsStartTime = null;
let manualEmergency = false;

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
            updateStatus(`Webcam Failed: ${err.message}. Switching to IP Camera.`, true);

            // Wait 3 seconds before switching so user sees error
            setTimeout(() => {
                CONFIG.cameraSource = 'ip';
                if (camSourceSelect) camSourceSelect.value = 'ip';
                initCamera();
            }, 3000);
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
    logEvent("EMERGENCY: HELP REQUIRED", "eating"); // Using 'eating' style (red) for emergency
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

    if (alertSound) alertSound.play().catch(e => { });
    logEvent("Eating Detected", "normal");
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

function logEvent(message, type = "normal") {
    if (!eventLog) return;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const div = document.createElement("div");
    div.className = "event-item";
    div.innerHTML = `
        <span class="event-time">${time}</span>
        <span class="event-type ${type}">${message}</span>
    `;
    eventLog.prepend(div);

    // Send to Telegram
    sendTelegramMessage(message);
}

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

                    // Draw face box
                    faces.forEach(face => {
                        const start = face.topLeft;
                        const end = face.bottomRight;
                        const size = [end[0] - start[0], end[1] - start[1]];
                        ctx.strokeStyle = '#38bdf8'; // Match accent blue
                        ctx.lineWidth = 2;
                        ctx.strokeRect(start[0], start[1], size[0], size[1]);
                    });
                } else {
                    window.currentFaceBox = null; // No face
                    const timeSinceLastFace = Date.now() - lastFaceDetectedTime;
                    if (timeSinceLastFace > 5000) {
                        faceStatusText.innerText = "Patient Not Detected!";
                        faceStatusDiv.className = 'face-status-danger';
                    } else {
                        faceStatusText.innerText = "Detecting...";
                        faceStatusDiv.className = 'face-status-warning';
                    }
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
                } else {
                    if (isEmergency && !manualEmergency) stopEmergency();
                    if (isEating) isEating = false;
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
    // 1. FIVE FINGERS ALERT (Open Hand)
    if (isHandOpen(landmarks)) {
        // Draw Visual Alert on Screen
        ctx.fillStyle = "rgba(239, 68, 68, 0.8)"; // Red
        ctx.fillRect(0, 0, canvas.width, 40);
        ctx.fillStyle = "white";
        ctx.font = "bold 24px Arial";
        ctx.fillText("⚠️ 5 FINGERS DETECTED - EMERGENCY", 20, 28);

        if (!isEmergency) triggerEmergency();
        return; // Prioritize emergency
    } else {
        if (isEmergency && !manualEmergency) stopEmergency();
    }

    // 2. EATING DETECTION logic
    // We need the index finger tip (Landmark 8) and Thumb tip (Landmark 4) or just Index
    const indexTip = landmarks[8];

    // Determine Mouth Position
    let mouthX, mouthY;

    if (window.currentFaceBox) {
        // Dynamic: Based on detected face
        // Mouth is roughly at center X, 75% down Y of face box
        mouthX = window.currentFaceBox.x + (window.currentFaceBox.width * 0.5);
        mouthY = window.currentFaceBox.y + (window.currentFaceBox.height * 0.75);

        // Visualize Mouth Area (Debug/Feedback)
        ctx.strokeStyle = "#4ade80"; // Green
        ctx.beginPath();
        ctx.arc(mouthX, mouthY, 40, 0, 2 * Math.PI);
        ctx.stroke();
    } else {
        // Fallback: Static position (center screen, slightly up)
        mouthX = canvas.width / 2;
        mouthY = canvas.height * 0.45;
    }

    // Check distance between Index Finger and Mouth
    const distToMouth = Math.sqrt(Math.pow(indexTip[0] - mouthX, 2) + Math.pow(indexTip[1] - mouthY, 2));

    // Threshold: 60px radius
    if (distToMouth < 60) {
        // VISUAL MARKER FOR EATING
        ctx.fillStyle = "#4ade80"; // Green
        ctx.font = "bold 30px Arial";
        ctx.fillText("🥣 EATING", indexTip[0] + 20, indexTip[1]); // Label follows hand

        // Draw line connecting hand to mouth
        ctx.beginPath();
        ctx.moveTo(indexTip[0], indexTip[1]);
        ctx.lineTo(mouthX, mouthY);
        ctx.lineWidth = 4;
        ctx.strokeStyle = "#4ade80";
        ctx.stroke();

        if (!isEating) triggerEatingEvent();
    } else {
        isEating = false;
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

// Charts
const ctxActivity = document.getElementById('activityChart');
let activityChart = null;

if (ctxActivity) {
    activityChart = new Chart(ctxActivity.getContext('2d'), {
        type: 'bar',
        data: {
            labels: ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00'],
            datasets: [{
                label: 'Eating Events',
                data: [0, 1, 3, 0, 0, 0],
                backgroundColor: '#38bdf8',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false },
                title: { display: true, text: 'Eating Frequency (Today)', color: '#94a3b8' }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: '#334155' },
                    ticks: { color: '#94a3b8', stepSize: 1 }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#94a3b8' }
                }
            }
        }
    });
}

function updateActivityChart() {
    if (!activityChart) return;
    const currentHourIndex = 2; // Fixed for demo, ideally dynamic based on time
    const currentVal = activityChart.data.datasets[0].data[currentHourIndex];
    activityChart.data.datasets[0].data[currentHourIndex] = currentVal + 1;
    activityChart.update();
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

// Load Settings
function loadSettings() {
    emailServiceId.value = localStorage.getItem('emailServiceId') || '';
    emailTemplateId.value = localStorage.getItem('emailTemplateId') || '';
    emailPublicKey.value = localStorage.getItem('emailPublicKey') || '';
    if (telegramTokenInput) telegramTokenInput.value = CONFIG.telegramToken || '';
    if (telegramChatIdInput) telegramChatIdInput.value = CONFIG.telegramChatId || '';
    if (telegramProxyUrlInput) telegramProxyUrlInput.value = CONFIG.telegramProxyUrl || '';
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
        localStorage.setItem('emailServiceId', emailServiceId.value.trim());
        localStorage.setItem('emailTemplateId', emailTemplateId.value.trim());
        localStorage.setItem('emailPublicKey', emailPublicKey.value.trim());

        if (telegramTokenInput && telegramChatIdInput) {
            CONFIG.telegramToken = telegramTokenInput.value.trim();
            CONFIG.telegramChatId = telegramChatIdInput.value.trim();
            localStorage.setItem('telegramToken', CONFIG.telegramToken);
            localStorage.setItem('telegramChatId', CONFIG.telegramChatId);
        }

        if (telegramProxyUrlInput) {
            CONFIG.telegramProxyUrl = telegramProxyUrlInput.value.trim();
            localStorage.setItem('telegramProxyUrl', CONFIG.telegramProxyUrl);
        }

        // Re-init EmailJS if key changed
        if (emailPublicKey.value.trim()) {
            emailjs.init(emailPublicKey.value.trim());
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

// Initialize EmailJS on load if key exists
const savedKey = localStorage.getItem('emailPublicKey');
if (savedKey) {
    emailjs.init(savedKey);
}

// Start Initialization
initModels();
