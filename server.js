const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const axios = require("axios");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// Initialize Firebase Admin (replace with your service account file)
const serviceAccount = require("./firebase-adminsdk.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

// Cache for VK public keys
let vkPublicKeys = null;

// Fetch VK's OpenID Connect public keys (JWKS)
async function getVKPublicKeys() {
    if (vkPublicKeys) return vkPublicKeys;

    const openidConfigUrl = "https://id.vk.com/.well-known/openid-configuration";
    const { data: openidConfig } = await axios.get(openidConfigUrl);
    const { data: jwks } = await axios.get(openidConfig.jwks_uri);

    vkPublicKeys = jwks.keys.reduce((map, key) => {
        map[key.kid] = key;
        return map;
    }, {});

    return vkPublicKeys;
}

// Verify the id_token with VK's public keys
async function verifyIdToken(idToken) {
    const header = JSON.parse(Buffer.from(idToken.split('.')[0], 'base64').toString('utf8'));
    const keys = await getVKPublicKeys();

    const key = keys[header.kid];
    if (!key) throw new Error("No matching key found for VKID token");

    const publicKey = `-----BEGIN CERTIFICATE-----\n${key.x5c[0]}\n-----END CERTIFICATE-----`;

    return jwt.verify(idToken, publicKey, { algorithms: ['RS256'], issuer: "https://id.vk.com" });
}

// Main VK Auth handler
app.post("/auth/vk", async (req, res) => {
    const { id_token } = req.body;

    if (!id_token) {
        return res.status(400).json({ error: "Missing id_token" });
    }

    try {
        const payload = await verifyIdToken(id_token);
        console.log("✅ Verified VKID token payload:", payload);

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
        res.status(400).json({ error: "Invalid id_token" });
    }
});

// Simple health check
app.get("/health", (req, res) => {
    res.send("VKID Auth Backend is running");
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 VKID Auth Backend running on port ${PORT}`);
});
