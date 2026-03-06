# 🏥 MedGuard AI - Intelligent Patient Monitoring System

<div align="center">

![MedGuard AI](https://img.shields.io/badge/MedGuard-AI%20Powered-blue?style=for-the-badge)
![TensorFlow.js](https://img.shields.io/badge/TensorFlow.js-2.8.6-orange?style=for-the-badge&logo=tensorflow)
![Status](https://img.shields.io/badge/Status-Active-success?style=for-the-badge)

**Real-time AI-powered patient monitoring with hand gesture detection, face tracking, and automated health alerts**

[Features](#-features) • [Quick Start](#-quick-start) • [Installation](#-installation) • [Usage](#-usage) • [Configuration](#-configuration) • [Architecture](#-architecture)

</div>

---

## 📋 Overview

MedGuard AI is an advanced patient monitoring system that leverages TensorFlow.js and computer vision to provide real-time health monitoring through camera feeds. The system detects critical events like emergency hand signals, eating activities, and visitor presence, making it ideal for hospitals, care facilities, and home healthcare.

### 🎯 Key Capabilities

- **🚨 Emergency Detection**: Automatic alert when patient raises open hand (5 fingers)
- **🍽️ Eating Monitoring**: Tracks when patient is eating with visual feedback
- **👥 Visitor Tracking**: Counts and logs visitor presence
- **📹 Dual Camera Support**: Works with both webcam and IP cameras
- **📊 Activity Analytics**: Real-time charts and event logging
- **💊 Medicine Tracker**: Schedule and track medication with email reminders
- **📧 Email Alerts**: Automated notifications via EmailJS integration

---

## ✨ Features

### AI-Powered Detection
- **Hand Pose Detection** using TensorFlow.js Handpose model
- **Face Detection** using BlazeFace model
- **Real-time Analysis** with optimized performance (200ms detection interval)
- **Visual Overlays** showing detection status and alerts

### Camera System
- **Webcam Support**: Direct browser camera access
- **IP Camera Integration**: Supports MJPEG streams and static snapshots
- **Proxy Server**: Built-in CORS proxy for IP camera connectivity
- **Auto-Discovery**: Automatically tries multiple camera endpoints
- **Snapshot Capture**: Save timestamped images
- **Fullscreen Mode**: Expand camera feed for detailed monitoring

### Monitoring Dashboard
- **Live Feed**: Real-time video with AI overlay
- **Visitor Statistics**: Track total and current visitors
- **Activity Charts**: Visualize eating patterns throughout the day
- **Event Log**: Chronological record of all detected events
- **Medicine Tracker**: Add, schedule, and email medication reminders
- **Export Functionality**: Download logs as CSV files

### Emergency System
- **Visual Alert**: Full-screen emergency overlay
- **Audio Siren**: Automatic alarm sound generation
- **Instant Logging**: Timestamped emergency events
- **Manual Override**: Option to manually trigger/stop alerts

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** (v14 or higher)
- **Modern Browser** (Chrome, Edge, Firefox with WebGL support)
- **Webcam** or **IP Camera** (optional)

### One-Click Launch (Windows)

```bash
# Double-click start.bat or run:
start.bat
```

This will:
1. Kill any existing Node.js processes
2. Start the camera proxy server (Port 8081)
3. Start the web dashboard server (Port 8080)
4. Automatically open the dashboard in your browser

---

## 📦 Installation

### 1. Clone or Download the Project

```bash
cd "ai camera project"
```

### 2. Install Dependencies

```bash
npm install
```

This installs:
- `express` - Web server framework
- `request` - HTTP client for camera proxy
- `live-server` - Development server (optional)

### 3. Verify File Structure

```
ai camera project/
├── monitor.html          # Main dashboard UI
├── monitor.js            # AI detection logic
├── monitor.css           # Dashboard styling
├── monitor_meds.js       # Medicine tracker module
├── monitor_export.js     # Export functionality
├── proxy.js              # Camera proxy server
├── server.js             # Web server
├── start.bat             # Windows startup script
├── package.json          # Dependencies
└── README.md             # This file
```

---

## 🎮 Usage

### Starting the System

#### Option 1: Automated Start (Windows)
```bash
start.bat
```

#### Option 2: Manual Start
```bash
# Terminal 1 - Start Proxy Server
node proxy.js

# Terminal 2 - Start Web Server
node server.js

# Open browser to:
http://localhost:8080/monitor.html
```

### Using the Dashboard

#### 1. **Camera Setup**
   - **Webcam**: Select "Webcam" from dropdown (default)
   - **IP Camera**: 
     - Select "IP Camera" from dropdown
     - Click the gear icon ⚙️
     - Enter camera URL (e.g., `http://192.168.1.100:8080/video`)
     - Click "Update"

#### 2. **Monitoring**
   - System automatically detects faces and hands
   - Green circle around mouth area shows eating detection zone
   - Blue boxes highlight detected faces
   - Hand landmarks appear as blue/red dots

#### 3. **Emergency Alerts**
   - Raise open hand (all 5 fingers extended) to trigger emergency
   - System shows red overlay and plays siren
   - Lower hand to stop alert

#### 4. **Medicine Tracking**
   - Enter medicine name and time
   - Click ➕ to add
   - Click ✓ to mark as taken
   - Click ✉️ to email report

#### 5. **Export Data**
   - Click "Export" button in Recent Events section
   - Downloads CSV file with all logged events

---

## ⚙️ Configuration

### Camera Settings

#### Webcam Configuration
No configuration needed - uses browser's default camera.

#### IP Camera Configuration

**Supported Formats:**
- MJPEG Stream: `http://192.168.1.100:8080/video`
- Snapshot: `http://192.168.1.100:8080/shot.jpg`
- Custom endpoints: `/mjpeg`, `/stream`, etc.

**Auto-Discovery:**
The system automatically tries these endpoints:
1. Exact URL provided
2. Base URL + `/video`
3. Base URL + `/shot.jpg`
4. Base URL + `/mjpeg`

**Popular IP Camera Apps:**
- **IP Webcam (Android)**: `http://<phone-ip>:8080/video`
- **DroidCam**: `http://<phone-ip>:4747/video`
- **iVCam**: Check app settings for URL

### Email Configuration (EmailJS)

1. Click **Settings** in sidebar
2. Enter your EmailJS credentials:
   - **Service ID**: From EmailJS dashboard
   - **Template ID**: Your email template
   - **Public Key**: Your EmailJS public key
3. Click **Save Settings**

**Get EmailJS Credentials:**
1. Sign up at [emailjs.com](https://www.emailjs.com/)
2. Create email service (Gmail, Outlook, etc.)
3. Create email template
4. Copy Service ID, Template ID, and Public Key

### System Configuration

Edit `monitor.js` to customize:

```javascript
const CONFIG = {
    cameraUrl: "",                    // Default IP camera URL
    cameraSource: 'webcam',           // 'webcam' or 'ip'
    refreshRate: 1000,                // IP camera refresh (ms)
    detectionInterval: 200,           // AI detection frequency (ms)
};
```

### Proxy Server Configuration

Edit `proxy.js` to change port:

```javascript
const PORT = 8081; // Change proxy port
```

---

## 🏗️ Architecture

### System Components

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (Client)                      │
│  ┌─────────────────────────────────────────────────┐   │
│  │          monitor.html (Dashboard UI)            │   │
│  │  ┌──────────────┐  ┌──────────────────────┐    │   │
│  │  │ Video/Canvas │  │  TensorFlow.js       │    │   │
│  │  │   Display    │  │  - Handpose Model    │    │   │
│  │  │              │  │  - BlazeFace Model   │    │   │
│  │  └──────────────┘  └──────────────────────┘    │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                           ↓ ↑
┌─────────────────────────────────────────────────────────┐
│                   Node.js Servers                        │
│  ┌──────────────────┐      ┌──────────────────────┐    │
│  │  server.js       │      │    proxy.js          │    │
│  │  (Port 8080)     │      │    (Port 8081)       │    │
│  │  - Serves HTML   │      │  - CORS Proxy        │    │
│  │  - Static Files  │      │  - Camera Bridge     │    │
│  └──────────────────┘      └──────────────────────┘    │
└─────────────────────────────────────────────────────────┘
                           ↓ ↑
┌─────────────────────────────────────────────────────────┐
│              Camera Sources                              │
│  ┌──────────────────┐      ┌──────────────────────┐    │
│  │   Webcam         │      │   IP Camera          │    │
│  │   (Local)        │      │   (Network)          │    │
│  └──────────────────┘      └──────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### AI Detection Pipeline

```
Camera Feed → Canvas → TensorFlow.js → Detection Models
                                           ↓
                        ┌──────────────────┴──────────────────┐
                        ↓                                      ↓
                  Face Detection                        Hand Detection
                  (BlazeFace)                          (Handpose)
                        ↓                                      ↓
              ┌─────────┴─────────┐              ┌────────────┴────────┐
              ↓                   ↓              ↓                     ↓
        Visitor Count      Patient Present   Emergency         Eating Detection
                                              (5 Fingers)       (Hand-to-Mouth)
                        ↓
              Event Logging & Alerts
```

### File Responsibilities

| File | Purpose |
|------|---------|
| `monitor.html` | Main dashboard UI structure |
| `monitor.css` | Styling and animations |
| `monitor.js` | Core AI detection and camera logic |
| `monitor_meds.js` | Medicine tracking functionality |
| `monitor_export.js` | Data export utilities |
| `proxy.js` | IP camera CORS proxy server |
| `server.js` | Static file web server |
| `start.bat` | Windows startup automation |

---

## 🔧 Troubleshooting

### Camera Issues

**Problem: Webcam not detected**
- **Solution**: Grant camera permissions in browser
- Check browser console for error messages
- Try different browser (Chrome recommended)

**Problem: IP Camera not connecting**
- **Solution**: 
  - Verify camera URL is correct
  - Ensure camera and computer are on same network
  - Check proxy server is running (Port 8081)
  - Try accessing camera URL directly in browser first

**Problem: Black screen or frozen feed**
- **Solution**:
  - Refresh the page
  - Restart servers using `start.bat`
  - Clear browser cache and localStorage

### AI Detection Issues

**Problem: Hand/Face not detected**
- **Solution**:
  - Ensure good lighting
  - Position hand/face clearly in frame
  - Wait for models to load (check console)
  - Verify TensorFlow.js loaded (check browser console)

**Problem: AI models timeout**
- **Solution**:
  - Check internet connection (models load from CDN)
  - Wait up to 15 seconds for initial load
  - Refresh page if timeout occurs

### Server Issues

**Problem: Port already in use**
- **Solution**:
  - Run `start.bat` (automatically kills old processes)
  - Or manually: `taskkill /F /IM node.exe`
  - Change port in `server.js` or `proxy.js`

**Problem: Cannot access dashboard**
- **Solution**:
  - Verify servers are running
  - Check `http://localhost:8080/monitor.html`
  - Try `http://127.0.0.1:8080/monitor.html`

---

## 🎨 Customization

### Changing Detection Thresholds

Edit `monitor.js`:

```javascript
// Emergency detection sensitivity
function isHandOpen(landmarks) {
    // Change from 5 to 4 for easier triggering
    return extendedCount >= 4; // Was: === 5
}

// Eating detection distance
if (distToMouth < 80) { // Was: < 60
    // Trigger eating event
}
```

### Styling the Dashboard

Edit `monitor.css`:

```css
:root {
    --accent-blue: #38bdf8;    /* Primary color */
    --accent-green: #4ade80;   /* Success color */
    --accent-red: #ef4444;     /* Alert color */
    --bg-dark: #0f172a;        /* Background */
}
```

### Adding Custom Events

In `monitor.js`:

```javascript
function logEvent(message, type = "normal") {
    // Add custom event types: "normal", "eating", "warning"
    // Customize event styling in monitor.css
}
```

---

## 📊 Technical Specifications

### AI Models
- **Handpose**: TensorFlow.js v0.0.6 (21 hand landmarks)
- **BlazeFace**: TensorFlow.js v0.0.5 (Face detection)
- **Backend**: WebGL acceleration
- **Performance**: ~200ms detection interval

### Browser Requirements
- **WebGL Support**: Required for TensorFlow.js
- **Camera API**: MediaDevices.getUserMedia
- **ES6+**: Modern JavaScript features
- **Recommended**: Chrome 90+, Edge 90+, Firefox 88+

### Network Requirements
- **Proxy Server**: Port 8081 (configurable)
- **Web Server**: Port 8080 (configurable)
- **IP Camera**: Same local network or accessible URL
- **Internet**: Required for CDN resources (TensorFlow.js, Chart.js, EmailJS)

### Performance
- **CPU Usage**: ~15-30% (with AI detection)
- **Memory**: ~200-400 MB
- **Network**: Minimal (except IP camera streaming)

---

## 🔐 Privacy & Security

### Data Storage
- **Local Storage Only**: All settings stored in browser localStorage
- **No Cloud Upload**: Video/images never leave your device
- **Session-Based**: No persistent user accounts

### Camera Access
- **Permission Required**: Browser prompts for camera access
- **Local Processing**: All AI runs in browser (client-side)
- **No Recording**: System doesn't record video by default

### Network Security
- **Local Network**: Proxy server binds to localhost
- **CORS Enabled**: Required for IP camera access
- **No Authentication**: Add authentication if exposing to internet

---

## 🤝 Contributing

Contributions are welcome! Areas for improvement:

- [ ] Add more AI models (pose detection, object detection)
- [ ] Implement video recording functionality
- [ ] Add multi-camera support
- [ ] Create mobile app version
- [ ] Add authentication system
- [ ] Implement cloud storage integration
- [ ] Add more chart types and analytics

---

## 📝 License

This project is licensed under the **MIT License**.

```
MIT License

Copyright (c) 2024 MedGuard AI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 📞 Support

For issues, questions, or suggestions:

1. Check the [Troubleshooting](#-troubleshooting) section
2. Review browser console for error messages
3. Verify all dependencies are installed
4. Ensure servers are running on correct ports

---

## 🙏 Acknowledgments

### Technologies Used
- [TensorFlow.js](https://www.tensorflow.org/js) - Machine learning framework
- [Handpose Model](https://github.com/tensorflow/tfjs-models/tree/master/handpose) - Hand detection
- [BlazeFace Model](https://github.com/tensorflow/tfjs-models/tree/master/blazeface) - Face detection
- [Chart.js](https://www.chartjs.org/) - Data visualization
- [EmailJS](https://www.emailjs.com/) - Email service
- [Express.js](https://expressjs.com/) - Web server
- [Font Awesome](https://fontawesome.com/) - Icons

### Inspiration
Built to improve patient care and safety in healthcare facilities through accessible AI technology.

---

<div align="center">

**Made with ❤️ for better healthcare**

⭐ Star this project if you find it useful!

</div>