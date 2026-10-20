/**
 * patch-wwebjs.js
 * Automatically patches known bugs in whatsapp-web.js:
 * 1. Puppeteer exposeFunction collision fix
 * 2. Message.js downloadMedia fallback for @lid / unrendered media
 * 3. Utils.js memoize getter bug fix (delete message.__x_id)
 * 4. Client.js hasSynced race condition and isNewMsg live addition fixes
 */

const fs = require('fs');
const path = require('path');

// 1. Puppeteer.js exposeFunction patch
const pupTarget = path.join(__dirname, 'node_modules/whatsapp-web.js/src/util/Puppeteer.js');
if (fs.existsSync(pupTarget)) {
  let content = fs.readFileSync(pupTarget, 'utf8');
  if (!content.includes("already exists")) {
    content = content.replace(
      'await page.exposeFunction(name, fn);',
      'try { await page.exposeFunction(name, fn); } catch (e) { if (!e.message.includes("already exists")) throw e; }'
    );
    fs.writeFileSync(pupTarget, content, 'utf8');
    console.log('✅ Applied whatsapp-web.js Puppeteer binding patch.');
  }
}

// 2. Message.js downloadMedia @lid / polling / decryption patch
const msgTarget = path.join(__dirname, 'node_modules/whatsapp-web.js/src/structures/Message.js');
if (fs.existsSync(msgTarget)) {
  let content = fs.readFileSync(msgTarget, 'utf8');
  if (!content.includes('Message model not found')) {
    const oldRegex = /const result = await this\.client\.pupPage\.evaluate\(async \(msgId[\s\S]*?return new MessageMedia\([\s\S]*?result\.filesize,?\s*\);/m;

    const replacement = `const result = await this.client.pupPage.evaluate(async (msgId, rawId, chatId) => {
            try {
                const targetStanzaId = (rawId && typeof rawId === 'object' && rawId.id) ? rawId.id : (typeof rawId === 'string' ? rawId : null);
                let rawMsg = null;

                // 1. Direct Msg.get
                try {
                    rawMsg = window.require('WAWebCollections').Msg.get(msgId);
                } catch (_) {}

                // 2. Search WAWebCollections.Msg via getModelsArray()
                if (!rawMsg) {
                    try {
                        const msgColl = window.require('WAWebCollections').Msg;
                        const allMsgs = typeof msgColl.getModelsArray === 'function' ? msgColl.getModelsArray() : (msgColl._models || msgColl.models || []);
                        rawMsg = allMsgs.find(m => {
                            if (!m || !m.id) return false;
                            if (m.id._serialized === msgId) return true;
                            if (targetStanzaId && m.id.id === targetStanzaId) return true;
                            return false;
                        });
                    } catch (_) {}
                }

                // 3. Search Chat collection via getModelsArray()
                if (!rawMsg) {
                    try {
                        const chatColl = window.require('WAWebCollections').Chat;
                        const chats = typeof chatColl.getModelsArray === 'function' ? chatColl.getModelsArray() : (chatColl._models || chatColl.models || []);
                        
                        const sortedChats = chatId 
                            ? [...chats.filter(c => c && c.id && (c.id._serialized === chatId || (targetStanzaId && c.id.user === chatId.split('@')[0]))), ...chats] 
                            : chats;

                        for (const c of sortedChats) {
                            if (!c || !c.msgs) continue;
                            const msgs = typeof c.msgs.getModelsArray === 'function' ? c.msgs.getModelsArray() : (c.msgs._models || c.msgs.models || []);
                            const found = msgs.find(m => {
                                if (!m || !m.id) return false;
                                if (m.id._serialized === msgId) return true;
                                if (targetStanzaId && m.id.id === targetStanzaId) return true;
                                return false;
                            });
                            if (found) {
                                rawMsg = found;
                                break;
                            }
                        }
                    } catch (_) {}
                }

                // 4. Try WAWebCollections.Msg.getMessagesById
                if (!rawMsg) {
                    try {
                        const res = await window.require('WAWebCollections').Msg.getMessagesById([msgId]);
                        if (res && res.messages && res.messages[0]) {
                            rawMsg = res.messages[0];
                        }
                    } catch (_) {}
                }

                // 5. Try resolving chat by WID and checking lastReceivedKey
                if (!rawMsg && chatId) {
                    try {
                        const WidFactory = window.require('WAWebWidFactory');
                        const wid = WidFactory ? WidFactory.createWid(chatId) : null;
                        const chat = wid ? window.require('WAWebCollections').Chat.get(wid) : null;
                        if (chat && chat.lastReceivedKey) {
                            rawMsg = window.require('WAWebCollections').Msg.get(chat.lastReceivedKey._serialized) ||
                                     window.require('WAWebCollections').Msg.get(chat.lastReceivedKey);
                        }
                    } catch (_) {}
                }

                if (!rawMsg) {
                    return { error: 'Message model not found in collections for ' + msgId };
                }

                const msgModel = window.WWebJS.getMessageModel(rawMsg);
                const mediaData = rawMsg.mediaData || rawMsg;

                let decryptedMedia = null;

                // A. Check if already decrypted/cached as renderableUrl
                const existingUrl = mediaData.renderableUrl || rawMsg.renderableUrl || (msgModel && msgModel.renderableUrl);
                if (existingUrl) {
                    try {
                        const resp = await fetch(existingUrl);
                        if (resp.ok) {
                            decryptedMedia = await resp.arrayBuffer();
                        }
                    } catch (_) {}
                }

                // B. Check if already has _blob
                if (!decryptedMedia) {
                    const blobObj = mediaData._blob || rawMsg._blob;
                    if (blobObj && typeof blobObj.arrayBuffer === 'function') {
                        try {
                            decryptedMedia = await blobObj.arrayBuffer();
                        } catch (_) {}
                    }
                }

                // C. If mediaStage is not RESOLVED, trigger downloadMedia and wait
                if (!decryptedMedia && mediaData.mediaStage !== 'RESOLVED' && typeof rawMsg.downloadMedia === 'function') {
                    try {
                        await rawMsg.downloadMedia({
                            downloadEvenIfExpensive: true,
                            rmrReason: 1,
                        });
                    } catch (_) {}

                    for (let i = 0; i < 25; i++) {
                        const url = mediaData.renderableUrl || rawMsg.renderableUrl;
                        if (url) {
                            try {
                                const resp = await fetch(url);
                                if (resp.ok) {
                                    decryptedMedia = await resp.arrayBuffer();
                                    break;
                                }
                            } catch (_) {}
                        }
                        const b = mediaData._blob || rawMsg._blob;
                        if (b && typeof b.arrayBuffer === 'function') {
                            try {
                                decryptedMedia = await b.arrayBuffer();
                                break;
                            } catch (_) {}
                        }
                        await new Promise(r => setTimeout(r, 200));
                    }
                }

                // D. Try downloadManager.downloadAndMaybeDecrypt directly
                if (!decryptedMedia) {
                    const mockQpl = {
                        addAnnotations: function () { return this; },
                        addPoint: function () { return this; },
                        markerStart: function () { return this; },
                        markerEnd: function () { return this; },
                    };

                    const directPath = rawMsg.directPath || mediaData.directPath || (msgModel && msgModel.directPath);
                    const encFilehash = rawMsg.encFilehash || mediaData.encFilehash || (msgModel && msgModel.encFilehash);
                    const filehash = rawMsg.filehash || mediaData.filehash || (msgModel && msgModel.filehash);
                    const mediaKey = rawMsg.mediaKey || mediaData.mediaKey || (msgModel && msgModel.mediaKey);
                    const mediaKeyTimestamp = rawMsg.mediaKeyTimestamp || mediaData.mediaKeyTimestamp || (msgModel && msgModel.mediaKeyTimestamp);
                    const type = rawMsg.type || mediaData.type || (msgModel && msgModel.type);

                    if (directPath && filehash && mediaKey) {
                        try {
                            decryptedMedia = await window
                                .require('WAWebDownloadManager')
                                .downloadManager.downloadAndMaybeDecrypt({
                                    directPath,
                                    encFilehash,
                                    filehash,
                                    mediaKey,
                                    mediaKeyTimestamp,
                                    type,
                                    signal: new AbortController().signal,
                                    downloadQpl: mockQpl,
                                });
                        } catch (dmErr) {
                            console.warn('downloadAndMaybeDecrypt error:', dmErr);
                        }
                    }
                }

                if (!decryptedMedia) {
                    return { error: 'Media data could not be decrypted (stage=' + mediaData.mediaStage + ')' };
                }

                const data = await window.WWebJS.arrayBufferToBase64Async(decryptedMedia);
                return {
                    data,
                    mimetype: rawMsg.mimetype || mediaData.mimetype || (msgModel && msgModel.mimetype) || 'audio/ogg',
                    filename: rawMsg.filename || mediaData.filename || (msgModel && msgModel.filename),
                    filesize: rawMsg.size || mediaData.size || (msgModel && msgModel.size),
                };
            } catch (e) {
                if (e.status && e.status === 404) return undefined;
                return { error: e.message || String(e) };
            }
        }, this.id._serialized, this.id, this.from || this.to);

        if (!result) return undefined;
        if (result.error) {
            console.warn(\`⚠️ [WWebJS Media Download]: \${result.error}\`);
            return undefined;
        }
        return new MessageMedia(
            result.mimetype,
            result.data,
            result.filename,
            result.filesize,
        );`;

    if (oldRegex.test(content)) {
      content = content.replace(oldRegex, replacement);
      fs.writeFileSync(msgTarget, content, 'utf8');
      console.log('✅ Applied whatsapp-web.js Message.js downloadMedia patch.');
    }
  }
}

// 3. Utils.js media memoize getter bug patch (delete message.__x_id)
const utilsTarget = path.join(__dirname, 'node_modules/whatsapp-web.js/src/util/Injected/Utils.js');
if (fs.existsSync(utilsTarget)) {
  let content = fs.readFileSync(utilsTarget, 'utf8');
  if (!content.includes('delete message.__x_id;')) {
    content = content.replace(
      '        const message = {',
      '        // patched\n        const message = {'
    );
    content = content.replace(
      /(\.\.\.extraOptions,\s*\n\s*\};)/,
      '$1\n\n        delete message.__x_id;\n        if (!message.id) {\n            message.id = newMsgKey;\n        }'
    );
    fs.writeFileSync(utilsTarget, content, 'utf8');
    console.log('✅ Applied whatsapp-web.js Utils.js media memoize patch.');
  }
}

// 4. Client.js hasSynced race condition patch (ready event hang fix)
const clientTarget = path.join(__dirname, 'node_modules/whatsapp-web.js/src/Client.js');
if (fs.existsSync(clientTarget)) {
  let content = fs.readFileSync(clientTarget, 'utf8');
  if (!content.includes('socket && socket.hasSynced')) {
    content = content.replace(
      /window\s*\.require\('WAWebSocketModel'\)\s*\.Socket\.on\('change:hasSynced',\s*\(\)\s*=>\s*\{[\s\S]*?\}\);/m,
      `const socket = window.require('WAWebSocketModel').Socket;
            if (socket && socket.hasSynced) {
                window.onAppStateHasSyncedEvent();
            } else if (socket) {
                socket.on('change:hasSynced', () => {
                    window.onAppStateHasSyncedEvent();
                });
            }`
    );
    if (content.includes('if (!msg.isNewMsg) return;')) {
      content = content.replace("if (!msg.isNewMsg) return;", "// patched: accept all live additions");
    }
    fs.writeFileSync(clientTarget, content, 'utf8');
    console.log('✅ Applied whatsapp-web.js Client.js hasSynced & isNewMsg patches.');
  }
}
