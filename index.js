const express = require('express');
const admin = require('firebase-admin');
const { generateInvoicePdfBuffer } = require('./invoice_pdf');
const { buildDeliveredHtml, buildApprovalHtml, buildConfirmationHtml } = require('./email_templates');

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
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
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
// Body: { userId, title, body?, data?, collection? }
app.post('/api/send-push', auth, async (req, res) => {
  try {
    const { userId, title, body, data, collection } = req.body;
    if (!userId || !title) {
      return res.status(400).json({ error: 'userId and title required' });
    }

    const col = collection === 'drivers' ? 'drivers' : 'users';
    // Read the recipient's FCM token from Firestore
    const userDoc = await db.collection(col).doc(userId).get();
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

// ── POST /api/send-email ────────────────────────────────────────
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'DryClean Plus <orders@drycleanplus.co.uk>';
const REPLY_TO = 'dilee@drycleanplus.co.uk';

app.post('/api/send-email', auth, async (req, res) => {
  try {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      return res.status(500).json({ error: 'RESEND_API_KEY is not configured on Render' });
    }
    const { type, order, recipientEmail } = req.body || {};
    const targetEmail = recipientEmail || order?.bookingData?.email || order?.email;
    if (!targetEmail || !String(targetEmail).includes('@')) {
      return res.status(400).json({ error: 'Valid recipientEmail is required' });
    }
    const id = order?.orderId || order?.id || 'order';
    const subject = type === 'awaiting_approval'
      ? `Please approve your updated order #${id}`
      : type === 'delivered'
        ? `Your DryClean Plus receipt, order #${id}`
        : `Booking confirmed, order #${id}`;
    const html = type === 'awaiting_approval'
      ? buildApprovalHtml(order, id)
      : type === 'delivered'
        ? buildDeliveredHtml(order, id)
        : buildConfirmationHtml(order, id);

    const attachments = [];
    if (type === 'delivered' || type === 'awaiting_approval') {
      try {
        const pdfBuffer = await generateInvoicePdfBuffer(order, id);
        attachments.push({ filename: `Invoice-INV-${id}.pdf`, content: pdfBuffer.toString('base64') });
      } catch (pdfErr) {
        console.warn('[send-email] PDF warning:', pdfErr.message);
      }
    }

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [String(targetEmail).trim()],
        reply_to: REPLY_TO,
        subject,
        html,
        ...(attachments.length > 0 ? { attachments } : {}),
      }),
    });
    const data = await r.json();
    return res.status(r.ok ? 200 : r.status).json(data);
  } catch (err) {
    console.error('Email error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ── Health ───────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/', (_req, res) => res.send('DryClean Plus Push Service'));

// ── Start ────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Push service on port ${PORT}`));
