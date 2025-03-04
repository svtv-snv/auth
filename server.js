const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Firebase Admin SDK
const serviceAccount = require('./firebase-adminsdk.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

// Cache for VK public keys
let vkPublicKeys = null;

// Fetch VK public keys for JWT verification
async function getVKPublicKeys() {
    if (vkPublicKeys) return vkPublicKeys;

    const openidConfig = await axios.get('https://id.vk.com/.well-known/openid-configuration');
    const jwks = await axios.get(openidConfig.data.jwks_uri);
    vkPublicKeys = jwks.data.keys.reduce((map, key) => {
        map[key.kid] = key;
        return map;
    }, {});
    return vkPublicKeys;
}

// Verify the VK ID token
async function verifyIdToken(idToken) {
    const header = JSON.parse(Buffer.from(idToken.split('.')[0], 'base64').toString());
    const keys = await getVKPublicKeys();
    const key = keys[header.kid];
    if (!key) throw new Error('Invalid token (key mismatch)');
    const cert = `-----BEGIN CERTIFICATE-----\n${key.x5c[0]}\n-----END CERTIFICATE-----`;
    return jwt.verify(idToken, cert, { algorithms: ['RS256'], issuer: 'https://id.vk.com' });
}

// VK ID authentication endpoint
app.post('/auth/vk', async (req, res) => {
  const { code } = req.body;
  console.log('📥 Received code:', code);

  if (!code) {
    console.error('❌ Missing code');
    return res.status(400).send({ error: 'Missing code' });
  }

  try {
    // Exchange the code for an id_token and access_token
    const tokenResponse = await axios.post('https://id.vk.com/access_token', new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: process.env.VK_APP_ID,
      client_secret: process.env.VK_SECURE_KEY,
      redirect_uri: process.env.VK_REDIRECT_URI,
    }).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    console.log('🔔 VK token response:', tokenResponse.data);

    const { access_token, id_token } = tokenResponse.data;

    if (!access_token || !id_token) {
      console.error('❌ Failed to exchange code for tokens');
      return res.status(400).send({ error: 'Failed to exchange code for tokens' });
    }

    // Verify the ID token
    const payload = await verifyIdToken(id_token);
    console.log('🔔 Decoded payload:', payload);

    const vkId = payload.sub;
    const uid = `vk_${vkId}`;

    // Save user to Firestore
    const userDoc = admin.firestore().collection('users').doc(uid);
    await userDoc.set({
      created: admin.firestore.FieldValue.serverTimestamp(),
      email: payload.email || `vk_${vkId}@vk.com`,
      nickname: `${payload.given_name || ''} ${payload.family_name || ''}`.trim(),
      socialLink: `https://vk.com/id${vkId}`,
      isVerified: true,
    }, { merge: true });

    // Create Firebase custom token
    const firebaseToken = await admin.auth().createCustomToken(uid, { provider: 'vk' });
    res.json({ firebaseToken });
  } catch (err) {
    console.error('❌ Error exchanging code or verifying id_token:', err.message);
    res.status(400).send({ error: 'Failed to authenticate with VKID', details: err.message });
  }
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 VKID Auth Backend running on port ${PORT}`));
