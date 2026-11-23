# MedGuard Cellular Voice Gateway (OpenLine + Nothing Phone)

## Architecture Overview

```
                                  +-------------------------------------+
                                  |     Caller / Patient Phone          |
                                  |          (9442922888)               |
                                  +-----------------+-------------------+
                                                    ^
                                                    | Cellular Call (JIO 4G)
                                                    v
                                  +-----------------+-------------------+
                                  |     Nothing Phone (2a / 3a)         |
                                  |   Model: A059 | Android 17          |
                                  |   - OpenLine Dialer (Default)       |
                                  |   - httpgateway_shell (Port 47811)  |
                                  |   - AudioTrack: TYPE_TELEPHONY (18) |
                                  |   - AudioRecord: VOICE_DOWNLINK     |
                                  +-----------------+-------------------+
                                                    ^
                                                    | WebSocket (10.58.246.167:8989)
                                                    v
+---------------------------------+       +---------+-------------------+
| MedGuard AI Receptionist        |       | OpenLine Gateway Server     |
| Port: 3000                      | <---> | Port: 8989                  |
| Endpoint: /api/call-patient     | REST  | Gemini Model: gemini-3.8-live|
+---------------------------------+       +-----------------------------+
```

---

## Key Configurations & Ports

| Component | Host / IP / Port | Details |
| :--- | :--- | :--- |
| **OpenLine Web Console** | `http://localhost:8989` | Dashboard, device health, live transcripts |
| **MedGuard Web App** | `http://localhost:3000` | Receptionist UI, calendar, appointment booking |
| **PC Hotspot IP** | `10.58.246.167:8989` | Endpoint configured on the Android app |
| **Phone Wi-Fi ADB** | `10.58.246.212:5555` | Wireless ADB connection to the phone |
| **Phone Audio Daemon** | `127.0.0.1:47811` | Rootless audio helper daemon (`httpgateway_shell`) |
| **Gemini Live Model** | `gemini-3.8-live` | Real-time bidirectional voice model via Google Gemini |

---

## Key Files & Changes

1. **`openline/server/src/audio-bridge.ts`**:
   - Automated event-driven bridge that connects to `127.0.0.1:47811` on the phone via ADB.
   - Pre-connects the audio engine when dialing/ringing/active, ensuring zero-latency speech start when answered.

2. **`openline/server/src/server.ts`**:
   - Hooked `events.onCallEvent` to automatically invoke `triggerAudioBridgeStart(call.id, call.deviceId)` and `triggerAudioBridgeStop(call.id)`.

3. **`ai-receptionist/server.js`**:
   - Modified `POST /api/call-patient` to use OpenLine SIM calling first with fallback to Twilio.

4. **`start-cellular-ai.bat`**:
   - One-click launcher to connect ADB, start OpenLine, and start MedGuard AI Receptionist.

---

## How to Start Everything in the Future

Double-click `start-cellular-ai.bat` in `E:\Frontend\Portfolio\Portfolio\ai camera project - AgentCall`.

Alternatively, in terminals:
```powershell
# Terminal 1: OpenLine Gateway
cd "E:\Frontend\Portfolio\Portfolio\ai camera project - AgentCall\openline\server"
node --env-file=.env dist/index.js

# Terminal 2: MedGuard AI Receptionist
cd "E:\Frontend\Portfolio\Portfolio\ai camera project - AgentCall\ai-receptionist"
node server.js
```
