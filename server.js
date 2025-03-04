const express = require("express");
const admin = require("firebase-admin");
const axios = require("axios");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const jwkToPem = require("jwk-to-pem");

require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cors());

// Firebase Admin SDK
const serviceAccount = require("./firebase-adminsdk.json");
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const VK_APP_ID = process.env.VK_APP_ID;

if (!VK_APP_ID) {
    console.error("Missing VK_APP_ID in environment variables.");
    process.exit(1);
}

console.log(`✅ VKID Backend Service Starting...`);
console.log(`✅ VK_APP_ID: ${VK_APP_ID}`);

// VK OpenID Configuration URL
const OPENID_CONFIG_URL = "https://id.vk.com/.well-known/openid-configuration";

let jwks = null;

// Fetch JWKS once (VK public keys)
async function fetchJWKS() {
    const config = await axios.get(OPENID_CONFIG_URL);
    const jwksResponse = await axios.get(config.data.jwks_uri);
    jwks = jwksResponse.data;
    console.log("✅ Fetched VKID JWKS keys.");
}

// Validate and decode ID Token
function validateIDToken(idToken) {
    const decoded = jwt.decode(idToken, { complete: true });
    if (!decoded || !decoded.header) {
        throw new Error("Invalid ID Token format");
    }

    const key = jwks.keys.find(k => k.kid === decoded.header.kid);
    if (!key) {
        throw new Error("Matching key not found in JWKS");
    }

    const publicKey = jwkToPem(key);

    return jwt.verify(idToken, publicKey, {
        algorithms: ["RS256"],
        audience: VK_APP_ID,
        issuer: "https://id.vk.com",
    });
}

app.post("/auth/vk", async (req, res) => {
    const { id_token } = req.body;

    if (!id_token) {
        return res.status(400).json({ error: "Missing id_token" });
    }

    try {
        const payload = validateIDToken(id_token);
        console.log("✅ Verified VKID token payload:", payload);

        const uid = `vk_${payload.sub}`;
        const userRef = admin.firestore().collection("users").doc(uid);

        const userData = {
            created: admin.firestore.FieldValue.serverTimestamp(),
            email: payload.email || `VK${payload.sub}@vk.com`,
            nickname: payload.name || payload.preferred_username || `VK User ${payload.sub}`,
            socialLink: `https://vk.com/id${payload.sub}`,
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
            photoURL: payload.picture,
            provider: "vk",
        });

        res.json({ firebaseToken });

    } catch (error) {
        console.error("❌ Failed to verify VKID token", error.message);
        res.status(500).json({ error: "Failed to verify VKID token" });
    }
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
    await fetchJWKS();  // Pre-load keys
    console.log(`🚀 VKID Auth Backend running on port ${PORT}`);
});
