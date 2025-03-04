const express = require("express");
const admin = require("firebase-admin");
const axios = require("axios");
const cors = require("cors");
require("dotenv").config();

// Initialize Express app
const app = express();
app.use(express.json());
app.use(cors());

// Initialize Firebase Admin SDK
const serviceAccount = require("./firebase-adminsdk.json");
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

// Environment variables
const VK_APP_ID = process.env.VK_APP_ID;
const VK_SECURE_KEY = process.env.VK_SECURE_KEY;
const REDIRECT_URI = process.env.VK_REDIRECT_URI;

if (!VK_APP_ID || !VK_SECURE_KEY || !REDIRECT_URI) {
    console.error("Missing VK_APP_ID, VK_SECURE_KEY, or VK_REDIRECT_URI");
    process.exit(1);
}

// Define the /auth/vk route
app.post("/auth/vk", async (req, res) => {
    const { code } = req.body;

    try {
        console.log(`📥 VKID code received: ${code}`);

        // Exchange code for token
        const tokenResponse = await axios.post('https://id.vk.com/api/token', new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            client_id: VK_APP_ID,
            client_secret: VK_SECURE_KEY,
            redirect_uri: REDIRECT_URI,
        }).toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        console.log("🔔 VKID token response:", tokenResponse.data);

        const { access_token, id_token } = tokenResponse.data;

        if (!access_token || !id_token) {
            return res.status(400).json({ error: "Failed to exchange code for token." });
        }

        // Decode ID token (it's a JWT, but we can parse the payload)
        const idTokenParts = id_token.split('.');
        const payload = JSON.parse(Buffer.from(idTokenParts[1], 'base64').toString('utf-8'));

        const vkId = payload.sub;

        if (!vkId) {
            return res.status(400).json({ error: "Missing VKID user ID in token." });
        }

        // Save user to Firestore
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

        // Create Firebase token
        const firebaseToken = await admin.auth().createCustomToken(uid, {
            email: userData.email,
            displayName: userData.nickname,
            photoURL: payload.picture,
            provider: "vk",
        });

        return res.json({ firebaseToken });
    } catch (error) {
        console.error("❌ VKID token exchange failed:", error.response?.data || error.message);
        return res.status(500).json({ error: "Failed to authenticate with VKID" });
    }
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 VKID Auth Backend running on port ${PORT}`));
