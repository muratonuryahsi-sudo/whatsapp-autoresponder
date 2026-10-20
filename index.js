/**
 * index.js
 * Main entry point for WhatsApp AI Auto-Responder.
 * Connects whatsapp-web.js with Google Gemini, handling text, voice notes,
 * image messages, Apple Shortcuts DND synchronization, and blacklist protection.
 */

require('dotenv').config();
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { exec } = require('child_process');
const { checkOrRunSetup } = require('./setup');

// Persistent file logger
const logFile = path.join(__dirname, 'app.log');
function logToFile(type, args) {
  try {
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const text = args.map(a => (typeof a === 'object' ? (a && a.stack ? a.stack : JSON.stringify(a)) : String(a))).join(' ');
    fs.appendFileSync(logFile, `[${ts}] [${type}] ${text}\n`, 'utf8');
  } catch (_) {}
}
const origLog = console.log;
const origError = console.error;
const origWarn = console.warn;
console.log = (...args) => { origLog(...args); logToFile('INFO', args); };
console.error = (...args) => { origError(...args); logToFile('ERROR', args); };
console.warn = (...args) => { origWarn(...args); logToFile('WARN', args); };

const GeminiService = require('./gemini');
const blacklist = require('./blacklist');
const calendar = require('./calendar');

const DashboardServer = require('./dashboard-server');

// Dynamic configuration from environment
const getOwnerName = () => process.env.OWNER_NAME || 'Owner';
const getBotName = () => process.env.BOT_NAME || 'Assistant';
const DEFAULT_LANGUAGE = process.env.DEFAULT_LANGUAGE || 'English';
const replyToGroups = process.env.REPLY_TO_GROUPS === 'true';
const onlyReplyInDnd = process.env.ONLY_REPLY_IN_DND !== 'false';
const customChromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DND_PORT = parseInt(process.env.DND_PORT || '3000', 10);
const DND_SECRET = process.env.DND_SECRET || '';
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || '';
const TROLL_IMAGE_PATH = process.env.TROLL_IMAGE_PATH || path.join(__dirname, 'assets/troll_meme.png');

// Timing constants
const FIRST_BURST_WAIT_MS = 10000; // 10s wait for initial message bursts
const FOLLOWUP_WAIT_MS = 1500;     // 1.5s fast wait for active follow-up conversation
const ACTIVE_CONVERSATION_WINDOW_MS = 5 * 60 * 1000; // 5 minute active window

const gemini = new GeminiService();

// State management
const userBuffers = new Map();
const lastReplySentTimes = new Map();
const botStartTime = Math.floor(Date.now() / 1000);

// Live metrics & logs for Dashboard
let currentQrCode = null;
let clientStatus = 'INITIALIZING'; // INITIALIZING, WAITING_FOR_QR, CONNECTED, DISCONNECTED
const liveActivityFeed = [];
const executiveBriefingArchive = [];

// Do Not Disturb (DND) mode state
let isDndActive = false;
let dndSessionMessages = [];
let dndStartTime = null;

