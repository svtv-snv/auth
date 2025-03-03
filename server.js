const express = require("express");
const admin = require("firebase-admin");
const axios = require("axios");
const cors = require("cors");

require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cors());

// Initialize Firebase Admin
const serviceAccount = require("./firebase-adminsdk.json");  // Make sure this exists on Render!
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const VK_APP_ID = process.env.VK_APP_ID;
const VK_SERVICE_TOKEN = process.env.VK_SERVICE_TOKEN;

// 🔥 Helper function to log incoming env variables (good for debugging on Render)
console.log(`VK_APP_ID: ${VK_APP_ID}`);
console.log(`VK_SERVICE_TOKEN: ${VK_SERVICE_TOKEN ? 'Exists' : 'Missing!'}`);

// VKID Auth Endpoint
app.post("/auth/vk", async (req, res) => {
    const { code, device_id } = req.body;

    console.log("Incoming VKID login request:");
    console.log(`Code: ${code}`);
    console.log(`Device ID: ${device_id}`);

    try {
        const vkResponse = await axios.post('https://api.vk.com/method/auth.exchangeCode', null, {
            params: {
                app_id: VK_APP_ID,
                code: code,
                device_id: device_id,
                v: '5.131',
                access_token: VK_SERVICE_TOKEN,
            },
        });

        // Log full VK response for debugging
        console.log("VKID exchangeCode response:");
        console.log(JSON.stringify(vkResponse.data, null, 2));

        if (!vkResponse.data.response) {
            throw new Error("VK response missing 'response' field - unexpected response format.");
        }

        const vkData = vkResponse.data.response;

        // Some VK responses use response.user, some put user data directly in response
        const vkUser = vkData.user || vkData;

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

        // Check if user already exists in Firestore
        const doc = await userDoc.get();
        if (!doc.exists) {
            await userDoc.set(userData);
        } else {
            await userDoc.update({
                nickname: userData.nickname,
                socialLink: userData.socialLink,
            });
        }

        // Create Firebase Custom Token
        const firebaseToken = await admin.auth().createCustomToken(uid, {
            email: userData.email,
            displayName: userData.nickname,
            photoURL: vkUser.photo,
            provider: "vk",
        });

        res.json({ firebaseToken });
    } catch (error) {
        console.error("VKID exchange failed:");
        if (error.response) {
            console.error("VK Error Response:", JSON.stringify(error.response.data, null, 2));
        } else {
            console.error("Error Message:", error.message);
        }
        res.status(500).json({ error: "Failed to authenticate with VKID" });
    }
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
