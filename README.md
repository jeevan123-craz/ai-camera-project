# AI Camera Project (MedGuard AI Base)

<div align="center">

![TensorFlow.js](https://img.shields.io/badge/TensorFlow.js-Powered-orange?style=for-the-badge&logo=tensorflow)
![Status](https://img.shields.io/badge/Status-Active-success?style=for-the-badge)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-yellow?style=for-the-badge&logo=javascript)

**A comprehensive AI camera monitoring suite featuring MedGuard AI, custom schedulers, and remote management modules.**

</div>

---

## 📌 Overview

The **AI Camera Project** is the foundational repository for several computer-vision and AI-driven automation projects. At its core, it hosts the **MedGuard AI Patient Monitoring System**, which uses TensorFlow.js to track patient health events (eating, emergencies, visitor presence) in real-time. 

Additionally, this repository contains auxiliary modules such as:
- **AI Receptionist**: An automated frontend interface for greeting and processing users.
- **Gemini RMM**: A Remote Monitoring and Management prototype.
- **Well Motor Scheduler**: A utility for scheduling and automating well motor operations.
- **Power Of Two Max Heap**: A JavaScript implementation of a specialized max-heap data structure.

## ✨ Core Features (MedGuard AI)

- **🚑 Hand Gesture Detection**: Identifies emergency open-hand gestures (5 fingers) using `coco-ssd` and `handpose`.
- **🍽️ Activity Tracking**: Uses bounding boxes and facial landmarks to determine if a patient is eating.
- **👥 Visitor Counting**: Tracks the number of unique visitors present in the camera frame over time.
- **📡 Dual Camera Support**: Connects to both local webcams and network IP cameras via a custom built Node.js proxy (`proxy.js`).

## 🛠️ Tech Stack
- **Frontend**: HTML5, CSS3, JavaScript (ES6+), TensorFlow.js (BlazeFace, Handpose)
- **Backend / Proxy**: Node.js, Express.js
- **Visualization**: Chart.js for real-time activity analytics
- **Notifications**: EmailJS for critical health alerts

## 🚀 Setup & Installation

### 1. Clone the Repository
```bash
git clone https://github.com/your-username/ai-camera-project.git
cd "ai camera project"
```

### 2. Install Dependencies
The project uses Node.js for its proxy server and static file hosting.
```bash
npm install
```

### 3. Launch the Application
For Windows users, simply run the batch script to spin up the local server and the proxy simultaneously:
```bash
start.bat
```

Alternatively, you can run the components manually:
```bash
# Start the static web server
node server.js

# Start the CORS proxy (for IP Cameras)
node proxy.js
```
*Access the dashboard at `http://localhost:8080`.*

---

## 🧩 Directory Structure Breakdown

- `/ai-receptionist/` - Experimental AI conversational agent interface.
- `/gemini-rmm/` - Remote monitoring module using Google's Gemini models.
- `/well-motor-scheduler/` - Automated scheduling tool.
- `monitor.html` / `monitor.js` - The core frontend interface for the MedGuard AI system.
- `proxy.js` - Express backend used to bypass CORS restrictions for remote MJPEG IP camera streams.
- `UML_Diagram.html` - System architecture diagram and documentation.

## 📝 License
This project is open-source and available under the MIT License.