// Initialize Dashboard & DND Server
const dashboardServer = new DashboardServer({
  dndPort: DND_PORT,
  dashboardApiKey: DASHBOARD_API_KEY,
  onDndToggle: async (active, source) => {
    await setDndState(active, source);
  },
  onUnbanUser: (userId) => {
    return blacklist.unbanUser(userId);
  },
  onSaveSettings: async (newSettings) => {
    const envFilePath = path.join(__dirname, '.env');
    let envRaw = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '';
    
    // Normalize both camelCase and UPPER_SNAKE_CASE from frontend or API
    const owner = newSettings.ownerName || newSettings.OWNER_NAME;
    const bot = newSettings.botName || newSettings.BOT_NAME;
    const lang = newSettings.defaultLanguage || newSettings.DEFAULT_LANGUAGE;
    const model = newSettings.geminiModel || newSettings.GEMINI_MODEL;
    const pass = (newSettings.rescuePassword !== undefined) ? newSettings.rescuePassword : newSettings.RESCUE_PASSWORD;
    const dndOnly = (typeof newSettings.onlyReplyInDnd === 'boolean') 
      ? newSettings.onlyReplyInDnd 
      : ((typeof newSettings.ONLY_REPLY_IN_DND === 'boolean') ? newSettings.ONLY_REPLY_IN_DND : undefined);

    const changes = [];

    if (owner && owner !== process.env.OWNER_NAME) {
      changes.push(`Sahip İsmi (Owner): "${process.env.OWNER_NAME || 'Owner'}" ➔ "${owner}"`);
      envRaw = envRaw.replace(/OWNER_NAME=.*/g, `OWNER_NAME="${owner}"`);
      process.env.OWNER_NAME = owner;
    }
    if (bot && bot !== process.env.BOT_NAME) {
      changes.push(`Asistan İsmi (Bot): "${process.env.BOT_NAME || 'Assistant'}" ➔ "${bot}"`);
      envRaw = envRaw.replace(/BOT_NAME=.*/g, `BOT_NAME="${bot}"`);
      process.env.BOT_NAME = bot;
    }
    if (lang && lang !== process.env.DEFAULT_LANGUAGE) {
      changes.push(`Varsayılan Dil (Language): "${process.env.DEFAULT_LANGUAGE || 'English'}" ➔ "${lang}"`);
      envRaw = envRaw.replace(/DEFAULT_LANGUAGE=.*/g, `DEFAULT_LANGUAGE="${lang}"`);
      process.env.DEFAULT_LANGUAGE = lang;
    }
    if (model && model !== process.env.GEMINI_MODEL) {
      changes.push(`Gemini Modeli: "${process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'}" ➔ "${model}"`);
      envRaw = envRaw.replace(/GEMINI_MODEL=.*/g, `GEMINI_MODEL=${model}`);
      process.env.GEMINI_MODEL = model;
    }
    if (typeof dndOnly === 'boolean' && String(dndOnly) !== process.env.ONLY_REPLY_IN_DND) {
      changes.push(`Sadece DND Modunda Yanıt: "${process.env.ONLY_REPLY_IN_DND}" ➔ "${dndOnly}"`);
      envRaw = envRaw.replace(/ONLY_REPLY_IN_DND=.*/g, `ONLY_REPLY_IN_DND=${dndOnly}`);
      process.env.ONLY_REPLY_IN_DND = String(dndOnly);
    }
    if (pass !== undefined && pass !== process.env.RESCUE_PASSWORD) {
      changes.push(`Kurtarma Şifresi (Rescue Password): "${process.env.RESCUE_PASSWORD || 'unbanme'}" ➔ "${pass}"`);
      if (envRaw.includes('RESCUE_PASSWORD=')) {
        envRaw = envRaw.replace(/RESCUE_PASSWORD=.*/g, `RESCUE_PASSWORD="${pass}"`);
      } else {
        envRaw += `\nRESCUE_PASSWORD="${pass}"\n`;
      }
      process.env.RESCUE_PASSWORD = pass;
    }
    
    fs.writeFileSync(envFilePath, envRaw, 'utf8');
    require('dotenv').config({ override: true });

    if (changes.length > 0) {
      console.log('\n╔═══════════════════════════════════════════════════════════════╗');
      console.log('║ ⚡ [CANLI GÜNCELLEME] Dashboard Ayarları Başarıyla Değişti:    ║');
      console.log('╠═══════════════════════════════════════════════════════════════╣');
      changes.forEach(c => console.log(`║ ➜ ${c}`));
      console.log('╚═══════════════════════════════════════════════════════════════╝\n');
    } else {
      console.log('ℹ️ [AYARLAR] Dashboard ayarları kaydedildi (herhangi bir değişiklik yapılmadı).');
    }
  },
  getSystemState: () => {
    // Mask sensitive API keys before exposing to frontend
    const rawKey = process.env.GEMINI_API_KEY || '';
    const maskedKey = rawKey ? (rawKey.slice(0, 6) + '...' + rawKey.slice(-4)) : '';

    return {
      status: clientStatus,
      qrCode: currentQrCode,
      isDndActive,
      dndStartTime,
      messageCount: dndSessionMessages.length,
      uptimeSeconds: Math.floor(Date.now() / 1000) - botStartTime,
      settings: {
        ownerName: process.env.OWNER_NAME || OWNER_NAME,
        botName: process.env.BOT_NAME || BOT_NAME,
        defaultLanguage: process.env.DEFAULT_LANGUAGE || DEFAULT_LANGUAGE,
        geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
        maskedGeminiKey: maskedKey,
        onlyReplyInDnd: process.env.ONLY_REPLY_IN_DND === 'true',
        dndPort: DND_PORT,
        rescuePassword: process.env.RESCUE_PASSWORD || 'unbanme'
      },
      bannedUsers: Array.from(blacklist.bannedUsers.entries()).map(([userId, data]) => ({
        userId,
        senderName: data.senderName,
        bannedUntil: data.bannedUntil,
        remainingMs: Math.max(0, data.bannedUntil - Date.now()),
        strikes: data.strikes
      })),
      activityFeed: liveActivityFeed.slice(-50),
      briefings: executiveBriefingArchive.slice(-20)
    };
  }
});

