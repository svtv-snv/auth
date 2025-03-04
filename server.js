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

    const response = await axios.get('https://id.vk.com/oauth2/user_info', {
        params: {
            client_id: VK_APP_ID,
            access_token: accessToken,
        },
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
    });

    console.log('🌐 Full VK Response:', JSON.stringify(response.data, null, 2));

    if (!response.data || Object.keys(response.data).length === 0) {
        throw new Error('Empty response from VK ID API');
    }

    if (response.data.error) {
        throw new Error(`VK ID API error: ${response.data.error.error_msg || 'Unknown error'}`);
    }

    const user = response.data.user;

    if (!user) {
        throw new Error('Missing user data in VK response');
    }

    const vkId = user.user_id;
    const email = user.email || `${vkId}@vk.com`;
    const displayName = `${user.first_name} ${user.last_name}`;

    console.log('🔔 User from VK:', user);

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

} catch (err) {
    console.error('❌ VK Auth Error:', err.message);
    res.status(500).json({ error: 'Failed to authenticate with VK ID', details: err.message });
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
