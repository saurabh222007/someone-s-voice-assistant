# Someone's Premium Voice Assistant

A state-of-the-art, high-fidelity personal companion built with **Vite**, **React**, and **Tailwind CSS**, powered by a **Python (Flask)** backend with **Gemini AI**.

![Premium UI Mockup](https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?q=80&w=1000&auto=format&fit=crop)

## ✨ Features

- **Premium Glassmorphic UI**: Deep blur effects, mesh gradients, and kinetic typography inspired by high-end design trends.
- **Embedded YouTube Music Player**: Search and play any song with a sleek, animated SVG vinyl record player visualization.
- **Per-User API Key Setup**: Secure, browser-local Gemini API key management—perfect for public deployments.
- **Reliable Wake Word Detection**: Hands-free interaction using browser-based speech recognition.
- **Smart Widgets**: Immersive clock with weather integration (default: Ahmedabad).
- **Comprehensive Assistant Logic**: Handles news (Global/India), weather, jokes, time, and general AI queries.

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js**: (Version 16 or later)
- **Python**: (Version 3.8 or later)
- **Gemini API Key**: Obtain one from [Google AI Studio](https://aistudio.google.com/).

### 2. Backend Setup
```bash
cd server
pip install -r requirements.txt
python server.py
```

### 3. Frontend Setup
```bash
npm install
npm run dev
```

### 4. Initialization
When you first launch the app, you will be prompted for your **Gemini API Key**. This is stored securely in your browser's local storage and is never uploaded to the server permanently.

## 🛠 Tech Stack
- **Frontend**: React, TypeScript, Tailwind CSS, Lucide Icons, Framer Motion (via custom CSS animations).
- **Backend**: Python, Flask, `edge-tts`, `yt-dlp`, `requests`.

## 🛡 Security
- **Strict Privacy**: No API keys or personal data are stored on the server. All AI processing is performed per-request using the user-provided key.
- **Environment Safety**: Sensitive configurations are managed via `.env` (not included in the repository).

---

© 2026 Someone's Assistant. All rights reserved.