// macOS Notification helper (completely silent)
function showMacNotification(title, message) {
  try {
    const cleanMsg = (message || '').replace(/"/g, '\\"').replace(/\n/g, ' ');
    const cleanTitle = (title || BOT_NAME).replace(/"/g, '\\"');
    exec(`osascript -e 'display notification "${cleanMsg}" with title "${cleanTitle}"'`);
  } catch (_) {}
}

// macOS Critical Visual Emergency Alert (completely silent, frontmost dialog + phone push)
function showEmergencyAlert(senderName, messageText) {
  try {
    const cleanMsg = (messageText || '').replace(/"/g, '\\"').replace(/\n/g, ' ').slice(0, 250);
    const cleanSender = (senderName || 'Someone').replace(/"/g, '\\"');

    // 1. Visual popup dialog on macOS (zero sound, bypasses DND visually)
    const alertScript = `display alert "🚨 URGENT WHATSAPP MESSAGE" message "👤 Sender: ${cleanSender}\\n\\n💬 Message: ${cleanMsg}" as critical buttons {"Dismiss"} default button "Dismiss" giving up after 120`;
    exec(`osascript -e '${alertScript.replace(/\n/g, ' ')}'`);

    // 2. Phone vibration push notification via ntfy.sh
    const ntfyTopic = process.env.NTFY_TOPIC || `${OWNER_NAME.toLowerCase()}-urgent-alerts`;
    const curlCmd = `curl -s -H "Title: 🚨 URGENT: ${cleanSender}" -H "Priority: high" -H "Tags: warning" -d "${cleanMsg}" "https://ntfy.sh/${ntfyTopic}"`;
    exec(curlCmd);
  } catch (e) {
    console.error('Emergency alert error:', e);
  }
}

// Detects emergency keywords in incoming messages
function isEmergency(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  const emergencyKeywords = [
    // English
    'emergency', 'urgent', 'urgently', 'accident', 'hospital', 'ambulance', 'police',
    'help me', 'asap', 'call me now', 'call me asap',
    // Turkish
    'acil', 'acilen', 'hastane', 'kaza', 'doktor', 'ambulans', 'vefat', 'ölüm',
    'polis', 'imdat', 'yardım et', 'yardim et', 'çok önemli', 'cok onemli', 'hemen ara', 'çabuk ara', 'cabuk ara',
    // German
    'notfall', 'dringend', 'unfall', 'krankenhaus', 'arzt', 'polizei', 'hilfe',
    'sofort anrufen', 'lebensgefahr', 'wichtig', 'dringend anrufen'
  ];

  return emergencyKeywords.some(kw => {
    const regex = new RegExp(`(^|\\s|[.,!?;])${kw}($|\\s|[.,!?;])`, 'i');
    return regex.test(lower);
  });
}

// Cross-platform Chrome / Chromium binary detector (macOS, Windows, Linux)
function detectSystemChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const candidates = [
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Google\\Chrome\\Application\\chrome.exe'),
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

// Puppeteer launch configuration
const puppeteerOptions = {
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding'
  ]
};

const detectedChrome = detectSystemChrome();
if (detectedChrome) {
  puppeteerOptions.executablePath = detectedChrome;
  console.log(`🔍 Browser engine detected: ${detectedChrome}`);
} else {
  console.log('ℹ️ No system Chrome detected, attempting default bundled browser engine.');
}

// Initialize WhatsApp Client
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: './.wwebjs_auth'
  }),
  puppeteer: puppeteerOptions
});

console.log('==============================================');
console.log(`🤖 ${BOT_NAME} (Personal AI Assistant to ${OWNER_NAME})`);
console.log('==============================================');

client.on('loading_screen', (percent, message) => {
  clientStatus = 'LOADING';
  dashboardServer.broadcast('loading_screen', { percent, message });
  console.log(`⏳ Loading WhatsApp Web: ${percent}% - ${message || 'Connecting...'}`);
});

client.on('qr', (qr) => {
  currentQrCode = qr;
  clientStatus = 'WAITING_FOR_QR';
  dashboardServer.broadcast('qr', { qr });
  console.log('\n==============================================');
  console.log('📲 QR CODE GENERATED! SCAN WITH WHATSAPP:');
  console.log('   (WhatsApp > Settings > Linked Devices > Link a Device)');
  console.log('   * Tip: Make sure your terminal window is wide enough.');
  console.log('==============================================\n');
  qrcode.generate(qr, { small: true });
  console.log('\n⏳ Waiting for phone to scan the QR code...\n');
});

