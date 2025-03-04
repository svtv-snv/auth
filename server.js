const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const serviceAccount = require('./firebase-adminsdk.json');  // подключи свой Firebase service account
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const VK_APP_ID = process.env.VK_APP_ID;        // 53184888
const VK_CLIENT_SECRET = process.env.VK_CLIENT_SECRET;  // из настроек приложения VKID
const VK_REDIRECT_URI = 'https://svtv.app/auth/vk';   // это 100% должно совпадать с тем, что в VK

if (!VK_APP_ID || !VK_CLIENT_SECRET) {
    console.error('❌ Missing VK_APP_ID or VK_CLIENT_SECRET in env');
    process.exit(1);
}

app.post('/auth/vk', async (req, res) => {
    const { code, deviceId } = req.body;

    if (!code || !deviceId) {
        return res.status(400).json({ error: 'Missing code or deviceId' });
    }

    try {
        console.log('📥 Received vk2 code and deviceId:', { code, deviceId });

        // 1️⃣ Обмен кода на access_token
        const tokenResponse = await axios.post('https://id.vk.com/oauth2/token', new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: VK_APP_ID,
            client_secret: VK_CLIENT_SECRET,
            redirect_uri: VK_REDIRECT_URI,
            code,
            device_id: deviceId
        }).toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });

        console.log('🔑 VK Token Response:', tokenResponse.data);

        const { access_token } = tokenResponse.data;

        if (!access_token) {
            throw new Error('No access token received from VKID');
        }

        // 2️⃣ Получаем user_info с этим токеном
        const userInfoResponse = await axios.get('https://id.vk.com/oauth2/user_info', {
            params: { client_id: VK_APP_ID, access_token },
        });

        console.log('👤 VK User Info Response:', userInfoResponse.data);

        const user = userInfoResponse.data?.user;
        if (!user) {
            throw new Error('Failed to fetch user info from VKID');
        }

        const vkId = user.user_id;
        const email = user.email || `${vkId}@vk.com`;
        const displayName = `${user.first_name} ${user.last_name}`;

        // 3️⃣ Создаём/обновляем пользователя в Firestore
        const uid = `vk_${vkId}`;
        await admin.firestore().collection('users').doc(uid).set({
            created: admin.firestore.FieldValue.serverTimestamp(),
            email,
            displayName,
            socialLink: `https://vk.com/id${vkId}`,
            isVerified: true,
            isAdmin: false,
        }, { merge: true });

        // 4️⃣ Генерация кастомного Firebase токена
        const firebaseToken = await admin.auth().createCustomToken(uid);

        // 5️⃣ Возвращаем токен на фронт
        res.json({ firebaseToken });

    } catch (error) {
        console.error('❌ VK Auth Error:', error.response?.data || error.message);
        res.status(500).json({
            error: 'Failed to authenticate with VK',
            details: error.response?.data || error.message,
        });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 VKID Auth Backend running on port ${PORT}`));
