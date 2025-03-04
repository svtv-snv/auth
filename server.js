const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const serviceAccount = require('./firebase-adminsdk.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const VK_APP_ID = '53184888';
const VK_SECURE_KEY = process.env.VK_SECURE_KEY; // засунь в env
const VK_REDIRECT_URI = 'https://svtv.app/auth/vk';

app.post('/auth/vk', async (req, res) => {
    const { code } = req.body;  // Получаем vk2 code_v2 от фронта

    if (!code) {
        return res.status(400).json({ error: 'Missing authorization code' });
    }

    try {
        // 1. Обмен кода на access_token
        const tokenResponse = await axios.post('https://id.vk.com/oauth2/token', new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: VK_APP_ID,
            client_secret: VK_SECURE_KEY,
            redirect_uri: VK_REDIRECT_URI,
            code: code,
        }).toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });

        const { access_token } = tokenResponse.data;

        if (!access_token) {
            throw new Error('Failed to obtain access token from VK');
        }

        console.log('✅ Got VK access token:', access_token);

        // 2. Получаем user_info
        const userInfoResponse = await axios.get('https://id.vk.com/oauth2/user_info', {
            params: { client_id: VK_APP_ID, access_token },
        });

        const user = userInfoResponse.data?.user;

        if (!user) {
            throw new Error('Failed to fetch user info');
        }

        const vkId = user.user_id;
        const email = user.email || `${vkId}@vk.com`;
        const displayName = `${user.first_name} ${user.last_name}`;

        console.log('👤 VK User:', user);

        const uid = `vk_${vkId}`;
        await admin.firestore().collection('users').doc(uid).set({
            created: admin.firestore.FieldValue.serverTimestamp(),
            email,
            displayName,
            socialLink: `https://vk.com/id${vkId}`,
            isVerified: true,
            isAdmin: false,
        }, { merge: true });

        const firebaseToken = await admin.auth().createCustomToken(uid);
        res.json({ firebaseToken });

    } catch (error) {
        console.error('❌ VK Auth Error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to authenticate with VK', details: error.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
