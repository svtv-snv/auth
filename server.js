const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');
const cors = require('cors');

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
  const { accessToken } = req.body;  // Получаем access_token от фронта

  if (!accessToken) {
    return res.status(400).json({ error: 'Missing access token' });
  }

  try {
    console.log('📥 Received VK accessToken:', accessToken);

    // 1. Проверка access_token через VK API для получения информации о пользователе
    const response = await axios.get('https://api.vk.com/method/users.get', {
      params: {
        access_token: accessToken,
        v: '5.131',  // Используем актуальную версию VK API
        fields: 'id,email,first_name,last_name',  // Запрашиваем ID и другие данные
      },
    });

    if (response.data.error) {
      throw new Error(`VK API error: ${response.data.error.error_msg}`);
    }

    const user = response.data.response[0]; // Получаем данные о пользователе
    const vkId = user.id;  // Используем ID пользователя из VK
    const email = user.email || `${vkId}@vk.com`;  // Если email не пришел, создаем его
    const displayName = `${user.first_name} ${user.last_name}`;  // Имя пользователя

    console.log('🔔 User from VK:', user);

    // 2. Создание кастомного UID в Firebase с использованием ID пользователя VK
    const uid = `vk_${vkId}`;  // UID для Firebase на основе ID пользователя VK

    // Сохраняем пользователя в Firestore
    const userDoc = admin.firestore().collection('users').doc(uid);
    await userDoc.set({
      created: admin.firestore.FieldValue.serverTimestamp(),
      email: email,
      displayName: displayName,
      socialLink: `https://vk.com/id${vkId}`,
      isVerified: true,
      isAdmin: false,
    }, { merge: true });

    // Генерация кастомного токена Firebase
    const firebaseToken = await admin.auth().createCustomToken(uid);  // Генерация кастомного токена

    // Отправляем токен на фронт
    res.json({ firebaseToken });

  } catch (err) {
    console.error('❌ VK Auth Error:', err);
    res.status(500).json({
      error: 'Failed to authenticate with VK ID',
      details: err.message,
    });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
