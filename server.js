const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const serviceAccount = require('./firebase-adminsdk.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

let vkPublicKeys = null;

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

async function verifyIdToken(idToken) {
    const header = JSON.parse(Buffer.from(idToken.split('.')[0], 'base64').toString());
    const keys = await getVKPublicKeys();
    const key = keys[header.kid];
    if (!key) throw new Error('Invalid token (key mismatch)');
    const cert = `-----BEGIN CERTIFICATE-----\n${key.x5c[0]}\n-----END CERTIFICATE-----`;
    return jwt.verify(idToken, cert, { algorithms: ['RS256'], issuer: 'https://id.vk.com' });
}

app.post('/auth/vk', async (req, res) => {
    const { id_token } = req.body;
    if (!id_token) return res.status(400).send({ error: 'Missing id_token' });

    try {
        const payload = await verifyIdToken(id_token);
        const vkId = payload.sub;
        const uid = `vk_${vkId}`;

        const userDoc = admin.firestore().collection('users').doc(uid);
        await userDoc.set({
            created: admin.firestore.FieldValue.serverTimestamp(),
            email: payload.email,
            nickname: `${payload.given_name} ${payload.family_name}`.trim(),
            socialLink: `https://vk.com/id${vkId}`,
            isVerified: true,
        }, { merge: true });

        const firebaseToken = await admin.auth().createCustomToken(uid, { provider: 'vk' });
        res.json({ firebaseToken });
    } catch (err) {
        res.status(400).send({ error: 'Invalid token', details: err.message });
    }
});

app.listen(5000, () => console.log('VKID Auth Backend running'));
