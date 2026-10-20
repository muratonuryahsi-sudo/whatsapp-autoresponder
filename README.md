<div align="center">
  <img src="assets/logo.svg" width="96" height="96" alt="MyThanUs Logo" />
  <h1>MyThanUs — Personal Intelligence</h1>
  <p><b>Executive WhatsApp AI Assistant & Web Dashboard</b></p>
  <p>Powered by Google Gemini & whatsapp-web.js</p>
</div>

---

## 🌟 Table of Contents
- [Key Capabilities](#-key-capabilities)
- [Prerequisites](#-prerequisites)
- [Quick Start Guide](#-quick-start-guide)
- [Interactive Setup Wizard (Multi-Language)](#-interactive-setup-wizard-multi-language)
- [Configuration Reference (`.env`)](#-configuration-reference-env)
- [iPhone Do Not Disturb (DND) Automation](#-iphone-do-not-disturb-dnd-automation)
- [Project Architecture](#-project-architecture)
- [24/7 Production Deployment (PM2 / VPS)](#-247-production-deployment-pm2--vps)
- [Troubleshooting & FAQ](#-troubleshooting--faq)
- [Privacy & Security](#-privacy--security)
- [License](#-license)

---

## 🚀 Key Capabilities

### 1. 🧠 Multilingual Intelligence & Persona
- **Adapts to Senders:** Naturally responds in the language of the incoming message (English, Turkish, German, Spanish, etc.), defaulting to your chosen primary language.
- **Executive Persona:** Represents you professionally and politely. Never writes unwanted code, long essays, or makes binding promises on your behalf.
- **Smart Conversation Debounce:**
  - **10-second burst buffer:** Bundles multiple consecutive rapid-fire messages into a single well-thought response.
  - **1.5-second fast follow-up:** Accelerates response times during active conversations.

### 2. 🎙️ Voice Note Transcription & Voice Replies (PTT / Audio)
- Listens to incoming WhatsApp voice notes.
- Automatically generates an instant summary in your briefing.
- Formulates a polite, natural reply to the sender in the spoken language.

### 3. 🖼️ Computer Vision (Image Analysis)
- Analyzes incoming photos, screenshots, and visual attachments.
- Generates contextual replies based on image content and captions.

### 4. 🔕 iPhone Do Not Disturb (DND) & Focus Sync
- **Zero Interruption:** When DND mode is disabled, the bot remains 100% silent because you are actively using your phone.
- **Executive Briefing:** When DND turns off, the bot compiles an executive summary of who messaged you, urgency levels, and action items, and sends it directly to your WhatsApp "Notes to Self".

### 5. 🛡️ 3-Strike Disrespect & Abuse Protection
- Differentiates casual slang from direct personal attacks against you or your assistant.
  - **Strike 1 (Rebuttal):** Firm, dignified verbal reprimand putting the offender in their place.
  - **Strike 2 (Warning):** Strict final warning.
  - **Strike 3 (15-Min Blacklist):** Temporarily bans the user; messages are not forwarded.
- **Rescue Password:** Blacklisted users can immediately unban themselves by sending your secret rescue password (e.g. `unbanme`).

### 6. 🚨 Silent Emergency Alert System
- Scans messages for critical emergency keywords (e.g. accident, hospital, police, urgent).
- Raises a **completely silent** frontmost visual alert dialog on macOS and triggers a silent phone vibration push via `ntfy.sh`.

### 7. 🎭 Universal Troll Meme Feature
- If anyone asks for a photo or nude (`send nudes`, `boydan at`, `fotoğrafını atsana`, `schick nudes`), the assistant playfully plays along and sends a hilarious meme photo (`assets/troll_meme.png`).

---

## 📋 Prerequisites

1. **Node.js:** Version `18.0.0` or higher (tested on Node v20, v22, and v26).
   ```bash
   node -v
   ```
2. **Google Gemini API Key:**
   - 100% free with no credit card required.
   - Obtain your key from [Google AI Studio](https://aistudio.google.com/).
3. **WhatsApp Account:** Installed and active on your smartphone.
4. **Google Chrome:** Installed on your computer (or Chromium on Linux).

---

## ⚡ Quick Start Guide

### Step 1: Clone and Install
```bash
git clone <your-repository-url>
cd whatsapp-autoresponder
npm install
```
*(Dependencies and automated bug patches for `whatsapp-web.js` will install automatically via `postinstall`)*.

### Step 2: Run the Setup Wizard
```bash
npm run setup
```
The wizard will prompt you in English to pick your preferred setup language (`English`, `Türkçe`, or `Deutsch`), then guide you through configuring:
- Your Name (the person the assistant represents)
- Your Assistant's Name
- Your Gemini API Key
- Operating Mode (DND only vs Always reply)
- Secret Rescue Password

### Step 3: Launch the Assistant
```bash
npm start
```
Or for development with automatic reload on file changes:
```bash
npm run dev
```

### Step 4: Link Your WhatsApp
1. A **QR Code** will render in your terminal.
2. Open WhatsApp on your phone.
3. Tap **Settings > Linked Devices > Link a Device**.
4. Scan the terminal QR code.
5. Once verified, your assistant is live!

---

## 🌐 Interactive Setup Wizard (Multi-Language)

Whenever the project is run for the first time or via `npm run setup`, you are greeted with:

```text
======================================================
🤖 WhatsApp AI Auto-Responder — Setup Wizard
======================================================
Please select your preferred language / Kurulum dilinizi seçin:
   [1] English (Default)
   [2] Türkçe
   [3] Deutsch
Choice [1/2/3]:
```

- Choosing **1** conducts the setup in **English**.
- Choosing **2** switches all prompts to **Türkçe**.
- Choosing **3** switches all prompts to **Deutsch**.

Your choices are saved into `.env` (which is git-ignored and never committed), ensuring personal credentials remain secure on your machine while the code remains deployable anywhere.

---

## ⚙️ Configuration Reference (`.env`)

You can edit `.env` directly at any time:

```env
# ========================================================
# Owner Identity & Assistant Persona
# ========================================================
OWNER_NAME="Alex"
BOT_NAME="Jarvis"
DEFAULT_LANGUAGE="English"

# ========================================================
# Google Gemini API
# ========================================================
GEMINI_API_KEY="AIzaSyYourGeminiApiKeyHere"
GEMINI_MODEL="gemini-3.5-flash-lite"

# ========================================================
# Operational Settings
# ========================================================
# true = Only reply when iPhone DND is active; false = Always reply 24/7
ONLY_REPLY_IN_DND=true

# Local webhook port for Apple Shortcuts
DND_PORT=3000

# Secret password for blacklisted users to unban themselves
RESCUE_PASSWORD="unbanme"

# Anti-spam burst debounce per user in seconds
USER_COOLDOWN_SECONDS=30

# Whether to reply in group chats (Recommended: false)
REPLY_TO_GROUPS=false

# Optional custom Chrome path (Mac default included)
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Path to custom troll meme photo
TROLL_IMAGE_PATH="assets/troll_meme.png"
```

---

## 📱 iPhone Do Not Disturb (DND) Automation

If you run the bot on your computer and want it to only reply while your iPhone is in **Do Not Disturb** or **Focus Mode**:

### Method 1: Global Cloud Control via ntfy.sh (Recommended - Works Anywhere)
No port forwarding or same Wi-Fi needed. Works on cellular data anywhere in the world!

1. Open the **Shortcuts** app on your iPhone.
2. Go to the **Automation** tab and tap **+** (New Automation).
3. Select **"Do Not Disturb"** (or any Focus mode):
   - Choose **"When Turning On"** > Select **"Run Immediately"** (no ask to run).
   - Add action: **Get Contents of URL**:
     - URL: `https://ntfy.sh/<bot_name>-dnd-<owner_name>` (e.g. `https://ntfy.sh/jarvis-dnd-alex`)
     - Method: `POST`
     - Request Body: `Text` -> `on`
4. Create a second automation for **"When Turning Off"**:
   - URL: `https://ntfy.sh/<bot_name>-dnd-<owner_name>`
   - Method: `POST`
   - Request Body: `Text` -> `off`

### Method 2: Local Wi-Fi Webhook
If your phone and computer are on the same home Wi-Fi:
- **Turn DND ON:** `GET http://<YOUR_LOCAL_IP>:3000/dnd/on`
- **Turn DND OFF:** `GET http://<YOUR_LOCAL_IP>:3000/dnd/off`

### Method 3: WhatsApp In-Chat Commands
You can also toggle DND manually anytime by sending a message to yourself in WhatsApp:
- `.dnd on` — Activates DND mode
- `.dnd off` — Deactivates DND mode and delivers your Executive Briefing
- `.dnd status` — Reports active state and count of logged messages

---

## 📁 Project Architecture

```
whatsapp-autoresponder/
├── index.js            # Main process: whatsapp-web.js client, DND server, message listeners
├── gemini.js           # Gemini AI service: vision, audio, chat history, briefing generator
├── blacklist.js        # 3-Strike insult detector, ban tracker, rescue password logic
├── calendar.js         # Apple Calendar macOS integration
├── setup.js            # Interactive multilingual CLI onboarding wizard
├── patch-wwebjs.js     # Automatic bugfix patches for whatsapp-web.js
├── assets/
│   └── troll_meme.png  # Troll meme image for photo requests
├── .env.example        # Clean template for new deployments
├── .gitignore          # Keeps .env, logs, and session auth files private
├── package.json        # Dependencies and scripts
└── README.md           # Documentation
```

---

## 🚀 24/7 Production Deployment (PM2 / VPS)

To run the assistant continuously on a server or background daemon:

### 1. Using PM2 (Process Manager)
```bash
npm install -g pm2
pm2 start index.js --name "whatsapp-assistant"
pm2 save
pm2 startup
```
To check live logs:
```bash
pm2 logs whatsapp-assistant
```

### 2. Running on Linux VPS (Ubuntu / Debian)
If running on a headless server without a desktop:
```bash
sudo apt update
sudo apt install -y chromium-browser fonts-liberation libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc1 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6
```
Then set in `.env`:
```env
CHROME_PATH="/usr/bin/chromium-browser"
```

---

## ❓ Troubleshooting & FAQ

#### 1. Port 3000 in use (`EADDRINUSE`)
If an older instance is holding port 3000:
```bash
kill -9 $(lsof -t -i:3000)
```

#### 2. WhatsApp Session Logged Out
If you unlinked the device from your phone, simply run `npm start` and scan the new QR code. Saved session credentials are automatically renewed in `./.wwebjs_auth/`.

#### 3. Do I need a paid Gemini API tier?
No. The free tier provided by [Google AI Studio](https://aistudio.google.com/) provides 15 Requests Per Minute (RPM), which is more than enough for personal WhatsApp messaging.

#### 4. Are my messages or credentials shared?
No. All processing is direct between your computer, the official WhatsApp Web protocol, and your private Google Gemini API key. Nothing passes through third-party servers.

---

## 🔒 Privacy & Security

- `.env` and `app.log` are strictly included in `.gitignore` to prevent leaking private credentials or message histories.
- All critical emergency pop-up notifications on macOS are completely silent (zero sound) to respect your quiet time and sleep.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
