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
const VK_SERVICE_TOKEN = process.env.VK_SERVICE_TOKEN; // Create this in your VK app's settings

app.post("/auth/vk", async (req, res) => {
    const { code, device_id } = req.body;

    try {
        // Exchange code for user data using VKID's backend API
        const vkResponse = await axios.post('https://api.vk.com/method/vkid.auth.exchangeCode', null, {
            params: {
                app_id: VK_APP_ID,
                code: code,
                device_id: device_id,
                v: '5.131',
                access_token: VK_SERVICE_TOKEN,
            },
        });

        const vkData = vkResponse.data.response;

        const uid = `vk_${vkData.user.id}`;
        const userDoc = admin.firestore().collection("users").doc(uid);

        const userData = {
            created: admin.firestore.FieldValue.serverTimestamp(),
            email: vkData.user.email || `VK${vkData.user.id}@vk.com`,
            nickname: `${vkData.user.first_name} ${vkData.user.last_name}`,
            socialLink: `https://vk.com/id${vkData.user.id}`,
            isVerified: true,
            isAdmin: false,
        };

        const doc = await userDoc.get();
        if (!doc.exists) {
            await userDoc.set(userData);
        }

        const firebaseToken = await admin.auth().createCustomToken(uid, {
            email: userData.email,
            displayName: userData.nickname,
            photoURL: vkData.user.photo,
            provider: "vk",
        });

        res.json({ firebaseToken });
    } catch (error) {
        console.error("VKID exchange failed:", error.response?.data || error.message);
        res.status(500).json({ error: "Failed to authenticate with VKID" });
    }
});

app.listen(5000, () => console.log("Server running on port 5000"));
