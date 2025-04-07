const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const serviceAccount = require('./firebase-adminsdk.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const VK_CLIENT_ID = process.env.VK_CLIENT_ID;
const VK_CLIENT_SECRET = process.env.VK_CLIENT_SECRET;
const VK_REDIRECT_URI = 'https://svtv.app/auth/vk'; // тот же что в виджете

if (!VK_CLIENT_ID || !VK_CLIENT_SECRET) {
    console.error('❌ VK_CLIENT_ID или VK_CLIENT_SECRET отсутствуют');
    process.exit(1);
}

app.post('/auth/vk', async (req, res) => {
    const { code } = req.body;

    if (!code) {
        return res.status(400).json({ error: 'Отсутствует VK code' });
    }

    try {
        console.log('📥 Получен VK code:', code);

        const tokenResponse = await axios.post('https://oauth.vk.com/access_token', null, {
            params: {
                client_id: VK_CLIENT_ID,
                client_secret: VK_CLIENT_SECRET,
                redirect_uri: VK_REDIRECT_URI,
                code,
            },
        });

        const { access_token, user_id } = tokenResponse.data;
        if (!access_token) {
            throw new Error('Не получили access_token');
        }

        console.log('🔑 VK Access Token получен:', access_token);

        const userInfoResponse = await axios.get('https://api.vk.com/method/users.get', {
            params: {
                user_ids: user_id,
                fields: 'first_name,last_name',
                access_token: access_token,
                v: '5.131',
            },
        });

        const vkUser = userInfoResponse.data.response[0];
        console.log('👤 Инфа о пользователе VK:', vkUser);

        const uid = `vk_${user_id}`;
        const displayName = `${vkUser.first_name} ${vkUser.last_name}`;
        const socialLink = `https://vk.com/id${user_id}`;
        const userEmail = `${user_id}@vk.com`;

        // Заполняем Firestore
        await admin.firestore().collection('users').doc(uid).set({
            created: admin.firestore.FieldValue.serverTimestamp(),
            email: userEmail,
            nickname: displayName,
            socialLink: socialLink,
            isVerified: true,
            isAdmin: false,
        }, { merge: true });

        // Создаём пользователя в Firebase Auth, если его ещё нет
try {
    await admin.auth().getUser(uid);
    console.log('👤 Пользователь уже существует в Firebase Auth');
} catch (error) {
    if (error.code === 'auth/user-not-found') {
        console.log('🆕 Создаём нового пользователя в Firebase Auth');
        await admin.auth().createUser({
            uid,
            displayName,
            email: userEmail,
        });
    } else {
        console.error('❌ Ошибка при получении пользователя:', error.message);
        return res.status(500).json({ error: 'Ошибка при создании пользователя' });
    }
}

// Обновляем профиль (на всякий случай)
try {
    await admin.auth().updateUser(uid, {
        displayName: displayName,
        email: userEmail,
    });
    console.log('✅ Профиль пользователя успешно обновлён');
} catch (err) {
    console.error('❌ Ошибка при обновлении Firebase Auth профиля:', err.message);
    // Не критично, продолжаем
}

// Создаём кастомный токен
const firebaseToken = await admin.auth().createCustomToken(uid);
res.json({ firebaseToken });

    } catch (error) {
        console.error('❌ Ошибка при авторизации VK:', error.response?.data || error.message);
        res.status(500).json({
            error: 'Ошибка при авторизации VK',
            details: error.response?.data || error.message,
        });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 VK OAuth Backend запущен на порту ${PORT}`);
});
