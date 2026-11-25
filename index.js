const express = require('express');
const path = require('path');
const admin = require('firebase-admin');
const { generateInvoicePdfBuffer } = require('./invoice_pdf');
const { buildDeliveredHtml, buildApprovalHtml, buildConfirmationHtml, buildPromoHtml } = require('./email_templates');

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
app.use('/assets', express.static(path.join(__dirname, 'public')));

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

// ── POST /api/send-promo ────────────────────────────────────────
// Body: { audience: 'test'|'first_order'|'all', testEmail?, testName?, subject, headline, body1, body2, promoCode, ctaText, ctaUrl }
app.post('/api/send-promo', auth, async (req, res) => {
  try {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      return res.status(500).json({ error: 'RESEND_API_KEY is not configured on Render' });
    }
    const {
      audience = 'test',
      testEmail = '',
      testName = 'Sijaan',
      subject = '{firstName}, your first DryClean Plus order is 20% off',
      headline = '',
      body1 = '',
      body2 = '',
      promoCode = 'WELCOME20',
      ctaText = 'GET 20% OFF MY FIRST ORDER',
      ctaUrl = 'https://drycleanplus.co.uk',
    } = req.body || {};

    let recipients = [];
    if (audience === 'test') {
      if (!testEmail || !String(testEmail).includes('@')) {
        return res.status(400).json({ error: 'Valid testEmail is required' });
      }
      recipients = [{ uid: 'test', email: String(testEmail).trim(), firstName: String(testName || 'there').trim() }];
    } else {
      const usersSnap = await db.collection('users').get();
      let orderedUids = new Set();
      if (audience === 'first_order') {
        const ordersSnap = await db.collection('orders').select('userId').get();
        orderedUids = new Set(ordersSnap.docs.map((d) => String(d.data().userId || '')).filter(Boolean));
      }
      const seen = new Set();
      for (const doc of usersSnap.docs) {
        const u = doc.data() || {};
        if (u.emailUnsubscribed === true) continue;
        if (audience === 'first_order' && orderedUids.has(doc.id)) continue;
        const email = String(u.email || '').trim().toLowerCase();
        if (!email || !email.includes('@') || seen.has(email)) continue;
        seen.add(email);
        const rawName = String(u.firstName || u.name || u.displayName || '').trim();
        const firstName = rawName ? rawName.split(/\s+/)[0] : 'there';
        recipients.push({ uid: doc.id, email, firstName });
      }
    }

    const basePublicUrl = process.env.PUBLIC_URL || 'https://dc-push-service.onrender.com';
    let sent = 0;
    let failed = 0;
    const errors = [];

    for (const r of recipients) {
      const unsubUrl = `${basePublicUrl}/api/unsubscribe?uid=${encodeURIComponent(r.uid)}&email=${encodeURIComponent(r.email)}`;
      const personalSubject = String(subject)
        .replace(/\{firstName\}/gi, r.firstName)
        .replace(/\{code\}/gi, promoCode || '');
      const html = buildPromoHtml({
        firstName: r.firstName,
        headline,
        body1,
        body2,
        promoCode,
        ctaText,
        ctaUrl,
        unsubscribeUrl: unsubUrl,
      });

      try {
        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to: [r.email],
            reply_to: REPLY_TO,
            subject: personalSubject,
            html,
            headers: { 'List-Unsubscribe': `<${unsubUrl}>` },
          }),
        });
        if (resp.ok) {
          sent++;
        } else {
          failed++;
          const txt = await resp.text();
          if (errors.length < 3) errors.push(txt);
        }
      } catch (e) {
        failed++;
        if (errors.length < 3) errors.push(e.message);
      }
    }

    return res.json({ ok: sent > 0 || recipients.length === 0, total: recipients.length, sent, failed, errors });
  } catch (err) {
    console.error('Promo email error:', err);
    return res.status(500).json({ error: err.message });
  }
});

function buildPrefHtml({ title, heading, message, actionLabel, actionUrl }) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <link href="https://fonts.googleapis.com/css2?family=Satisfy&display=swap" rel="stylesheet">
  <title>${title} · DryClean Plus</title></head>
  <body style="margin:0;padding:32px 16px;background:#F5F7FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#111827;">
    <div style="max-width:460px;margin:40px auto;background:#FFFFFF;border-radius:14px;border:1px solid #E5E7EB;padding:32px 28px;text-align:center;">
      <div style="margin-bottom:20px;">
        <span style="font-family:'Satisfy',cursive,Georgia,serif;font-size:26px;font-weight:bold;font-style:italic;color:#1B5E20;">Dryclean</span>
        <span style="font-family:'Satisfy',cursive,Georgia,serif;font-size:26px;font-weight:bold;font-style:italic;color:#EF4444;margin-left:3px;">Plus+</span>
      </div>
      <h2 style="margin:0 0 10px;font-size:22px;color:#0B2A6B;">${heading}</h2>
      <p style="margin:0 0 24px;font-size:14.5px;line-height:1.6;color:#4B5563;">${message}</p>
      <a href="${actionUrl}" style="display:inline-block;padding:12px 22px;background:#0B2A6B;color:#FFFFFF;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;">${actionLabel}</a>
      <div style="margin-top:16px;">
        <a href="https://drycleanplus.co.uk" style="font-size:13px;color:#0077FF;text-decoration:underline;">Return to drycleanplus.co.uk</a>
      </div>
    </div>
  </body></html>`;
}

// ── GET /api/unsubscribe & /api/resubscribe ─────────────────────
app.get('/api/unsubscribe', async (req, res) => {
  const uid = String(req.query.uid || '').trim();
  const email = String(req.query.email || '').trim();
  if (uid && uid !== 'test') {
    try {
      await db.collection('users').doc(uid).set({ emailUnsubscribed: true }, { merge: true });
    } catch (_) {}
  }
  const basePublicUrl = process.env.PUBLIC_URL || 'https://dc-push-service.onrender.com';
  const resubUrl = `${basePublicUrl}/api/resubscribe?uid=${encodeURIComponent(uid)}&email=${encodeURIComponent(email)}`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(buildPrefHtml({
    title: 'Unsubscribed',
    heading: 'You have been unsubscribed',
    message: 'You will no longer receive promotional offer emails from DryClean Plus. You will still receive important order updates and receipts.',
    actionLabel: 'Unsubscribed by mistake? Re-subscribe',
    actionUrl: resubUrl,
  }));
});

app.get('/api/resubscribe', async (req, res) => {
  const uid = String(req.query.uid || '').trim();
  const email = String(req.query.email || '').trim();
  if (uid && uid !== 'test') {
    try {
      await db.collection('users').doc(uid).set({ emailUnsubscribed: false }, { merge: true });
    } catch (_) {}
  }
  const basePublicUrl = process.env.PUBLIC_URL || 'https://dc-push-service.onrender.com';
  const unsubUrl = `${basePublicUrl}/api/unsubscribe?uid=${encodeURIComponent(uid)}&email=${encodeURIComponent(email)}`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(buildPrefHtml({
    title: 'Subscribed',
    heading: 'Welcome back!',
    message: 'You are re-subscribed to DryClean Plus promotional offers and discount codes.',
    actionLabel: 'Unsubscribe again',
    actionUrl: unsubUrl,
  }));
});

// ── Health ───────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/', (_req, res) => res.send('DryClean Plus Push Service'));

// ── Start ────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Push service on port ${PORT}`));
