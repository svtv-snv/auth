const express = require("express");
const admin = require("firebase-admin");
const axios = require("axios");
const cors = require("cors");
const jwt = require("jsonwebtoken");  // For verifying id_token
const jwksClient = require("jwks-rsa");  // For fetching VK's public keys
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

// VK OpenID Config & JWKS Client (public keys from VK to verify tokens)
const vkOpenIdConfigUrl = 'https://id.vk.com/.well-known/openid-configuration';
let jwksClientInstance = null;

async function getJwksClient() {
    if (jwksClientInstance) return jwksClientInstance;

    const { data } = await axios.get(vkOpenIdConfigUrl);
    jwksClientInstance = jwksClient({
        jwksUri: data.jwks_uri
    });

    return jwksClientInstance;
}

async function getSigningKey(header) {
    const client = await getJwksClient();
    return new Promise((resolve, reject) => {
        client.getSigningKey(header.kid, (err, key) => {
            if (err) {
                return reject(err);
            }
            resolve(key.getPublicKey());
        });
    });
}

async function verifyIdToken(idToken) {
    const decodedHeader = jwt.decode(idToken, { complete: true });
    if (!decodedHeader) throw new Error("Invalid JWT (cannot decode header)");

    const publicKey = await getSigningKey(decodedHeader.header);

    return jwt.verify(idToken, publicKey, {
        algorithms: ["RS256"],
        issuer: "https://id.vk.com",
        audience: VK_APP_ID,  // Make sure token was issued for YOUR app
    });
}

app.post("/auth/vk", async (req, res) => {
    const { code } = req.body;

    if (!code) {
        return res.status(400).json({ error: "Missing code" });
    }

    try {
        console.log("📥 Received VKID code:", code);

        // Exchange code for id_token and access_token
        const tokenResponse = await axios.post('https://id.vk.com/oauth2/token', new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: VK_APP_ID,
            client_secret: VK_CLIENT_SECRET,
            redirect_uri: VK_REDIRECT_URI,
            code: code
        }).toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        console.log("✅ VK Token Response:", tokenResponse.data);

        const { id_token } = tokenResponse.data;
        if (!id_token) {
            throw new Error("No id_token returned from VK");
        }

        // Verify and decode id_token
        const payload = await verifyIdToken(id_token);
        console.log("✅ Verified VKID Token Payload:", payload);

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
        console.error("❌ VK Auth Failed:", error.message);
        res.status(500).json({ error: "Failed to authenticate with VKID", details: error.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 VKID Auth Backend running on port ${PORT}`));
