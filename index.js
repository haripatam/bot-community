require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');

const { getEventsByDate, getCurrentDateStr } = require('../sheetCache');
const { getSession, updateSession, incrementMessageCheck } = require('../memory');

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Using WA v${version.join('.')} (isLatest: ${isLatest})`);

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '20.0.04']
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr && !sock.authState.creds.registered) {
            if (!process.env.WHATSAPP_NUMBER) {
                console.log("\n❌ MISSING WHATSAPP_NUMBER IN .env FILE! Add it to use Pairing Code!");
            } else {
                let phone = process.env.WHATSAPP_NUMBER.replace(/[^0-9]/g, '');
                try {
                    setTimeout(async () => {
                        const code = await sock.requestPairingCode(phone);
                        console.log(`\n=========================================` +
                                    `\n📲 YOUR PAIRING CODE IS: ${code}` +
                                    `\n=========================================` +
                                    `\n1. Open WhatsApp -> Linked Devices -> Link a Device` +
                                    `\n2. Tap "Link with phone number instead"\n`);
                    }, 2000);
                } catch(e) { 
                    console.error("Pairing Error:", e.message || e) 
                }
            }
        }
        
        if (connection === 'close') {
            const errorReason = lastDisconnect.error?.output?.payload?.error || lastDisconnect.error?.message;
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`Connection closed. [Reason: ${errorReason}] Reconnecting...`, shouldReconnect);
            if(shouldReconnect) {
                setTimeout(connectToWhatsApp, 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ Rigid Emoji Bot is fully connected via Baileys!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if(!msg.message || msg.key.fromMe) return;

        const senderId = msg.key.remoteJid;
        const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (textMessage) {
            const cleanText = textMessage.trim().toLowerCase();
            
            // EASTER EGG: MIMS
            if (cleanText.includes('mims')) {
                const mimsResponses = require('../mims');
                const replyText = mimsResponses[Math.floor(Math.random() * mimsResponses.length)];
                try {
                    await sock.sendPresenceUpdate('composing', senderId);
                    const typingTimeMs = Math.min(3000, Math.max(1000, replyText.length * 10));
                    await new Promise(res => setTimeout(res, typingTimeMs));
                    await sock.sendPresenceUpdate('paused', senderId);
                    await sock.sendMessage(senderId, { text: replyText });
                } catch (err) {
                    console.error("Failed sending mims message:", err);
                }
                return;
            }
            
            // 1) Enforce Interactive Session Limits
            if (incrementMessageCheck(senderId)) {
                await sock.sendPresenceUpdate('composing', senderId);
                await new Promise(r => setTimeout(r, 1500));
                await sock.sendMessage(senderId, { text: "Session timer reset! 🔴\nSend another date (DD-MM-YYYY) or say 'Hi' to start over." });
                return;
            }

            const session = getSession(senderId);
            let replyText = "";

            // 2) User asks for details of a serial number
            if (/^\d+$/.test(cleanText) && session.activeEvents.length > 0) {
                const idx = parseInt(cleanText) - 1;
                if (idx >= 0 && idx < session.activeEvents.length) {
                    const e = session.activeEvents[idx];
                    replyText = `*${e.Name}*`;
                    if (e.Time) replyText += `\n🕒 ${e.Time}`;
                    if (e.Location) replyText += `\n📍 ${e.Location}`;
                    if (e.Description) replyText += `\n📝 ${e.Description}`;
                } else {
                    replyText = `🟢 Reply with valid number (1–${session.activeEvents.length}) or enter another date DD-MM-YYYY format`;
                }
            } 
            // 3) User asks for specific date
            else {
                let targetDate = getCurrentDateStr();
                if (/^\d{2}-\d{2}-\d{4}$/.test(cleanText)) {
                    targetDate = cleanText;
                }

                let dateLabel = "";
                const todayStr = getCurrentDateStr();
                
                const tmrwD = new Date();
                tmrwD.setDate(tmrwD.getDate() + 1);
                const tomorrowStr = `${String(tmrwD.getDate()).padStart(2, '0')}-${String(tmrwD.getMonth() + 1).padStart(2, '0')}-${tmrwD.getFullYear()}`;
                
                if (targetDate === todayStr) dateLabel = " — *Today*";
                else if (targetDate === tomorrowStr) dateLabel = " — *Tomorrow*";

                const events = getEventsByDate(targetDate);
                
                if (events.length === 0) {
                    replyText = `EVENTS — ${targetDate}${dateLabel}\n\nNo events strictly specified for this date!\n\n🔴 Send another date (DD-MM-YYYY)`;
                    updateSession(senderId, []);
                } else {
                    replyText = `EVENTS — ${targetDate}${dateLabel}\n\n`;
                    events.forEach((e, i) => {
                        replyText += `${i + 1}. *${e.Name}*${e.Time ? ` — ${e.Time}` : ''}\n`;
                    });
                    replyText += `\n🟢 Reply with number (1–${events.length})\n🔴 Send another date (DD-MM-YYYY)`;
                    updateSession(senderId, events);
                }
            }

            try {
                await sock.sendPresenceUpdate('composing', senderId);
                const typingTimeMs = Math.min(3000, Math.max(1000, replyText.length * 10));
                await new Promise(res => setTimeout(res, typingTimeMs));
                await sock.sendPresenceUpdate('paused', senderId);
                await sock.sendMessage(senderId, { text: replyText });
            } catch (err) {
                console.error("Failed sending message:", err);
            }
        }
    });
}

connectToWhatsApp();