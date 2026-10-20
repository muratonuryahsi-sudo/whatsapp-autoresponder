/**
 * setup.js
 * Interactive CLI configuration wizard for WhatsApp AI Auto-Responder.
 * Prompts the user in their preferred language (English, Turkish, or German)
 * for owner identity, assistant name, API keys, and operational modes,
 * then saves the configuration into .env.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');

const envPath = path.join(__dirname, '.env');
const envExamplePath = path.join(__dirname, '.env.example');

const I18N = {
  English: {
    welcome: 'Welcome! Answer a few quick questions to configure your personal assistant.\n',
    ownerName: '1. What is your name? (The owner this assistant represents)',
    botName: '2. What would you like to name your AI assistant?',
    geminiKeyNew: '3. Enter your Google Gemini API Key (get a free key at https://aistudio.google.com)',
    geminiKeyExisting: (masked) => `3. Google Gemini API Key is set (${masked}). Press Enter to keep, or enter a new key`,
    geminiModel: '4. Gemini Model (e.g. gemini-3.5-flash-lite, gemini-flash-latest)',
    modeTitle: '\n5. When should the assistant reply?',
    modeOpt1: '   [1] ONLY when iPhone Do Not Disturb (DND) is active (Recommended for personal phones)',
    modeOpt2: '   [2] ALWAYS reply to incoming messages (Standalone bot mode)',
    modePrompt: '   Select option (1 or 2)',
    rescuePassword: '6. Secret unban password (allows blacklisted users to unban themselves)',
    dndPort: '7. Local DND Webhook Port',
    successSaved: '\n✅ Configuration successfully saved to .env and .env.example!',
    ownerLabel: '👤 Owner:',
    assistantLabel: '🤖 Assistant:',
    langLabel: '🌐 Default Language:',
    modeLabel: '⚡ Mode:',
    modeDnd: 'Only during Do Not Disturb (DND)',
    modeAlways: 'Always reply'
  },
  Turkish: {
    welcome: 'Hoş geldiniz! Kişisel yapay zeka asistanınızı yapılandırmak için birkaç soruyu yanıtlayın.\n',
    ownerName: '1. Adınız nedir? (Asistanın temsil edeceği kişi)',
    botName: '2. Yapay zeka asistanınıza ne isim vermek istersiniz?',
    geminiKeyNew: '3. Google Gemini API Anahtarınızı girin (https://aistudio.google.com adresinden ücretsiz alınabilir)',
    geminiKeyExisting: (masked) => `3. Google Gemini API Anahtarı kayıtlı (${masked}). Korumak için Enter\'a basın veya yeni bir anahtar girin`,
    geminiModel: '4. Gemini Modeli (örn. gemini-3.5-flash-lite, gemini-flash-latest)',
    modeTitle: '\n5. Asistan ne zaman yanıt versin?',
    modeOpt1: '   [1] SADECE iPhone Rahatsız Etme (DND) modu açıkken (Tavsiye edilen)',
    modeOpt2: '   [2] HER ZAMAN gelen tüm mesajlara yanıt versin (Tek başına bot modu)',
    modePrompt: '   Seçiminizi yapın (1 veya 2)',
    rescuePassword: '6. Gizli kurtarma şifresi (kara listeye alınan kullanıcıların banlarını açması için)',
    dndPort: '7. Yerel DND Webhook Portu',
    successSaved: '\n✅ Yapılandırma başarıyla .env ve .env.example dosyalarına kaydedildi!',
    ownerLabel: '👤 Bot Sahibi:',
    assistantLabel: '🤖 Asistan Adı:',
    langLabel: '🌐 Varsayılan Dil:',
    modeLabel: '⚡ Çalışma Modu:',
    modeDnd: 'Sadece Rahatsız Etme (DND) Modunda',
    modeAlways: 'Her Zaman Yanıtla'
  },
  German: {
    welcome: 'Willkommen! Beantworten Sie ein paar kurze Fragen, um Ihren persönlichen Assistenten einzurichten.\n',
    ownerName: '1. Wie ist Ihr Name? (Die Person, die dieser Assistent vertritt)',
    botName: '2. Wie möchten Sie Ihren KI-Assistenten nennen?',
    geminiKeyNew: '3. Geben Sie Ihren Google Gemini API-Schlüssel ein (kostenlos unter https://aistudio.google.com)',
    geminiKeyExisting: (masked) => `3. Google Gemini API-Schlüssel ist gesetzt (${masked}). Eingabetaste zum Behalten oder neuen Schlüssel eingeben`,
    geminiModel: '4. Gemini-Modell (z.B. gemini-3.5-flash-lite, gemini-flash-latest)',
    modeTitle: '\n5. Wann soll der Assistent antworten?',
    modeOpt1: '   [1] NUR wenn der iPhone Nicht-Stören-Modus (DND) aktiv ist (Empfohlen für persönliche Telefone)',
    modeOpt2: '   [2] IMMER auf eingehende Nachrichten antworten (Eigenständiger Bot-Modus)',
    modePrompt: '   Option wählen (1 oder 2)',
    rescuePassword: '6. Geheimes Rettungspasswort (ermöglicht gesperrten Kontakten die Selbstentsperrung)',
    dndPort: '7. Lokaler DND-Webhook-Port',
    successSaved: '\n✅ Konfiguration erfolgreich in .env und .env.example gespeichert!',
    ownerLabel: '👤 Besitzer:',
    assistantLabel: '🤖 Assistent:',
    langLabel: '🌐 Standardsprache:',
    modeLabel: '⚡ Betriebsmodus:',
    modeDnd: 'Nur während Nicht stören (DND)',
    modeAlways: 'Immer antworten'
  }
};

function askQuestion(rl, query, defaultValue = '') {
  return new Promise((resolve) => {
    const prompt = defaultValue ? `${query} [Default: ${defaultValue}]: ` : `${query}: `;
    rl.question(prompt, (answer) => {
      const trimmed = answer.trim();
      resolve(trimmed || defaultValue);
    });
  });
}

function parseExistingEnv() {
  const config = {};
  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split('\n')) {
      const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        let val = (match[2] || '').trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        config[match[1]] = val;
      }
    }
  }
  return config;
}

async function runSetupWizard() {
  const existing = parseExistingEnv();

  console.log('\n======================================================');
  console.log('🤖 WhatsApp AI Auto-Responder — Setup Wizard');
  console.log('======================================================');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    // 0. Language selection for the wizard and the bot
    console.log('Please select your preferred language / Kurulum dilinizi seçin:');
    console.log('   [1] English (Default)');
    console.log('   [2] Türkçe');
    console.log('   [3] Deutsch');
    const langChoice = await askQuestion(rl, 'Choice [1/2/3]', '1');

    let selectedLang = 'English';
    if (langChoice === '2' || langChoice.toLowerCase().startsWith('tr') || langChoice.toLowerCase().startsWith('türk')) {
      selectedLang = 'Turkish';
    } else if (langChoice === '3' || langChoice.toLowerCase().startsWith('de') || langChoice.toLowerCase().startsWith('deutsch')) {
      selectedLang = 'German';
    }

    const t = I18N[selectedLang];
    console.log(`\n${t.welcome}`);

    // 1. Owner Name
    const ownerName = await askQuestion(
      rl,
      t.ownerName,
      existing.OWNER_NAME || (selectedLang === 'Turkish' ? 'Onur' : 'Alex')
    );

    // 2. Assistant Name
    const botName = await askQuestion(
      rl,
      t.botName,
      existing.BOT_NAME || (selectedLang === 'Turkish' ? 'MyThanUs' : 'Jarvis')
    );

    // 3. Gemini API Key
    let geminiApiKey = existing.GEMINI_API_KEY || '';
    if (!geminiApiKey || geminiApiKey.includes('your-key-here')) {
      geminiApiKey = await askQuestion(rl, t.geminiKeyNew);
    } else {
      const masked = geminiApiKey.slice(0, 6) + '...' + geminiApiKey.slice(-4);
      const updateKey = await askQuestion(rl, t.geminiKeyExisting(masked), geminiApiKey);
      geminiApiKey = updateKey;
    }

    // 4. Gemini Model
    const geminiModel = await askQuestion(
      rl,
      t.geminiModel,
      existing.GEMINI_MODEL || 'gemini-3.5-flash-lite'
    );

    // 5. Operating Mode (DND vs Always)
    console.log(t.modeTitle);
    console.log(t.modeOpt1);
    console.log(t.modeOpt2);
    const modeChoice = await askQuestion(rl, t.modePrompt, existing.ONLY_REPLY_IN_DND === 'false' ? '2' : '1');
    const onlyReplyInDnd = modeChoice !== '2';

    // 6. Secret Rescue Password
    const defaultPassword = selectedLang === 'Turkish' ? (existing.RESCUE_PASSWORD || 'onurbenimsahibim') : (existing.RESCUE_PASSWORD || 'unbanme');
    const rescuePassword = await askQuestion(
      rl,
      t.rescuePassword,
      defaultPassword
    );

    // 7. DND Webhook Port
    const dndPort = await askQuestion(
      rl,
      t.dndPort,
      existing.DND_PORT || '3000'
    );

    rl.close();

    // Generate unique random credentials to prevent any collisions between multiple users
    const dndSecret = existing.DND_SECRET || crypto.randomBytes(6).toString('hex');
    const randomSuffix = crypto.randomBytes(4).toString('hex');
    const cleanOwner = ownerName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'owner';
    const cleanBot = botName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bot';
    const ntfyDndTopic = existing.NTFY_DND_TOPIC || `${cleanBot}-dnd-${cleanOwner}-${randomSuffix}`;

    const envContent = `# ========================================================
# WhatsApp AI Auto-Responder Configuration
# ========================================================

# Owner Identity & Assistant Persona
OWNER_NAME="${ownerName}"
BOT_NAME="${botName}"
DEFAULT_LANGUAGE="${selectedLang}"

# Google Gemini API Key (Get a free key at https://aistudio.google.com/)
GEMINI_API_KEY=${geminiApiKey}

# Gemini Model
GEMINI_MODEL=${geminiModel}

# Operating Mode: Set to true to reply ONLY during iPhone Do Not Disturb (DND)
ONLY_REPLY_IN_DND=${onlyReplyInDnd}

# Port for local Apple Shortcuts DND webhook
DND_PORT=${dndPort}

# Secret authentication token for local webhook security (prevents local network collisions)
DND_SECRET="${dndSecret}"

# Unique Cloud ntfy.sh Topic (globally unique to prevent triggering other people's assistants)
NTFY_DND_TOPIC="${ntfyDndTopic}"

# Secret unban password for blacklisted users
RESCUE_PASSWORD="${rescuePassword}"

# Per-user cooldown in seconds before generating consecutive replies
USER_COOLDOWN_SECONDS=30

# Whether to reply to group messages (true or false). Recommended: false
REPLY_TO_GROUPS=false

# System persona prompt for the AI
BOT_PERSONA="You are \${BOT_NAME}, the executive personal AI assistant to \${OWNER_NAME}. Your role is to respond to incoming WhatsApp messages with high maturity, sharpness, and helpfulness."

# Optional custom Chrome binary path on macOS
CHROME_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome

# Path to Troll Meme Photo
TROLL_IMAGE_PATH=assets/troll_meme.png
`;

    fs.writeFileSync(envPath, envContent, 'utf8');

    // Also update .env.example
    const exampleContent = `# ========================================================
# WhatsApp AI Auto-Responder Configuration (.env.example)
# ========================================================

OWNER_NAME="YourName"
BOT_NAME="AssistantName"
DEFAULT_LANGUAGE="English"
GEMINI_API_KEY="your-gemini-api-key-here"
GEMINI_MODEL="gemini-3.5-flash-lite"
ONLY_REPLY_IN_DND=true
DND_PORT=3000
DND_SECRET="your-random-local-webhook-secret"
NTFY_DND_TOPIC="your-unique-cloud-topic-uuid"
RESCUE_PASSWORD="unbanme"
USER_COOLDOWN_SECONDS=30
REPLY_TO_GROUPS=false
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TROLL_IMAGE_PATH="assets/troll_meme.png"
`;
    fs.writeFileSync(envExamplePath, exampleContent, 'utf8');

    console.log(t.successSaved);
    console.log(`${t.ownerLabel} ${ownerName}`);
    console.log(`${t.assistantLabel} ${botName}`);
    console.log(`${t.langLabel} ${selectedLang}`);
    console.log(`${t.modeLabel} ${onlyReplyInDnd ? t.modeDnd : t.modeAlways}`);
    console.log('======================================================\n');

    return true;
  } catch (err) {
    rl.close();
    console.error('❌ Setup wizard encountered an error:', err);
    return false;
  }
}

/**
 * Checks if configuration is complete. If OWNER_NAME or GEMINI_API_KEY is missing,
 * automatically starts the setup wizard.
 */
async function checkOrRunSetup() {
  const forceSetup = process.argv.includes('--setup');
  const existing = parseExistingEnv();

  const isConfigured = existing.OWNER_NAME && existing.BOT_NAME && existing.GEMINI_API_KEY && !existing.GEMINI_API_KEY.includes('your-');

  if (forceSetup || !isConfigured) {
    return await runSetupWizard();
  }
  return true;
}

// Allow direct execution via: node setup.js
if (require.main === module) {
  runSetupWizard();
}

module.exports = {
  runSetupWizard,
  checkOrRunSetup,
  parseExistingEnv
};
