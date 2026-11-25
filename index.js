const express = require('express');
const admin = require('firebase-admin');

// ── Firebase Admin SDK init ─────────────────────────────────────
const credJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
if (!credJson) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS_JSON env var is missing');
  process.exit(1);
}
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(credJson)),
});

const db = admin.firestore();
const messaging = admin.messaging();

const app = express();
app.use(express.json());

// ── Simple API-key auth ─────────────────────────────────────────
const API_KEY = process.env.PUSH_API_KEY || '';
function auth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.key;
  if (!API_KEY || key !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── POST /api/send-push ─────────────────────────────────────────
// Body: { userId, title, body?, data? }
app.post('/api/send-push', auth, async (req, res) => {
  try {
    const { userId, title, body, data } = req.body;
    if (!userId || !title) {
      return res.status(400).json({ error: 'userId and title required' });
    }

    // Read the user's FCM token from Firestore
    const userDoc = await db.collection('users').doc(userId).get();
    const ud = userDoc.data();
    if (!ud || !ud.fcmToken) {
      return res.json({ sent: false, reason: 'no_token' });
    }

    const message = {
      token: ud.fcmToken,
      notification: { title, body: body || '' },
      data: Object.fromEntries(
        Object.entries(data || {}).map(([k, v]) => [k, String(v)])
      ),
      android: {
        priority: 'high',
        notification: {
          channelId: 'high_importance_channel',
          priority: 'max',
          sound: 'default',
        },
      },
      apns: {
        payload: {
          aps: {
            alert: { title, body: body || '' },
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    const msgId = await messaging.send(message);
    console.log(`Sent push to ${userId}: ${msgId}`);
    res.json({ sent: true, messageId: msgId });
  } catch (err) {
    console.error('Push error:', err.code, err.message);
    // Clean up stale token
    if (err.code === 'messaging/registration-token-not-registered' ||
        err.code === 'messaging/invalid-registration-token') {
      try {
        await db.collection('users').doc(req.body.userId).update({
          fcmToken: admin.firestore.FieldValue.delete(),
        });
      } catch (_) {}
      return res.json({ sent: false, reason: 'token_expired' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ── Health ───────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/', (_req, res) => res.send('DryClean Plus Push Service'));

// ── Start ────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Push service on port ${PORT}`));