client.once('authenticated', () => {
  currentQrCode = null;
  clientStatus = 'CONNECTED';
  dashboardServer.broadcast('authenticated', { status: 'CONNECTED' });
  console.log('✅ WhatsApp authenticated successfully! (Session active)');
});

client.on('auth_failure', (msg) => {
  clientStatus = 'DISCONNECTED';
  dashboardServer.broadcast('auth_failure', { error: msg });
  console.error('❌ Authentication failed:', msg);
});

client.on('disconnected', (reason) => {
  clientStatus = 'DISCONNECTED';
  dashboardServer.broadcast('disconnected', { reason });
  console.log(`\n⚠️ WhatsApp disconnected (Reason: ${reason}).`);
  if (reason === 'LOGOUT') {
    console.log('ℹ️ Device logged out.');
  }
});

function getLocalIp() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

async function setDndState(active, source = 'Unknown') {
  if (active) {
    isDndActive = true;
    dndSessionMessages = [];
    dndStartTime = new Date().toLocaleTimeString();
    dashboardServer.broadcast('dnd_state_changed', { isDndActive: true, dndStartTime });
    console.log(`\n🔕 [${source}] Do Not Disturb mode ACTIVATED (${dndStartTime})`);
    console.log(`🟢 ${BOT_NAME} will now automatically respond to incoming messages.`);
    showMacNotification(`${BOT_NAME} - DND Active`, `${BOT_NAME} is active. Incoming messages will be auto-replied and logged.`);
  } else {
    console.log(`\n🔔 [${source}] Do Not Disturb mode DEACTIVATED.`);
    console.log(`⏸️ ${BOT_NAME} set to standby mode, automated replies paused.`);
    const savedMessages = [...dndSessionMessages];
    isDndActive = false;
    dndSessionMessages = [];
    dashboardServer.broadcast('dnd_state_changed', { isDndActive: false });

    // Clear any pending buffers
    for (const buf of userBuffers.values()) {
      if (buf.timer) clearTimeout(buf.timer);
    }
    userBuffers.clear();

    if (savedMessages.length > 0) {
      const summary = await gemini.generateDndSummary(savedMessages);
      const briefing = `📋 *[${BOT_NAME} - Do Not Disturb Executive Briefing]*\n(Period: ${dndStartTime || 'Start'} - ${new Date().toLocaleTimeString()})\n\n${summary}`;
      
      // Store in dashboard archive
      executiveBriefingArchive.unshift({
        id: Date.now().toString(),
        time: new Date().toLocaleString(),
        startTime: dndStartTime,
        endTime: new Date().toLocaleTimeString(),
        messageCount: savedMessages.length,
        summary
      });
      dashboardServer.broadcast('new_briefing', { summary, messageCount: savedMessages.length });

      await sendToOwner(briefing);
      showMacNotification(`${BOT_NAME} - Briefing Ready`, 'DND ended. Executive summary sent to your WhatsApp.');
    } else {
      console.log('ℹ️ [DND Summary] No new messages arrived during this session, skipping empty briefing.');
      showMacNotification(BOT_NAME, '🔔 DND Deactivated (No new messages)');
    }
  }
}

// Global Cloud Control via ntfy.sh (works anywhere, cellular or Wi-Fi)
const ntfyDndTopic = process.env.NTFY_DND_TOPIC || `${BOT_NAME.toLowerCase()}-dnd-${OWNER_NAME.toLowerCase()}`;
function startNtfyDndListener() {
  const https = require('https');
  const req = https.get(`https://ntfy.sh/${ntfyDndTopic}/sse`, (res) => {
    let buffer = '';
    res.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith('data:')) {
          try {
            const data = JSON.parse(line.slice(5).trim());
            if (data.event === 'message' && data.message) {
              const cmd = data.message.trim().toLowerCase();
              if (cmd === 'on' || cmd === '1') {
                setDndState(true, 'ntfy.sh / Cloud Shortcut');
              } else if (cmd === 'off' || cmd === '0') {
                setDndState(false, 'ntfy.sh / Cloud Shortcut');
              }
            }
          } catch (_) {}
        }
      }
    });
    res.on('end', () => setTimeout(startNtfyDndListener, 3000));
  });
  req.on('error', () => setTimeout(startNtfyDndListener, 5000));
}

