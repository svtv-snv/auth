const express = require("express");
const admin = require("firebase-admin");
const axios = require("axios");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cors());

// ✅ Firebase Admin Initialization
const serviceAccount = require("./firebase-adminsdk.json");
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

// ✅ VK Config (loaded from .env)
const VK_APP_ID = process.env.VK_APP_ID;
const VK_CLIENT_SECRET = process.env.VK_CLIENT_SECRET;
const VK_REDIRECT_URI = process.env.VK_REDIRECT_URI;

console.log('🔐 VK_APP_ID:', VK_APP_ID);
console.log('🔐 VK_CLIENT_SECRET:', VK_CLIENT_SECRET ? 'Loaded' : 'Missing');
console.log('🔐 VK_REDIRECT_URI:', VK_REDIRECT_URI);

// ✅ Debug endpoint (visit this on Render to verify env vars are set correctly)
app.get('/debug/env', (req, res) => {
    res.json({
        VK_APP_ID,
        VK_CLIENT_SECRET_PRESENT: !!VK_CLIENT_SECRET,
        VK_REDIRECT_URI,
    });
});

// ✅ VKID Auth Endpoint
app.post("/auth/vk", async (req, res) => {
    const { code, device_id } = req.body;  // device_id received but unused

    console.log('📥 Received code & device_id:', { code, device_id });

    if (!code) {
        return res.status(400).json({ error: "Missing code" });
    }

    try {
        // ✅ Exchange code for tokens (id_token is what we want)
        console.log('🚀 Sending token exchange request to VK:', {
            grant_type: 'authorization_code',
            client_id: VK_APP_ID,
            client_secret: VK_CLIENT_SECRET,
            redirect_uri: VK_REDIRECT_URI,
            code: code
        });

        const tokenResponse = await axios.post('https://id.vk.com/oauth2/token', new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: VK_APP_ID,
            client_secret: VK_CLIENT_SECRET,
            redirect_uri: VK_REDIRECT_URI,
            code: code
        }).toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        console.log("✅ VK Token Response:", tokenResponse.data);

        const { id_token } = tokenResponse.data;
        if (!id_token) {
            throw new Error("No id_token returned from VK");
        }

        // ✅ Decode id_token to extract user information
        const payload = JSON.parse(Buffer.from(id_token.split('.')[1], 'base64').toString('utf-8'));
        console.log('✅ Decoded VKID Payload:', payload);

        const vkId = payload.sub;
        const email = payload.email || `VK${vkId}@vk.com`;
        const nickname = `${payload.given_name ?? 'Unknown'} ${payload.family_name ?? ''}`.trim();

        const uid = `vk_${vkId}`;
        const userDoc = admin.firestore().collection("users").doc(uid);

        const userData = {
            created: admin.firestore.FieldValue.serverTimestamp(),
            email,
            nickname,
            socialLink: `https://vk.com/id${vkId}`,
            isVerified: true,
        };

        await userDoc.set(userData, { merge: true });

        const firebaseToken = await admin.auth().createCustomToken(uid, {
            email: userData.email,
            displayName: userData.nickname,
            provider: "vk",
        });

        res.json({ firebaseToken });

    } catch (error) {
        console.error("❌ VK Auth Failed:", error.response?.data || error.message);
        res.status(500).json({ error: "Failed to authenticate with VKID", details: error.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 VKID Auth Backend running on port ${PORT}`));
