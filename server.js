const express = require("express");
const admin = require("firebase-admin");
const cors = require("cors");

require("dotenv").config();
const app = express();
app.use(express.json());
app.use(cors());

// Initialize Firebase Admin
const serviceAccount = require("./firebase-adminsdk.json");  // This must be uploaded to Render
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

// VK User to Firebase Flow
app.post("/auth/vk", async (req, res) => {
    const { vk_id, first_name, last_name, email, photo_url } = req.body;

    const uid = `vk_${vk_id}`;
    const userDoc = admin.firestore().collection("users").doc(uid);

    const userData = {
        created: admin.firestore.FieldValue.serverTimestamp(),
        email: email || `VK${vk_id}@vk.com`,
        nickname: `${first_name} ${last_name}`,
        socialLink: `https://vk.com/id${vk_id}`,
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
        photoURL: photo_url,
        provider: "vk"
    });

    res.json({ firebaseToken });
});

app.listen(5000, () => console.log("Server running on port 5000"));
