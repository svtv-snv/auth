const express = require("express");
const admin = require("firebase-admin");
const axios = require("axios");
const cors = require("cors");
const { verify } = require("jsonwebtoken");  // You will need to fetch and cache VK's public keys

require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cors());

const serviceAccount = require("./firebase-adminsdk.json");
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

let vkPublicKeys = null;

// Fetch VK's JWKS (public keys for JWT verification)
async function getVKPublicKeys() {
    if (!vkPublicKeys) {
        const openidConfig = await axios.get('https://id.vk.com/.well-known/openid-configuration');
        const jwksUri = openidConfig.data.jwks_uri;
        const jwksResponse = await axios.get(jwksUri);
        vkPublicKeys = jwksResponse.data.keys;
    }
    return vkPublicKeys;
}

async function verifyVKIDToken(idToken) {
    const keys = await getVKPublicKeys();
    const header = JSON.parse(Buffer.from(idToken.split('.')[0], 'base64').toString('utf8'));

    const key = keys.find(k => k.kid === header.kid);
    if (!key) {
        throw new Error('Invalid VKID token - no matching key');
    }

    const publicKey = `-----BEGIN PUBLIC KEY-----\n${key.x5c[0]}\n-----END PUBLIC KEY-----`;
    return new Promise((resolve, reject) => {
        verify(idToken, publicKey, { algorithms: ['RS256'] }, (err, decoded) => {
            if (err) return reject(err);
            resolve(decoded);
        });
    });
}

app.post("/auth/vk", async (req, res) => {
    const { id_token } = req.body;

    if (!id_token) {
        return res.status(400).json({ error: "Missing id_token" });
    }

    try {
        const payload = await verifyVKIDToken(id_token);
        const vkId = payload.sub;

        if (!vkId) {
            return res.status(400).json({ error: "Missing VKID user ID in token." });
        }

        const uid = `vk_${vkId}`;
        const userDoc = admin.firestore().collection("users").doc(uid);

        const userData = {
            created: admin.firestore.FieldValue.serverTimestamp(),
            email: payload.email || `VK${vkId}@vk.com`,
            nickname: `${payload.given_name ?? ''} ${payload.family_name ?? ''}`.trim(),
            socialLink: `https://vk.com/id${vkId}`,
            isVerified: true,
            isAdmin: false,
        };

        const doc = await userDoc.get();
        if (!doc.exists) {
            await userDoc.set(userData);
        } else {
            await userDoc.update(userData);
        }

        const firebaseToken = await admin.auth().createCustomToken(uid, {
            email: userData.email,
            displayName: userData.nickname,
            photoURL: payload.picture,
            provider: "vk",
        });

        return res.json({ firebaseToken });

    } catch (error) {
        console.error("❌ Failed to verify VKID token:", error.message);
        return res.status(500).json({ error: "Failed to verify VKID token" });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 VKID Auth Backend running on port ${PORT}`));
