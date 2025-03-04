const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Firebase Admin SDK
const serviceAccount = require('./firebase-adminsdk.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

// Environment variables
const VK_APP_ID = process.env.VK_APP_ID;
const VK_SECURE_KEY = process.env.VK_SECURE_KEY;
const VK_REDIRECT_URI = process.env.VK_REDIRECT_URI;

// Endpoint to handle VK ID login
app.post('/auth/vk', async (req, res) => {
  const { code } = req.body;
  console.log('📥 Received code:', code);

  if (!code) {
    return res.status(400).send({ error: 'Missing code' });
  }

  try {
    // Exchange code for tokens
    const tokenResponse = await axios.post('https://id.vk.com/access_token', new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: VK_APP_ID,
      client_secret: VK_SECURE_KEY,
      redirect_uri: VK_REDIRECT_URI,
    }).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    console.log('🔔 VK token response:', tokenResponse.data);

    const { id_token } = tokenResponse.data;

    if (!id_token) {
      return res.status(400).send({ error: 'Failed to exchange code for tokens' });
    }

    // Decode the ID token
    const payload = jwt.decode(id_token);
    console.log('🔔 Decoded payload:', payload);

    const vkId = payload.sub;
    const uid = `vk_${vkId}`;

    // Save user to Firestore
    const userDoc = admin.firestore().collection('users').doc(uid);
    await userDoc.set({
      created: admin.firestore.FieldValue.serverTimestamp(),
      email: payload.email || `${vkId}@vk.com`,
      nickname: `${payload.given_name || ''} ${payload.family_name || ''}`.trim(),
      socialLink: `https://vk.com/id${vkId}`,
      isVerified: true,
      isAdmin: false,
    }, { merge: true });

    // Create Firebase custom token
    const firebaseToken = await admin.auth().createCustomToken(uid, { provider: 'vk' });
    res.json({ firebaseToken });
  } catch (err) {
    console.error('❌ Error:', err.message);
    res.status(500).send({ error: 'Failed to authenticate with VK ID' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
