const express = require("express");
const admin = require("firebase-admin");
const axios = require("axios");
const cors = require("cors");

require("dotenv").config();

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
const VK_SERVICE_TOKEN = process.env.VK_SERVICE_TOKEN;

if (!VK_APP_ID || !VK_SERVICE_TOKEN) {
    console.error("Missing VK_APP_ID or VK_SERVICE_TOKEN in environment variables.");
    process.exit(1);
}

console.log(`✅ VKID Backend Service Starting...`);
console.log(`✅ VK_APP_ID: ${VK_APP_ID}`);
console.log(`✅ VK_SERVICE_TOKEN is present: ${!!VK_SERVICE_TOKEN}`);

app.post("/auth/vk", async (req, res) => {
    const { userToken } = req.body;

    if (!userToken) {
        return res.status(400).json({ error: "Missing userToken in request body" });
    }

    console.log("📥 Incoming VKID Login Request");
    console.log(`🔑 userToken: ${userToken}`);

    try {
        // Validate token directly with VK
        const vkResponse = await axios.post("https://api.vk.com/method/vkid.auth.validateToken", null, {
            params: {
                token: userToken,
                access_token: VK_SERVICE_TOKEN,
                v: "5.199"
            }
        });

        console.log("🔔 VKID validateToken Response:", JSON.stringify(vkResponse.data, null, 2));

        if (vkResponse.data.error) {
            console.error("❌ VKID Error Response:", JSON.stringify(vkResponse.data.error, null, 2));
            return res.status(400).json({ error: vkResponse.data.error });
        }

        const vkUser = vkResponse.data.response?.user;

        if (!vkUser || !vkUser.id) {
            console.error("❌ VKID response missing user data");
            return res.status(500).json({ error: "Invalid VK response structure" });
        }

        // Prepare Firestore document
        const uid = `vk_${vkUser.id}`;
        const userDoc = admin.firestore().collection("users").doc(uid);

        const userData = {
            created: admin.firestore.FieldValue.serverTimestamp(),
            email: vkUser.email || `VK${vkUser.id}@vk.com`,
            nickname: `${vkUser.first_name || ''} ${vkUser.last_name || ''}`.trim(),
            socialLink: `https://vk.com/id${vkUser.id}`,
            isVerified: true,
            isAdmin: false
        };

        // Set or update user data in Firestore
        const doc = await userDoc.get();
        if (!doc.exists) {
            await userDoc.set(userData);
        } else {
            await userDoc.update({
                nickname: userData.nickname,
                socialLink: userData.socialLink
            });
        }

        // Create Firebase Custom Token
        const firebaseToken = await admin.auth().createCustomToken(uid, {
            email: userData.email,
            displayName: userData.nickname,
            photoURL: vkUser.photo,
            provider: "vk"
        });

        // Respond with Firebase Custom Token
        res.json({ firebaseToken });

    } catch (error) {
        console.error("❌ VKID validation failed");
        if (error.response) {
            console.error("❌ VK API Error Response:", JSON.stringify(error.response.data, null, 2));
        } else {
            console.error("❌ Error Message:", error.message);
        }
        res.status(500).json({ error: "Failed to authenticate with VKID" });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 VKID Auth Backend running on port ${PORT}`));
