require('dotenv').config();
console.log('BOT_TOKEN exists:', !!process.env.BOT_TOKEN);
console.log('Keys found:', Object.keys(process.env).filter(k => k.includes('BOT')));
