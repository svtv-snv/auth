const express = require("express");
const admin = require("firebase-admin");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

// Initialize Firebase Admin
const serviceAccount = require("./firebase-adminsdk.json");
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

let vkPublicKeys = null;

async function getVKPublicKeys() {
    if (!vkPublicKeys) {
        const { data: openidConfig } = await axios.get("https://id.vk.com/.well-known/openid-configuration");
        const { data: jwks } = await axios.get(openidConfig.jwks_uri);
        vkPublicKeys = jwks.keys.reduce((acc, key) => {
            acc[key.kid] = key;
            return acc;
        }, {});
    }
    return vkPublicKeys;
}

async function verifyIdToken(idToken) {
    const header = JSON.parse(Buffer.from(idToken.split('.')[0], 'base64').toString('utf8'));
    const keys = await getVKPublicKeys();
    const key = keys[header.kid];

    if (!key) {
        throw new Error("Invalid VKID token - No matching key found");
    }

    const publicKey = `-----BEGIN CERTIFICATE-----\n${key.x5c[0]}\n-----END CERTIFICATE-----`;

    return jwt.verify(idToken, publicKey, { algorithms: ['RS256'], issuer: "https://id.vk.com" });
}

app.post("/auth/vk", async (req, res) => {
    const { id_token } = req.body;

    if (!id_token) {
        return res.status(400).json({ error: "Missing id_token" });
    }

    try {
        const payload = await verifyIdToken(id_token);

        const uid = `vk_${payload.sub}`;
        const userDoc = admin.firestore().collection("users").doc(uid);

        const userData = {
            created: admin.firestore.FieldValue.serverTimestamp(),
            email: payload.email || `VK${payload.sub}@vk.com`,
            nickname: `${payload.given_name ?? ''} ${payload.family_name ?? ''}`.trim(),
            socialLink: `https://vk.com/id${payload.sub}`,
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
        return res.status(400).json({ error: "Invalid id_token" });
    }
});

app.listen(5000, () => {
    console.log("VKID Auth Backend is running on port 5000");
});
