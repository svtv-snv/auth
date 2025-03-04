const express = require("express");
const admin = require("firebase-admin");
const axios = require("axios");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cors());

const serviceAccount = require("./firebase-adminsdk.json");
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const VK_APP_ID = process.env.VK_APP_ID;
const VK_CLIENT_SECRET = process.env.VK_CLIENT_SECRET;
const VK_REDIRECT_URI = process.env.VK_REDIRECT_URI;

app.post("/auth/vk", async (req, res) => {
    const { code } = req.body;

    if (!code) {
        return res.status(400).json({ error: "Missing code" });
    }

    try {
        // Exchange code for id_token using the correct VKID endpoint
        const tokenResponse = await axios.post('https://id.vk.com/api/token', new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: VK_APP_ID,
            client_secret: VK_CLIENT_SECRET,
            code: code,
            redirect_uri: VK_REDIRECT_URI,
        }).toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        console.log("✅ VK Token Response:", tokenResponse.data);

        const { id_token } = tokenResponse.data;
        if (!id_token) {
            throw new Error("No id_token returned from VK");
        }

        // Decode the id_token to get user info
        const payload = JSON.parse(Buffer.from(id_token.split('.')[1], 'base64').toString('utf-8'));

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
        console.error("❌ Failed VK Auth:", error.response?.data || error.message);
        res.status(500).json({ error: "Failed to authenticate with VKID", details: error.message });
    }
});

app.listen(5000, () => console.log("🚀 VKID Auth Backend running on port 5000"));
