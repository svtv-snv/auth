const express = require("express");
const admin = require("firebase-admin");
const axios = require("axios");
const cors = require("cors");

require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cors());

// Initialize Firebase Admin
const serviceAccount = require("./firebase-adminsdk.json");  // Make sure this is correctly deployed to your Render instance
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const VK_APP_ID = process.env.VK_APP_ID;              // from your VK app settings
const VK_SERVICE_TOKEN = process.env.VK_SERVICE_TOKEN;  // from your VK app settings

app.post("/auth/vk", async (req, res) => {
    const { code, device_id } = req.body;

    try {
        // Step 1 - Exchange code for VKID user data using VK API
        const vkResponse = await axios.post('https://api.vk.com/method/vkid.auth.exchangeCode', null, {
            params: {
                app_id: VK_APP_ID,
                code: code,
                device_id: device_id,
                v: '5.131',  // VK API version
                access_token: VK_SERVICE_TOKEN,
            },
        });

        const vkData = vkResponse.data.response;

        // Log for debugging purposes — see the full VK response in Render logs
        console.log("VK Response Data:", JSON.stringify(vkResponse.data, null, 2));

        // Step 2 - Support both formats (sometimes VKID returns `user`, sometimes it's top-level)
        const vkUser = vkData.user || vkData;

        // Step 3 - Create user in Firestore (or update if they already exist)
        const uid = `vk_${vkUser.id}`;
        const userDoc = admin.firestore().collection("users").doc(uid);

        const userData = {
            created: admin.firestore.FieldValue.serverTimestamp(),
            email: vkUser.email || `VK${vkUser.id}@vk.com`,
            nickname: `${vkUser.first_name} ${vkUser.last_name}`,
            socialLink: `https://vk.com/id${vkUser.id}`,
            isVerified: true,
            isAdmin: false,
        };

        const doc = await userDoc.get();
        if (!doc.exists) {
            await userDoc.set(userData);
        } else {
            // Optionally update nickname and social link if user changed name
            await userDoc.update({
                nickname: userData.nickname,
                socialLink: userData.socialLink,
            });
        }

        // Step 4 - Create Firebase Custom Token
        const firebaseToken = await admin.auth().createCustomToken(uid, {
            email: userData.email,
            displayName: userData.nickname,
            photoURL: vkUser.photo,
            provider: "vk",
        });

        // Step 5 - Send the custom token back to Flutter
        res.json({ firebaseToken });

    } catch (error) {
        console.error("VKID exchange failed:", error.response?.data || error.message);
        res.status(500).json({ error: "Failed to authenticate with VKID" });
    }
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
