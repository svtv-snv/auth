const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const serviceAccount = require('./firebase-adminsdk.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const VK_APP_ID = process.env.VK_APP_ID;
const VK_CLIENT_SECRET = process.env.VK_CLIENT_SECRET;
const VK_REDIRECT_URI = 'https://svtv.app/auth/vk';

if (!VK_APP_ID || !VK_CLIENT_SECRET) {
    console.error('❌ Missing VK_APP_ID or VK_CLIENT_SECRET in env');
    process.exit(1);
}

app.post('/auth/vk', async (req, res) => {
    const { code, deviceId } = req.body;

    console.log('📥 Incoming request body:', req.body);

    if (!code || !deviceId) {
        return res.status(400).json({ error: 'Missing code or deviceId' });
    }

    try {
        console.log('📥 Received vk2 code and deviceId:', { code, deviceId });

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
        if (!access_token) throw new Error('No access token received from VKID');

        const userInfoResponse = await axios.get('https://id.vk.com/oauth2/user_info', {
            params: { client_id: VK_APP_ID, access_token },
        });

        console.log('👤 VK User Info Response:', userInfoResponse.data);

        const user = userInfoResponse.data?.user;
        if (!user) throw new Error('Failed to fetch user info from VKID');

        const vkId = user.user_id;
        const email = user.email || `${vkId}@vk.com`;
        const displayName = `${user.first_name} ${user.last_name}`;

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
        res.status(500).json({
            error: 'Failed to authenticate with VK',
            details: error.response?.data || error.message,
        });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 VKID Auth Backend is ready at port ${PORT}`);
});
