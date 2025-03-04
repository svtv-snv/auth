const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

const serviceAccount = require('./firebase-adminsdk.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const VK_APP_ID = process.env.VK_APP_ID;
const VK_SECURE_KEY = process.env.VK_SECURE_KEY;
const VK_REDIRECT_URI = process.env.VK_REDIRECT_URI || 'https://svtv.app/auth/vk';

if (!VK_APP_ID || !VK_SECURE_KEY || !VK_REDIRECT_URI) {
  console.error('❌ Missing required VK environment variables');
  process.exit(1);
}

app.post('/auth/vk', async (req, res) => {
  const { accessToken } = req.body;

  if (!accessToken) {
    return res.status(400).json({ error: 'Missing access token' });
  }

  try {
    // Лог входящих данных
    console.log('📥 Received VK accessToken:', accessToken);

    // Используем Firebase для проверки id_token (или access_token)
    const decodedToken = await admin.auth().verifyIdToken(accessToken);
    const uid = decodedToken.uid;

    console.log('🔔 Decoded VK Token Payload:', decodedToken);

    // Сохраняем в Firestore
    const userDoc = admin.firestore().collection('users').doc(uid);
    await userDoc.set({
      created: admin.firestore.FieldValue.serverTimestamp(),
      email: decodedToken.email || `${uid}@vk.com`,
      nickname: `${decodedToken.given_name || ''} ${decodedToken.family_name || ''}`.trim(),
      socialLink: `https://vk.com/id${decodedToken.user_id}`,
      isVerified: true,
      isAdmin: false,
    }, { merge: true });

    // Генерация кастомного токена Firebase
    const firebaseToken = await admin.auth().createCustomToken(uid, { provider: 'vk' });

    res.json({ firebaseToken });

  } catch (err) {
    console.error('❌ VK Auth Error:', err.response?.data || err.message);
    res.status(500).json({
      error: 'Failed to authenticate with VK ID',
      details: err.response?.data || err.message,
    });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
