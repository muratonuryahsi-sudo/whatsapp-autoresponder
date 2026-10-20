/**
 * blacklist.js
 * Manages user blacklists, 3-strike rules for personal insults,
 * and secret password unbanning.
 */

class BlacklistService {
  constructor() {
    // userId -> { bannedUntil: timestamp, strikes: number, senderName: string }
    this.bannedUsers = new Map();

    // userId -> { strikes: number, lastStrikeAt: timestamp }
    this.userStrikes = new Map();

    this.initialBanMinutes = 15;
    this.strikeTtlMs = 2 * 60 * 60 * 1000; // Strikes reset after 2 hours of good behavior
  }

  get ownerName() {
    return process.env.OWNER_NAME || 'Owner';
  }

  get rescuePassword() {
    return (process.env.RESCUE_PASSWORD || 'unbanme').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Checks if user entered the secret rescue password to unban themselves.
   */
  isRescueAttempt(text) {
    if (!text) return false;
    const clean = text.toLowerCase().replace(/[^a-z0-9]/g, '');
    return clean.includes(this.rescuePassword);
  }

  /**
   * Distinguishes general slang / swear words ("bu ne amk", "shit", "fuck")
   * from DIRECT PERSONAL INSULTS targeting the owner or the assistant.
   */
  isPersonalInsult(text) {
    if (!text) return false;
    const clean = text.toLowerCase().replace(/['"`.,!?;:()_\-\n\r\t]/g, ' ');
    const ownerClean = this.ownerName.toLowerCase().replace(/[^a-z0-9]/g, '');

    // 1. Direct attacks targeting the owner
    const ownerNamePatterns = [
      new RegExp(`\\b(orospu|pic|piç|oç|oc|kahpe|yavşak|pezevenk)\\s+(${ownerClean}|onur|murat)\\b`, 'i'),
      new RegExp(`\\b(${ownerClean}|onur|murat)\\b.*(orospu|pic|piç|sik|amk|aq|kahpe|yavşak|karım|kopek|köpek)`, 'i'),
      new RegExp(`\\b(${ownerClean}|onur|murat).*(sikeyim|sikim|sokuyum|sokayım|sokim|pandik)`, 'i'),
      new RegExp(`\\b(fuck|fick)\\s+(${ownerClean}|onur|murat)\\b`, 'i'),
      /\b(sahibin|sahibini|sahibine)\b.*(orospu|sik|amk|aq|pic|piç|kahpe|yavşak)/i
    ];

    // 2. Direct attacks targeting the conversational partner / assistant ("sen", "senin", "seni", "you")
    const assistantPatterns = [
      /\b(seni|senin|sana)\b.*(sik|sikeyim|sikecegim|sikicem|sokim|sokayım|sokuyum|amk|aq|pic|piç|orospu|got|göt|anal|pandik)/i,
      /\b(sikicem|sikeyim|sikeceğim|sokucam|sokacam)\s+(seni|sizi|asistan)/i,
      /\b(senin)\s+(anan|ananı|bacını|avradını|sulaleni|sülaleni|sahibini|amına)\b/i,
      /\byarra[gğ]a\s+bak\b/i,
      /\b(seni|sizi|asistanını|asistanini)\s+pandikliyorum\b/i,
      /\b(fuck\s+you|fuck\s+u|shut\s+the\s+fuck\s+up|fick\s+dich|du\s+arschloch|halt\s+die\s+fresse)\b/i,
      /\borospu\s+(çocuğu|cocugu|çocu|cocu)\b/i
    ];

    return ownerNamePatterns.some(rgx => rgx.test(clean)) || assistantPatterns.some(rgx => rgx.test(clean));
  }

  banUser(userId, senderName = 'User', durationMinutes = 15) {
    const existing = this.bannedUsers.get(userId);
    const strikes = existing ? existing.strikes + 1 : 3;
    const banDurationMs = durationMinutes * 60 * 1000;
    const bannedUntil = Date.now() + banDurationMs;

    this.bannedUsers.set(userId, {
      bannedUntil,
      strikes,
      senderName
    });

    console.log(`🚫 [BLACKLIST] ${senderName} (${userId}) banned for ${durationMinutes} minutes!`);
    return { bannedUntil, strikes };
  }

  unbanUser(userId) {
    const wasBanned = this.bannedUsers.has(userId);
    if (wasBanned) {
      this.bannedUsers.delete(userId);
      this.userStrikes.delete(userId);
      console.log(`🔓 [BLACKLIST] ${userId} unbanned with rescue password!`);
    }
    return wasBanned;
  }

  /**
   * Checks ban status & evaluates strikes:
   * - Strike 1: Rebuttal (let AI give sharp witty response)
   * - Strike 2: Final Warning
   * - Strike 3: 15-minute Ban
   */
  checkBanStatus(userId, messageText, senderName = '', detectedLang = 'English') {
    const now = Date.now();

    // 1. Check if user enters the secret rescue password
    if (this.isRescueAttempt(messageText)) {
      const removed = this.unbanUser(userId);
      if (removed) {
        let msg = `✅ Verification successful! Password accepted ("${this.rescuePassword}"). You have been unbanned; please maintain a respectful tone moving forward.`;
        if (detectedLang === 'Turkish') {
          msg = `✅ Doğrulama başarılı! Şifre kabul edildi ("${this.rescuePassword}"). Kara listeden çıkarıldınız; lütfen bundan sonra saygılı konuşmaya özen gösterin.`;
        } else if (detectedLang === 'German') {
          msg = `✅ Überprüfung erfolgreich! Passwort akzeptiert ("${this.rescuePassword}"). Du wurdest entsperrt; bitte achte ab jetzt auf einen respektvollen Ton.`;
        }
        return {
          isBanned: false,
          unbannedNow: true,
          message: msg
        };
      }
    }

    // 2. Check if currently banned
    const banInfo = this.bannedUsers.get(userId);
    if (banInfo) {
      if (now >= banInfo.bannedUntil) {
        // Ban expired naturally
        this.bannedUsers.delete(userId);
        this.userStrikes.delete(userId);
      } else {
        // Still banned! Check if they keep sending personal insults -> +10 min penalty
        if (this.isPersonalInsult(messageText)) {
          banInfo.bannedUntil += 10 * 60 * 1000;
          console.log(`⚠️ [BLACKLIST] ${senderName} insult penalty: ban extended by 10 minutes.`);
        }

        const remainingMs = Math.max(0, banInfo.bannedUntil - now);
        const mins = Math.floor(remainingMs / 60000);
        const secs = Math.floor((remainingMs % 60000) / 1000);
        const padSecs = secs < 10 ? '0' + secs : secs;

        let banMsg = `⚠️ You are blacklisted! If you do not correct your language, your ban will be extended.\nRemaining ban time: ${mins} minutes ${padSecs} seconds.`;
        if (detectedLang === 'Turkish') {
          banMsg = `⚠️ Kara listedesiniz! Terbiyenizi düzeltmezseniz ban süreniz artacaktır.\nBan sürenizin bitmesine kalan süre: ${mins} dakika ${padSecs} saniye.`;
        } else if (detectedLang === 'German') {
          banMsg = `⚠️ Du bist auf der Sperrliste! Wenn du deinen Ton nicht mäßigst, verlängert sich deine Sperre.\nVerbleibende Zeit: ${mins} Minuten ${padSecs} Sekunden.`;
        }

        return {
          isBanned: true,
          message: banMsg
        };
      }
    }

    // 3. User is NOT banned currently. Check if this message contains a DIRECT PERSONAL INSULT:
    const isPersonal = this.isPersonalInsult(messageText);
    if (!isPersonal) {
      // General slang or normal message -> no strike!
      return { isBanned: false };
    }

    // Direct personal insult detected -> Track 3-strike mechanism
    let userStrikeData = this.userStrikes.get(userId);
    if (!userStrikeData || (now - userStrikeData.lastStrikeAt > this.strikeTtlMs)) {
      userStrikeData = { strikes: 0, lastStrikeAt: now };
    }

    userStrikeData.strikes += 1;
    userStrikeData.lastStrikeAt = now;
    this.userStrikes.set(userId, userStrikeData);

    console.log(`⚡ [PERSONAL INSULT DETECTED] ${senderName} (${userId}) -> Strike ${userStrikeData.strikes}/3`);

    // STRIKE 1: Witty sharp rebuttal by the assistant
    if (userStrikeData.strikes === 1) {
      return {
        isBanned: false,
        strike: 1,
        action: 'REBUTTAL',
        isPersonalInsult: true
      };
    }

    // STRIKE 2: Strict final warning
    if (userStrikeData.strikes === 2) {
      let warningMsg = `⚠️ Final warning. If you insult me or ${this.ownerName} one more time, you will be blacklisted and your messages will not be forwarded to ${this.ownerName}.`;
      if (detectedLang === 'Turkish') {
        warningMsg = `⚠️ Son uyarım. Bir kez daha şahsıma veya ${this.ownerName}'a bu üslupla hakaret edersen doğrudan kara listeye alınacaksın ve mesajların ${this.ownerName}'a iletilmeyecek.`;
      } else if (detectedLang === 'German') {
        warningMsg = `⚠️ Letzte Warnung. Wenn du mich oder ${this.ownerName} noch einmal beleidigst, wirst du auf die Sperrliste gesetzt und deine Nachrichten erreichen ${this.ownerName} nicht.`;
      }
      return {
        isBanned: false,
        strike: 2,
        action: 'WARNING',
        isPersonalInsult: true,
        message: warningMsg
      };
    }

    // STRIKE 3: BAN FOR 15 MINUTES!
    const { bannedUntil } = this.banUser(userId, senderName, this.initialBanMinutes);
    const remainingMs = bannedUntil - Date.now();
    const mins = Math.ceil(remainingMs / 60000);

    let banNotice = `⚠️ You have been BLACKLISTED for 15 minutes due to repeated personal insults against ${this.ownerName} or the assistant.\nRemaining ban time: ${mins} minutes 00 seconds.`;
    if (detectedLang === 'Turkish') {
      banNotice = `⚠️ Şahsıma veya ${this.ownerName}'a yönelik tekrarlanan hakaretler sebebiyle 15 dakika KARA LİSTEYE ALINDINIZ!\nTerbiyenizi düzeltmezseniz ban süreniz artacaktır.\nBan sürenizin bitmesine kalan süre: ${mins} dakika 00 saniye.`;
    } else if (detectedLang === 'German') {
      banNotice = `⚠️ Wegen wiederholter persönlicher Beleidigungen wurdest du für 15 Minuten auf die SPERRLISTE gesetzt!\nVerbleibende Sperrzeit: ${mins} Minuten 00 Sekunden.`;
    }

    return {
      isBanned: true,
      justBanned: true,
      message: banNotice
    };
  }
}

module.exports = new BlacklistService();
