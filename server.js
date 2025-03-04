const express = require('express');
const admin = require('firebase-admin');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const serviceAccount = require('./firebase-adminsdk.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;  // возьми в @BotFather

if (!TELEGRAM_BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN is missing');
  process.exit(1);
}

// Проверка подписи (Telegram Login Authorization Check)
function verifyTelegramLogin(data) {
  const checkString = Object.keys(data)
    .filter(key => key !== 'hash')
    .sort()
    .map(key => `${key}=${data[key]}`)
    .join('\n');

  const secretKey = crypto.createHash('sha256').update(TELEGRAM_BOT_TOKEN).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');

  return hash === data.hash;
}

app.post('/auth/telegram', async (req, res) => {
  const user = req.body;

  console.log('📥 Received Telegram user:', user);

  if (!verifyTelegramLogin(user)) {
    return res.status(403).json({ error: 'Invalid Telegram login data' });
  }

  const telegramId = user.id;
  const uid = `tg_${telegramId}`;

  const displayName = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();

  await admin.firestore().collection('users').doc(uid).set({
    created: admin.firestore.FieldValue.serverTimestamp(),
    nickname: displayName,
    username: user.username ?? '',
    isVerified: true,
    isAdmin: false,
    socialLink: `https://t.me/${user.username ?? telegramId}`,
  }, { merge: true });

  const firebaseToken = await admin.auth().createCustomToken(uid);

  res.json({ firebaseToken });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Telegram Auth Backend running on port ${PORT}`));
