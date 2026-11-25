const express = require('express');
const admin = require('firebase-admin');
const { generateInvoicePdfBuffer } = require('./invoice_pdf');

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
const money = (n) => `£${Number(n || 0).toFixed(2)}`;

function parseEmailItems(order = {}) {
  const b = order.bookingData || {};
  const raw = order.countedItems || order.items || order.lines || b.selectedItems || {};
  const arr = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw) : []);
  return arr.map((it) => {
    const qty = Number(it.quantity || it.qty || 1);
    const unit = Number(it.unitPrice ?? it.numericPrice ?? String(it.price || 0).replace(/[^0-9.]/g, '')) || 0;
    const total = Number(it.total ?? it.rowTotal ?? (unit * qty)) || 0;
    return { name: it.itemType || it.name || 'Garment', qty, total };
  });
}

function buildEmailHtml(type, order = {}, id) {
  const b = order.bookingData || {};
  const name = [b.firstName, b.lastName].filter(Boolean).join(' ').trim() || order.customerName || 'Valued Customer';
  const items = parseEmailItems(order);
  const pricing = order.pricing || {};
  const totalNum = Number(pricing.final ?? order.transactionAmount ?? b.totalPrice ?? 0) || items.reduce((s, i) => s + i.total, 0);
  const rowsHtml = items.length
    ? items.map((i) => `<tr><td style="padding:8px 0;border-bottom:1px solid #E5E7EB;">${i.qty}x ${i.name}</td><td style="padding:8px 0;border-bottom:1px solid #E5E7EB;text-align:right;font-weight:bold;">${money(i.total)}</td></tr>`).join('')
    : '<tr><td style="padding:8px 0;color:#6B7280;">Standard laundry & dry cleaning service</td><td style="padding:8px 0;text-align:right;font-weight:bold;">' + money(totalNum) + '</td></tr>';
  const heading = type === 'awaiting_approval'
    ? 'Please approve your updated bill'
    : type === 'delivered'
      ? 'Your order has been delivered'
      : 'Your DryClean Plus booking is confirmed';
  const intro = type === 'awaiting_approval'
    ? `We have checked and itemised your garments for order <b>#${id}</b>. Please open the DryClean Plus app to review and approve your total.`
    : type === 'delivered'
      ? `Your clean clothes for order <b>#${id}</b> have been delivered. Your official PDF receipt &amp; invoice is attached.`
      : `Thank you for your order <b>#${id}</b>. We will collect your garments in your chosen slot.`;

  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#F5F7FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#111827;">
    <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E5E7EB;">
      <div style="background:#0B2A6B;padding:22px 28px;color:#FFFFFF;font-size:20px;font-weight:700;">Dryclean <span style="color:#FFD25E;">Plus+</span></div>
      <div style="padding:28px;">
        <h2 style="margin:0 0 12px;font-size:20px;color:#0B2A6B;">${heading}</h2>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#374151;">Hi ${name},</p>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#374151;">${intro}</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px;">${rowsHtml}
          <tr><td style="padding:12px 0 0;font-weight:700;font-size:16px;">Total</td><td style="padding:12px 0 0;text-align:right;font-weight:700;font-size:16px;color:#0B2A6B;">${money(totalNum)}</td></tr>
        </table>
        <p style="margin:18px 0 0;font-size:13px;color:#6B7280;">Questions? Reply to this email or call +44 7424 866802.</p>
      </div>
      <div style="padding:18px 28px;background:#F9FAFB;border-top:1px solid #E5E7EB;font-size:12px;color:#6B7280;">
        <b>DryClean Plus Ltd</b> · 2c Bar Gate, Newark NG24 1ES, United Kingdom<br>
        dilee@drycleanplus.co.uk · www.drycleanplus.co.uk
      </div>
    </div></body></html>`;
}

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
    const html = buildEmailHtml(type, order, id);

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
