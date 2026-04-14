require('dotenv').config();
const path = require('path');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

// Konfigurasi dari .env
const token = (process.env.BOT_TOKEN || '').trim();
const ownerId = (process.env.OWNER_ID || '').trim();
const groupId = (process.env.GROUP_ID || '').trim();

if (!token) {
    console.error('CRITICAL: BOT_TOKEN is missing in .env!');
    process.exit(1);
}

// Inisialisasi Bot dengan polling dimatikan sementara untuk mendaftarkan error handler
const bot = new TelegramBot(token, { polling: false });

// Tangani semua jenis error secara senyap agar terminal tetap bersih
bot.on("polling_error", () => {});
bot.on("webhook_error", () => {});
bot.on("error", () => {});

// Mulai polling secara eksplisit
bot.startPolling();

// Tangani error proses global agar tidak ada dump log di terminal
process.on('unhandledRejection', () => {});
process.on('uncaughtException', () => {});

// Status Bot (On/Off)
let isBotEnabled = true;

// Status Sesi Spin Aktif (On/Off)
let isSessionActive = false;

// Map untuk menyimpan pertanyaan matematika yang tertunda (messageId => { userId, answer, prize })
const pendingQuestions = new Map();

// Inisialisasi Express
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// API untuk mendapatkan status bot
app.get('/api/status', (req, res) => {
    res.json({ enabled: isBotEnabled });
});

// API untuk mengubah status bot
app.post('/api/toggle', (req, res) => {
    isBotEnabled = !isBotEnabled;
    res.json({ enabled: isBotEnabled });
});

// Jalankan server
app.listen(PORT, () => {
});


/**
 * Fungsi untuk memproses hasil spin dan mengirim pesan jika jackpot
 * @param {object} msg - Objek pesan dari Telegram
 * @param {number} diceValue - Nilai dari dice.value (1-64 untuk 🎰)
 */
async function processSpinResult(msg, diceValue) {
    const chatId = msg.chat.id;
    const user = msg.from;
    const username = user.username ? `@${user.username}` : user.first_name;


    // Logika Jackpot: untuk emoji 🎰, 777 (Jackpot) bernilai 64
    if (diceValue === 64) {
        // Kirim pesan ke grup
        let winMsg = `🎉 ${username} MENANG JACKPOT 777!!!`;
        if (msg.prize) winMsg += `\n🎁 Hadiah: ${msg.prize}`;
        
        await bot.sendMessage(chatId, winMsg, {
            reply_to_message_id: msg.message_id
        });

        // Kirim pesan pribadi ke Owner (jika ownerId ada)
        if (ownerId) {
            try {
                const winnerInfo = `🎰 JACKPOT DETECTED!\n\nPemenang: ${username}\nID: ${user.id}\nNama: ${user.first_name} ${user.last_name || ''}\nGroup: ${msg.chat.title || 'Grup'}\n🎁 Hadiah: ${msg.prize || '-'}`;
                await bot.sendMessage(ownerId, winnerInfo);
            } catch (err) {
                // Biasanya ini terjadi jika Owner belum memulai chat dengan bot
            }
        }
    } else {
        // Pesan kalah ringan (opsional, sesuai permintaan)
        // bot.sendMessage(chatId, `Coba lagi ${username}!`);
    }
}

/**
 * Fungsi untuk mengeksekusi spin gacha
 */
async function executeSpin(chatId, user, prize, replyToMessageId) {
    try {
        const targetChatId = groupId || chatId;

        // Kirim dice
        const diceMsg = await bot.sendDice(targetChatId, {
            emoji: '🎰'
        });

        // Kirim teks keterangan di bawahnya
        const username = user.username ? `@${user.username}` : user.first_name;
        const spinText = prize ? `${username} SPINED [${prize}]` : `${username} SPINED`;
        const spinResultMsg = await bot.sendMessage(targetChatId, spinText, {
            reply_markup: {
                inline_keyboard: [[
                    { text: "Spin Lagi", callback_data: prize ? `spin_action:${prize}` : `spin_action` }
                ]]
            }
        });

        // Buat objek msg buatan untuk processSpinResult
        const pseudoMsg = {
            chat: { id: targetChatId },
            from: user,
            message_id: spinResultMsg.message_id,
            prize: prize
        };

        // Proses hasil jackpotnya
        await processSpinResult(pseudoMsg, diceMsg.dice.value);

    } catch (error) {
    }
}