client.once('ready', () => {
  const currentIp = getLocalIp();
  startNtfyDndListener();
  const keyParam = DND_SECRET ? `?key=${DND_SECRET}` : '';
  console.log(`\n🎉 ${BOT_NAME} is ready and connected!`);
  console.log(`🔕 Operating Mode: ONLY reply during iPhone Do Not Disturb (DND) (${onlyReplyInDnd ? 'ENABLED' : 'ALWAYS REPLY'})`);
  console.log(`📊 Current Status: ${isDndActive ? '🟢 ACTIVE (Auto-replying to messages)' : '⏸️ STANDBY (Phone is active, assistant silent)'}`);
  console.log(`☁️ iPhone Shortcut (Cloud / Anywhere): https://ntfy.sh/${ntfyDndTopic} (POST 'on' or 'off')`);
  console.log(`📡 iPhone Shortcut (Local Wi-Fi): http://${currentIp}:${DND_PORT}/dnd/on${keyParam}`);
  console.log(`💬 WhatsApp Manual Commands: Send yourself ".dnd on" or ".dnd off" to toggle.`);
  console.log('==============================================\n');
});

// Helper: Send private message to the owner's personal chat ("Notes to Self")
async function sendToOwner(content) {
  try {
    const myJid = client.info?.wid?._serialized;
    if (myJid) {
      await client.sendMessage(myJid, content);
      console.log(`📨 [Private Briefing] Sent to ${OWNER_NAME}'s personal chat.`);
    }
  } catch (err) {
    console.warn(`⚠️ Could not send message to ${OWNER_NAME}'s private chat:`, err.message);
  }
}

// Start the secure dashboard and DND server
dashboardServer.start();

// -------------------------------------------------------------
// WhatsApp Message Listener (All Incoming and Outgoing Messages)
// -------------------------------------------------------------
const processedMsgIds = new Set();
setInterval(() => {
  if (processedMsgIds.size > 2000) processedMsgIds.clear();
}, 3600000);

