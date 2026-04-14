const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const input = require("input");
require("dotenv").config();

// Ambil dari .env
const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;

if (!apiId || !apiHash) {
    console.error("ERROR: API_ID atau API_HASH belum diisi di .env!");
    process.exit(1);
}

const stringSession = new StringSession(""); // Kosong untuk login baru

(async () => {
    console.log("--- Memulai Proses Login Userbot ---");
    const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
    });

    await client.start({
        phoneNumber: async () => await input.text("Masukkan nomor HP (format internasional: +62...): "),
        password: async () => await input.text("Masukkan password 2FA (jika ada, jika tidak kosongkan): "),
        phoneCode: async () => await input.text("Masukkan kode yang dikirim oleh Telegram: "),
        onError: (err) => console.log("Terjadi kesalahan: ", err),
    });

    console.log("\n✅ Berhasil Terhubung!");
    console.log("-----------------------------------------");
    console.log("SALIN KODE DI BAWAH INI KE .env ANDA (USERBOT_SESSION):");
    console.log("-----------------------------------------");
    console.log(client.session.save()); 
    console.log("-----------------------------------------");
    
    await client.disconnect();
    process.exit(0);
})();