async function handleSpin(msg) {
    const chatId = msg.chat.id;
    const user = msg.from;
    const userId = user.id;
    const prize = msg.prize || ''; // Ambil prize dari objek pesan

    // Cek status On/Off
    if (!isBotEnabled || !isSessionActive) return;


    try {
        // Generate Math Question
        const n1 = Math.floor(Math.random() * 10) + 1;
        const n2 = Math.floor(Math.random() * 10) + 1;
        const answer = n1 + n2;
        const mention = `[${user.first_name}](tg://user?id=${userId})`;
        let questionText = `${mention} sebelum melakukan spin harap reply pesan ini dan jawab soal ini ${n1} + ${n2} =`;
        if (prize) questionText = `${mention} (Prize: ${prize}) sebelum melakukan spin harap reply pesan ini dan jawab soal ini ${n1} + ${n2} =`;

        const questionMsg = await bot.sendMessage(chatId, questionText, {
            reply_to_message_id: msg.message_id,
            parse_mode: 'Markdown',
            reply_markup: { 
                force_reply: true, 
                selective: true 
            }
        });

        // Simpan ke pendingQuestions (format key: chatId:messageId)
        pendingQuestions.set(`${chatId}:${questionMsg.message_id}`, {
            userId: userId,
            answer: answer,
            prize: prize
        });


    } catch (error) {
    }
}

// --- Handler Pesan ---

/**
 * Handler pesan (Tombol /slot & deteksi teks)
 */
bot.on('message', async (msg) => {
    if (!isBotEnabled) return;

    const text = msg.text || '';
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // --- LOGIKA VERIFIKASI CAPTCHA ---
    if (msg.reply_to_message) {
        const questionKey = `${chatId}:${msg.reply_to_message.message_id}`;
        const pending = pendingQuestions.get(questionKey);

        if (pending) {
            // Verifikasi User yang berhak menjawab
            if (pending.userId !== userId) return;

            // Verifikasi Jawaban
            if (text.trim() === pending.answer.toString()) {
                // Jawaban Benar!
                pendingQuestions.delete(questionKey);
                
                // Hapus pesan soal dan jawaban (agar grup bersih)
                try {
                    await bot.deleteMessage(chatId, msg.reply_to_message.message_id);
                    await bot.deleteMessage(chatId, msg.message_id);
                } catch (err) {
                    // Abaikan jika gagal (misal: bukan admin atau pesan sudah dihapus)
                }


                // Jalankan Spin!
                return executeSpin(chatId, msg.from, pending.prize, msg.message_id);
            } else {
                // Jawaban Salah
                return;
            }
        }
    }
    // --- AKHIR LOGIKA VERIFIKASI ---

    // Abaikan dice manual
    if (msg.dice && msg.dice.emoji === '🎰') return;

    // Handle command /spin
    if (text.startsWith('/spin')) {
        // Cek owner (Hanya owner yang bisa memulai session /spin)
        if (ownerId && msg.from.id.toString() !== ownerId.toString()) {
            return;
        }

        // Ambil argumen prize jika ada
        const args = text.split(' ');
        let prize = '';
        if (args.length > 1) {
            prize = args.slice(1).join(' ');
        }

        // Aktifkan sesi spin
        isSessionActive = true;

        // Jalankan Spin pertama (Dice + Tombol) secara langsung
        executeSpin(chatId, msg.from, prize);
    }
    // Handle teks "SPIN 🎰"
    else if (text.includes('SPIN 🎰')) {
        // Cek owner
        if (ownerId && msg.from.id.toString() !== ownerId.toString()) {
            return;
        }
        handleSpin(msg);
    }
    // Handle command /endspin
    else if (text.startsWith('/endspin')) {
        // Cek owner
        if (ownerId && msg.from.id.toString() !== ownerId.toString()) {
            return;
        }

        // Matikan sesi secara global
        isSessionActive = false;

        if (msg.reply_to_message) {
            try {
                // Hapus pesan yang dibalas (pesan spin yang ada tombolnya)
                await bot.deleteMessage(chatId, msg.reply_to_message.message_id);
                // Hapus perintah /endspin itu sendiri agar bersih
                await bot.deleteMessage(chatId, msg.message_id);
            } catch (err) {
            }
        } else {
            bot.sendMessage(chatId, "🛑 *SESI SPIN TELAH DIAKHIRI*", { 
                parse_mode: 'Markdown',
                reply_to_message_id: msg.message_id 
            });
        }
    }
});

// Handle teks "SPIN 🎰" (jika user mengetik manual atau dari keyboard button)
// Handle Callback Query (dari tombol inline)
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const user = callbackQuery.from;

    const customMsg = {
        ...msg,
        from: user
    };

    const data = callbackQuery.data;

    if (data.startsWith('spin_action')) {
        // Cek owner dihapus agar semua orang bisa klik button

        if (!isSessionActive) {
            return bot.answerCallbackQuery(callbackQuery.id, { text: 'Sesi spin telah berakhir!', show_alert: true });
        }

        if (!isBotEnabled) {
            return bot.answerCallbackQuery(callbackQuery.id, { text: 'Bot sedang nonaktif!', show_alert: true });
        }

        // Ambil prize dari callback data jika ada (format: spin_action:prize)
        const prizeAttr = data.split(':')[1] || '';
        if (prizeAttr) customMsg.prize = prizeAttr;

        try {
            await bot.answerCallbackQuery(callbackQuery.id);
        } catch (error) {
        }

        await handleSpin(customMsg);
    }
});



// --- Selesai ---

