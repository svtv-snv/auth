const express = require("express");
const admin = require("firebase-admin");
const axios = require("axios");
const cors = require("cors");

require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cors());

// Initialize Firebase Admin
const serviceAccount = require("./firebase-adminsdk.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const VK_APP_ID = process.env.VK_APP_ID;
const VK_SERVICE_TOKEN = process.env.VK_SERVICE_TOKEN;

if (!VK_APP_ID || !VK_SERVICE_TOKEN) {
    console.error("❌ Missing VK_APP_ID or VK_SERVICE_TOKEN in environment variables.");
    process.exit(1);
}

console.log(`✅ VKID Auth Backend Starting`);
console.log(`VK_APP_ID: ${VK_APP_ID}`);
console.log(`VK_SERVICE_TOKEN is present: ${!!VK_SERVICE_TOKEN}`);

app.post("/auth/vk", async (req, res) => {
    const { code, device_id } = req.body;

    console.log("📥 Incoming VKID Login Request");
    console.log(`Code: ${code}`);
    console.log(`Device ID: ${device_id}`);

    try {
        const vkResponse = await axios.post('https://api.vk.com/method/vkid.auth.exchangeCode', null, {
            params: {
                app_id: VK_APP_ID,
                code: code,
                device_id: device_id,
                v: '5.131',
                access_token: VK_SERVICE_TOKEN,
            },
        });

        console.log("🔔 VKID exchangeCode Response:", JSON.stringify(vkResponse.data, null, 2));

        if (vkResponse.data.error) {
            console.error("❌ VKID Error Response:", JSON.stringify(vkResponse.data.error, null, 2));
            return res.status(400).json({ error: vkResponse.data.error });
        }

        const vkData = vkResponse.data.response;

        if (!vkData) {
            console.error("❌ VK response missing 'response' field.");
            console.log("VKID Full Response Data (no response field):", JSON.stringify(vkResponse.data, null, 2));
            return res.status(500).json({ error: "Invalid VK response structure (no response field)" });
        }

        // Handle both nested and flat user data formats
        const vkUser = vkData.user || vkData;

        if (!vkUser.id) {
            console.error("❌ VKID response does not contain user id");
            console.log("VKID Data Extracted:", JSON.stringify(vkData, null, 2));
            return res.status(500).json({ error: "Invalid VK user data (no id)" });
        }

        const uid = `vk_${vkUser.id}`;
        const userDoc = admin.firestore().collection("users").doc(uid);

        const userData = {
            created: admin.firestore.FieldValue.serverTimestamp(),
            email: vkUser.email || `VK${vkUser.id}@vk.com`,
            nickname: `${vkUser.first_name || ''} ${vkUser.last_name || ''}`.trim(),
            socialLink: `https://vk.com/id${vkUser.id}`,
            isVerified: true,
            isAdmin: false,
        };

        const doc = await userDoc.get();
        if (!doc.exists) {
            await userDoc.set(userData);
        } else {
            await userDoc.update({
                nickname: userData.nickname,
                socialLink: userData.socialLink,
            });
        }

        const firebaseToken = await admin.auth().createCustomToken(uid, {
            email: userData.email,
            displayName: userData.nickname,
            photoURL: vkUser.photo,
            provider: "vk",
        });

        res.json({ firebaseToken });

    } catch (error) {
        console.error("❌ VKID exchange failed");

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