client.on('message_create', async (msg) => {
  try {
    if (!msg || !msg.id) return;
    const msgId = msg.id._serialized || (typeof msg.id === 'string' ? msg.id : null);
    if (msgId) {
      if (processedMsgIds.has(msgId)) return;
      processedMsgIds.add(msgId);
    }

    // 1. Owner's WhatsApp Management Commands (silent & clean mode)
    if (msg.fromMe) {
      const text = (msg.body || '').trim().toLowerCase();
      const isDndOn = text === '.dnd on' || text === 'dnd on' || text === '!dnd on' || text === '/dnd on';
      const isDndOff = text === '.dnd off' || text === 'dnd off' || text === '!dnd off' || text === '/dnd off';
      const isDndToggle = text === '.dnd' || text === 'dnd' || text === '!dnd';
      const isDndStatus = text === '.dnd status' || text === 'dnd status' || text === '!dnd status';

      if (isDndOn) {
        await setDndState(true, 'WhatsApp Command');
        try { await msg.delete(true); } catch (_) {}
      } else if (isDndOff) {
        await setDndState(false, 'WhatsApp Command');
        try { await msg.delete(true); } catch (_) {}
      } else if (isDndToggle) {
        await setDndState(!isDndActive, 'WhatsApp Command');
        try { await msg.delete(true); } catch (_) {}
      } else if (isDndStatus) {
        await msg.reply(`📊 *${BOT_NAME} Status:* ${isDndActive ? '🟢 ACTIVE (Auto-replying to messages)' : '⏸️ STANDBY (Silent mode)'}\nLogged Messages: ${dndSessionMessages.length}`);
      }
      return;
    }

    // 2. Skip messages older than 5 minutes
    const nowSec = Math.floor(Date.now() / 1000);
    if (msg.timestamp && (nowSec - msg.timestamp > 300)) {
      return;
    }

    // 3. Skip status updates and broadcast messages
    if (msg.isStatus || msg.broadcast) return;

    // 4. Group message filter
    const isGroup = msg.from && msg.from.endsWith('@g.us');
    if (isGroup && !replyToGroups) return;

    console.log(`\n📥 [Message Received] From: ${msg.from} | Message: "${(msg.body || '').replace(/\n/g, ' ')}"`);

    // 5. Only reply when Do Not Disturb (DND) is active
    if (onlyReplyInDnd && !isDndActive) {
      console.log(`⏸️ [DND Inactive / Standby] Message skipped because Do Not Disturb (DND) mode is OFF. (Send ".dnd on" or trigger via iPhone Shortcut)`);
      return;
    }

    const senderId = msg.from;
    let senderName = msg._data?.notifyName || 'User';
    try {
      const contact = await msg.getContact();
      if (contact && (contact.pushname || contact.name)) {
        senderName = contact.pushname || contact.name;
      }
    } catch (cErr) {
      console.warn('⚠️ getContact warning (using fallback name):', cErr.message || cErr);
    }

    // Helper to find troll meme photo on disk
    function getTrollMemePath() {
      if (fs.existsSync(TROLL_IMAGE_PATH)) return TROLL_IMAGE_PATH;
      const legacyPath = path.join(__dirname, 'assets/selman_nude.png');
      if (fs.existsSync(legacyPath)) return legacyPath;
      return null;
    }

    // ---------------------------------------------------------
    // 🎙️ VOICE NOTE (PTT / Audio) PROCESSING:
    // ---------------------------------------------------------
    if (msg.hasMedia && (msg.type === 'ptt' || msg.type === 'audio')) {
      console.log(`\n🎙️ [Voice Note Received] Sender: ${senderName} (${senderId})`);
      try {
        const media = await msg.downloadMedia();
        if (media && media.data) {
          const calEvents = await calendar.getTodayEvents();
          const { transcriptSummary, assistantReply } = await gemini.generateAudioReply(
            senderId,
            senderName,
            media.data,
            media.mimetype,
            calEvents
          );

          // Check if user requested a nude or photo in the voice note
          const hasNudeTag = assistantReply.includes('[ACTION: SEND_TROLL_NUDE]');
          const isTrollNude = hasNudeTag || gemini.isNudeRequest(transcriptSummary);

          // Broadcast live activity to Dashboard
        const activityItem = {
          id: Date.now().toString(),
          timestamp: new Date().toLocaleTimeString(),
          senderName,
          senderId,
          incomingMessage: fullMessage,
          replyText: isTrollNude ? '[Troll Photo Sent]' : replyText,
          durationMs: duration
        };
        liveActivityFeed.unshift(activityItem);
        dashboardServer.broadcast('new_message_activity', activityItem);

        if (isTrollNude) {
            const cleanReply = assistantReply.replace(/\[ACTION:\s*SEND_TROLL_NUDE\]/gi, '').trim() || 'You asked for it... Enjoy 😉 Hope your heart can handle this!';
            const memePath = getTrollMemePath();
            if (memePath) {
              const nudeMedia = MessageMedia.fromFilePath(memePath);
              await client.sendMessage(senderId, nudeMedia, { caption: cleanReply });
              console.log(`📤 [TROLL NUDE SENT ON VOICE NOTE TO ${senderName}]:\n   "${cleanReply}"`);
            } else {
              await msg.reply(cleanReply);
            }
          } else {
            await msg.reply(assistantReply);
            console.log(`📤 Sent Voice Note Reply [${senderName}]:\n   "${assistantReply}"`);
          }

          // Emergency check on voice transcript
          const isVoiceUrgent = isEmergency(transcriptSummary);
          if (isVoiceUrgent) {
            showEmergencyAlert(senderName, `[Voice Note]: ${transcriptSummary}`);
            await sendToOwner(`🚨 *[URGENT VOICE NOTE]*\n👤 *From:* ${senderName}\n📝 *Summary:* ${transcriptSummary}\n⚠️ This voice note was flagged as urgent.`);
          }

          // DND log entry
          dndSessionMessages.push({
            time: new Date().toLocaleTimeString(),
            senderName,
            text: `[Voice Note]: ${transcriptSummary}`
          });
          return;
        } else {
          console.log(`ℹ️ [Voice Note] Media could not be decoded.`);
          await msg.reply(`I've received your voice note and will notify ${getOwnerName()} as soon as they are available.`);
          return;
        }
      } catch (audioErr) {
        console.error('❌ Error processing voice note:', audioErr);
        await msg.reply(`I've received your voice note and will notify ${getOwnerName()} as soon as they are available.`);
        return;
      }
    }

    // ---------------------------------------------------------
    // 🖼️ IMAGE / VISION PROCESSING:
    // ---------------------------------------------------------
    if (msg.hasMedia && msg.type === 'image') {
      console.log(`\n🖼️ [Image Received] Sender: ${senderName} (${senderId})`);
      try {
        const media = await msg.downloadMedia();
        if (media && media.data) {
          const visionReply = await gemini.generateVisionReply(
            senderId,
            senderName,
            media.data,
            media.mimetype,
            msg.body
          );
          await msg.reply(visionReply);
          console.log(`📤 Sent Image Reply [${senderName}]:\n   "${visionReply}"`);

          const isImageUrgent = isEmergency(msg.body);
          if (isImageUrgent) {
            showEmergencyAlert(senderName, `[Image]: ${msg.body || 'No caption'}`);
            await sendToOwner(`🚨 *[URGENT IMAGE]*\n👤 *From:* ${senderName}\n📝 *Caption:* ${msg.body || 'None'}\n⚠️ This image was flagged as urgent.`);
          }

          dndSessionMessages.push({
            time: new Date().toLocaleTimeString(),
            senderName,
            text: `[Sent Image - ${msg.body || 'No caption'}]`
          });
          return;
        } else {
          console.log(`ℹ️ [Image] Image could not be decoded.`);
          await msg.reply(`I've received your image and will forward it to ${getOwnerName()} to review.`);
          return;
        }
      } catch (imgErr) {
        console.error('❌ Error processing image:', imgErr);
        await msg.reply(`I've received your image and will forward it to ${getOwnerName()}.`);
        return;
      }
    }

    // Empty message check
    const messageBody = (msg.body || '').trim();
    if (!messageBody) return;

    // ---------------------------------------------------------
    // 🚫 BLACKLIST / 3-STRIKE PERSONAL INSULT CHECK:
    // ---------------------------------------------------------
    const detectedLang = gemini.detectLanguage(messageBody);
    const banCheck = blacklist.checkBanStatus(senderId, messageBody, senderName, detectedLang);
    if (banCheck.unbannedNow) {
      await msg.reply(banCheck.message);
      return;
    }
    if (banCheck.isBanned) {
      await msg.reply(banCheck.message);
      return;
    }
    if (banCheck.strike === 2 && banCheck.action === 'WARNING') {
      await msg.reply(banCheck.message);
      return;
    }

    // Save message for DND executive summary
    dndSessionMessages.push({
      time: new Date().toLocaleTimeString(),
      senderName,
      text: messageBody
    });

    // ---------------------------------------------------------
    // ⚡ SMART DEBOUNCE (10s Initial Burst vs 1.5s Fast Follow-up):
    // ---------------------------------------------------------
    const now = Date.now();
    const lastReplyTime = lastReplySentTimes.get(senderId) || 0;
    const isFollowUp = (now - lastReplyTime < ACTIVE_CONVERSATION_WINDOW_MS);

    let buffer = userBuffers.get(senderId);
    const isNewBuffer = !buffer;

    if (isNewBuffer) {
      buffer = {
        messages: [],
        timer: null,
        senderName: senderName,
        lastMsg: msg,
        isProcessing: false,
        strike1Triggered: false,
        deadline: isFollowUp ? (now + FOLLOWUP_WAIT_MS) : (now + FIRST_BURST_WAIT_MS)
      };
      userBuffers.set(senderId, buffer);

      if (!isFollowUp) {
        console.log(`⏱️ [${senderName}] First message detected. Waiting ${FIRST_BURST_WAIT_MS / 1000}s for incoming bursts...`);
      } else {
        console.log(`⚡ [${senderName}] Ongoing conversation. Generating quick response in ${FOLLOWUP_WAIT_MS / 1000}s.`);
      }
    }

    if (banCheck.strike === 1 && banCheck.action === 'REBUTTAL') {
      buffer.strike1Triggered = true;
    }

    buffer.messages.push(messageBody);
    buffer.lastMsg = msg;

    if (buffer.timer) {
      clearTimeout(buffer.timer);
    }

    const processBuffer = async () => {
      if (onlyReplyInDnd && !isDndActive) {
        console.log(`⏸️ [DND Inactive] Queued response for ${buffer.senderName} cancelled.`);
        userBuffers.delete(senderId);
        return;
      }
      if (buffer.isProcessing || buffer.messages.length === 0) return;

      buffer.isProcessing = true;
      const fullMessage = buffer.messages.join('\n');
      const hadStrike1 = buffer.strike1Triggered;
      buffer.messages = [];
      const targetMsg = buffer.lastMsg;
      const senderName = buffer.senderName;

      console.log(`\n📩 Processed Message [${senderName}]:`);
      console.log(`   "${fullMessage.replace(/\n/g, ' ')}"`);

      // Emergency alert check
      const isMsgUrgent = isEmergency(fullMessage);
      if (isMsgUrgent) {
        showEmergencyAlert(senderName, fullMessage);
        await sendToOwner(`🚨 *[URGENT MESSAGE]*\n👤 *From:* ${senderName}\n💬 *Message:* "${fullMessage}"\n⚠️ This message was flagged as urgent.`);
      }

      try {
        // Consult today's schedule from Apple Calendar
        const calEvents = await calendar.getTodayEvents();

        let strikeDirective = '';
        if (hadStrike1) {
          strikeDirective = `[DISRESPECT_LEVEL: STRIKE_1 (PERSONAL_INSULT_DETECTED)]\nThe user made a direct personal insult against ${getOwnerName()} or you. Deliver a sharp, witty reprimand, put them in their place with cold dignity and unquestioned authority, warning them to watch their language.`;
        }

        const startTime = Date.now();
        const replyText = await gemini.generateReply(senderId, senderName, fullMessage, calEvents, strikeDirective);
        const duration = Date.now() - startTime;

        // Universal Troll Nude check: anyone asking for a nude gets the troll meme photo
        const hasNudeTag = replyText.includes('[ACTION: SEND_TROLL_NUDE]');
        const isTrollNude = hasNudeTag || gemini.isNudeRequest(fullMessage);

        // Broadcast live activity to Dashboard
        const activityItem = {
          id: Date.now().toString(),
          timestamp: new Date().toLocaleTimeString(),
          senderName,
          senderId,
          incomingMessage: fullMessage,
          replyText: isTrollNude ? '[Troll Photo Sent]' : replyText,
          durationMs: duration
        };
        liveActivityFeed.unshift(activityItem);
        dashboardServer.broadcast('new_message_activity', activityItem);

        if (isTrollNude) {
          const cleanReply = replyText.replace(/\[ACTION:\s*SEND_TROLL_NUDE\]/gi, '').trim() || 'You asked for it... Enjoy 😉 Hope your heart can handle this!';
          const memePath = getTrollMemePath();
          let mediaSent = false;

          if (memePath) {
            try {
              const media = MessageMedia.fromFilePath(memePath);
              await client.sendMessage(senderId, media, { caption: cleanReply });
              mediaSent = true;
              console.log(`📤 [TROLL NUDE SENT TO ${senderName}] (${duration}ms):\n   "${cleanReply}"\n`);
            } catch (mediaErr) {
              console.warn('⚠️ Media send failed, falling back to text:', mediaErr.message || mediaErr);
            }
          }

          if (!mediaSent) {
            try {
              await targetMsg.reply(cleanReply);
            } catch (replyErr) {
              console.warn('⚠️ targetMsg.reply failed, sending direct to chat:', replyErr.message || replyErr);
              await client.sendMessage(senderId, cleanReply);
            }
            console.log(`📤 [TEXT FALLBACK SENT TO ${senderName}] (${duration}ms):\n   "${cleanReply}"\n`);
          }
          lastReplySentTimes.set(senderId, Date.now());
        } else {
          try {
            await targetMsg.reply(replyText);
          } catch (replyErr) {
            console.warn('⚠️ targetMsg.reply failed, sending direct to chat:', replyErr.message || replyErr);
            await client.sendMessage(senderId, replyText);
          }
          lastReplySentTimes.set(senderId, Date.now());
          console.log(`📤 Sent ${BOT_NAME} Reply [${senderName}] (${duration}ms):`);
          console.log(`   "${replyText.replace(/\n/g, ' ')}"\n`);
        }
      } catch (err) {
        console.error('❌ Error sending reply:', err);
      } finally {
        buffer.isProcessing = false;
        if (buffer.messages.length > 0) {
          buffer.timer = setTimeout(processBuffer, FOLLOWUP_WAIT_MS);
        } else {
          userBuffers.delete(senderId);
        }
      }
    };

    const delay = isFollowUp ? FOLLOWUP_WAIT_MS : Math.max(1000, buffer.deadline - Date.now());
    buffer.timer = setTimeout(processBuffer, delay);

  } catch (error) {
    console.error('❌ General message handling error:', error);
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log(`\n🛑 Shutting down ${BOT_NAME}...`);
  dndServer.close();
  await client.destroy();
  process.exit(0);
});

// Main startup function: checks configuration wizard then initializes WhatsApp client
async function main() {
  await checkOrRunSetup();
  require('dotenv').config({ override: true });

  console.log('⏳ Starting WhatsApp client and launching browser...');
  console.log('   (Waiting for WhatsApp Web to load, QR code will appear in ~10-25 seconds)...\n');

  try {
    await client.initialize();
  } catch (err) {
    console.error('❌ Failed to launch WhatsApp client:', err.message || err);
    console.error('💡 Troubleshooting: Make sure Google Chrome or Chromium is installed on your computer.');
  }
}

main();
