const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const serviceAccount = require('./firebase-adminsdk.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

app.post('/auth/vk', async (req, res) => {
  const { accessToken, vkId, firstName, lastName, photo } = req.body;

  if (!accessToken || !vkId || !firstName || !lastName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    console.log(`📥 Verifying VK user ${vkId} with token: ${accessToken.substring(0, 8)}...`);

    const vkResponse = await axios.get('https://api.vk.com/method/users.get', {
      params: {
        user_ids: vkId,
        access_token: accessToken,
        v: '5.131',
        fields: 'email,photo_200'
      }
    });

    if (!vkResponse.data.response?.length) {
      throw new Error('Failed to fetch VK user');
    }

    const vkUser = vkResponse.data.response[0];
    console.log('✅ VK user confirmed:', vkUser);

    const uid = `vk_${vkId}`;
    const displayName = `${firstName} ${lastName}`;
    const email = vkUser.email || `${vkId}@vk.com`;

    await admin.firestore().collection('users').doc(uid).set({
      created: admin.firestore.FieldValue.serverTimestamp(),
      displayName,
      email,
      photoUrl: photo || vkUser.photo_200,
      socialLink: `https://vk.com/id${vkId}`,
      isVerified: true,
      isAdmin: false,
    }, { merge: true });

    const firebaseToken = await admin.auth().createCustomToken(uid);
    res.json({ firebaseToken });
  } catch (err) {
    console.error('❌ VK Auth Error:', err.message);
    res.status(500).json({ error: 'Failed to authenticate with VK', details: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
