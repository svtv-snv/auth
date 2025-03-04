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
const VK_SERVICE_TOKEN = process.env.VK_SERVICE_TOKEN;

if (!VK_APP_ID || !VK_SERVICE_TOKEN) {
    console.error("Missing VK_APP_ID or VK_SERVICE_TOKEN");
    process.exit(1);
}

app.post("/auth/vk", async (req, res) => {
    const { code, device_id } = req.body;

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

        console.log("VKID exchange response:", JSON.stringify(vkResponse.data, null, 2));

        if (vkResponse.data.error) {
            return res.status(400).json({ error: vkResponse.data.error });
        }

        const vkUser = vkResponse.data.response.user;

        if (!vkUser?.id) {
            return res.status(500).json({ error: "Invalid VK response structure" });
        }

        const uid = `vk_${vkUser.id}`;
        const userRef = admin.firestore().collection("users").doc(uid);

        const userData = {
            created: admin.firestore.FieldValue.serverTimestamp(),
            email: vkUser.email || `VK${vkUser.id}@vk.com`,
            nickname: `${vkUser.first_name ?? ''} ${vkUser.last_name ?? ''}`.trim(),
            socialLink: `https://vk.com/id${vkUser.id}`,
            isVerified: true,
            isAdmin: false,
        };

        const doc = await userRef.get();
        if (!doc.exists) {
            await userRef.set(userData);
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
        console.error(error.response?.data || error.message);
        res.status(500).json({ error: "Failed to authenticate with VKID" });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ VKID Auth Backend running on port ${PORT}`));
