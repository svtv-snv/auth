const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');
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
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Missing code' });
  }

  try {
    // Лог входящих данных
    console.log('📥 Received VK code:', code);

    // Лог параметров перед запросом
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: VK_APP_ID,
      client_secret: VK_SECURE_KEY,
      redirect_uri: VK_REDIRECT_URI,
      code: code,
    });

    console.log('🔍 VK Exchange Params:', {
      grant_type: 'authorization_code',
      client_id: VK_APP_ID,
      client_secret: '***',  // Не логируем секрет в проде
      redirect_uri: VK_REDIRECT_URI,
      code,
    });

    // Обмен кода на токен
    const tokenResponse = await axios.post('https://oauth.vk.com/access_token', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    console.log('✅ VK Token Response:', tokenResponse.data);

    const { access_token, id_token, user_id } = tokenResponse.data;

    if (!id_token) {
      return res.status(400).json({ error: 'id_token missing in response, check your VK app settings (scope openid)' });
    }

    // Раскодируем id_token
    const payload = jwt.decode(id_token);

    if (!payload || !payload.sub) {
      return res.status(400).json({ error: 'Invalid ID Token' });
    }

    console.log('🔔 Decoded VK ID Token Payload:', payload);

    const vkId = payload.sub;
    const uid = `vk_${vkId}`;

    // Сохраняем в Firestore
    const userDoc = admin.firestore().collection('users').doc(uid);
    await userDoc.set({
      created: admin.firestore.FieldValue.serverTimestamp(),
      email: payload.email || `${vkId}@vk.com`,
      nickname: `${payload.given_name || ''} ${payload.family_name || ''}`.trim(),
      socialLink: `https://vk.com/id${user_id}`,
      isVerified: true,
      isAdmin: false,
    }, { merge: true });

    // Генерируем кастомный токен Firebase
    const firebaseToken = await admin.auth().createCustomToken(uid, { provider: 'vk' });

    res.json({ firebaseToken });

  } catch (err) {
    console.error('❌ VK Auth Error:', err.response?.data || err.message);

    if (err.response) {
      console.error('📥 VK Error Response:', err.response.data);
    }

    res.status(500).json({
      error: 'Failed to authenticate with VK ID',
      details: err.response?.data || err.message,
    });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
