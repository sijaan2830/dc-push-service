const SUPPORT_PHONE = '+44 7424 866802';
const SITE_URL = 'https://drycleanplus.co.uk';
const SUMUP_PAY_URL = 'https://pay.sumup.com/b2c/Q3MO3NEP';

const money = (n) => `£${Number(n || 0).toFixed(2)}`;
const first = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';

function formatCustomerName(order = {}) {
  const b = order.bookingData || {};
  const full = [b.firstName, b.lastName].filter(Boolean).join(' ').trim();
  return full || order.customerName || 'Valued Customer';
}

function formatAddress(order = {}) {
  const b = order.bookingData || {};
  const addr = b.selectedAddress || b.deliveryAddress || order.address || {};
  if (typeof addr === 'string') return addr;
  return [addr.line1, addr.line2, addr.city, addr.postalCode].filter(Boolean).join(', ') || 'On file';
}

function formatDateValue(val, fallback) {
  if (!val) return fallback;
  if (typeof val === 'string') return val;
  if (val._seconds || val.seconds) {
    const ms = (val._seconds || val.seconds) * 1000;
    return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  return String(val);
}

function parseLineItems(order = {}) {
  const b = order.bookingData || {};
  const rawItems = order.countedItems || order.items || order.lines || b.selectedItems || {};
  const list = Array.isArray(rawItems)
    ? rawItems
    : (rawItems && typeof rawItems === 'object' ? Object.values(rawItems) : []);
  return list.map((it) => {
    const qty = Number(it.quantity || it.qty || 1);
    const unit = Number(it.unitPrice ?? it.numericPrice ?? String(it.price || 0).replace(/[^0-9.]/g, '')) || 0;
    const lineTotal = Number(it.total ?? it.rowTotal ?? (unit * qty)) || 0;
    return {
      name: it.itemType || it.name || 'Garment',
      quantity: qty,
      price: money(lineTotal),
      totalNum: lineTotal,
    };
  });
}

function buildItemsRowsHtml(items, fallbackTotal) {
  if (!items || items.length === 0) {
    return `
                <tr>
                  <td align="left" valign="top" style="padding: 12px 12px 12px 0; border-bottom: 1px solid #E3E6EB; font-size: 14px; line-height: 1.5; color: #111827;">Dry Cleaning &amp; Laundry Service</td>
                  <td align="center" valign="top" style="padding: 12px 0; border-bottom: 1px solid #E3E6EB; font-size: 14px; line-height: 1.5; color: #374151;">1</td>
                  <td align="right" valign="top" style="padding: 12px 0; border-bottom: 1px solid #E3E6EB; font-size: 14px; line-height: 1.5; color: #111827;">${money(fallbackTotal)}</td>
                </tr>`;
  }
  return items.map((item) => `
                <tr>
                  <td align="left" valign="top" style="padding: 12px 12px 12px 0; border-bottom: 1px solid #E3E6EB; font-size: 14px; line-height: 1.5; color: #111827;">${item.name}</td>
                  <td align="center" valign="top" style="padding: 12px 0; border-bottom: 1px solid #E3E6EB; font-size: 14px; line-height: 1.5; color: #374151;">${item.quantity}</td>
                  <td align="right" valign="top" style="padding: 12px 0; border-bottom: 1px solid #E3E6EB; font-size: 14px; line-height: 1.5; color: #111827;">${item.price}</td>
                </tr>`).join('');
}

function buildSignatureLogoHtml() {
  return `
                    <a href="${SITE_URL}" style="text-decoration: none; display: inline-block; white-space: nowrap;">
                      <span style="font-family: 'Satisfy', 'Brush Script MT', 'Segoe Script', cursive, Georgia, serif; font-size: 26px; font-weight: bold; font-style: italic; color: #1B5E20; letter-spacing: 0.2px;">Dryclean</span><span style="font-family: 'Satisfy', 'Brush Script MT', 'Segoe Script', cursive, Georgia, serif; font-size: 26px; font-weight: bold; font-style: italic; color: #EF4444; margin-left: 3px;">Plus</span><span style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; font-size: 20px; font-weight: 900; color: #EF4444; margin-left: 2px;">+</span><span style="color: #FACC15; font-size: 14px; margin-left: 4px; vertical-align: middle;">&#10022;</span>
                    </a>`;
}

function buildFooterHtml() {
  return `
          <tr>
            <td class="px" bgcolor="#FFFFFF" style="padding: 26px 40px 28px; background-color: #FFFFFF; border-top: 1px solid #E3E6EB; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.7; color: #6B7280;">
              <div style="font-weight: bold; color: #374151;">DryClean Plus Ltd</div>
              <div>2c Bar Gate, Newark NG24 1ES, United Kingdom · dilee@drycleanplus.co.uk · ${SUPPORT_PHONE}</div>
              <div style="padding-top: 4px;">
                <a href="${SITE_URL}" style="color: #0B2A6B; text-decoration: underline;">drycleanplus.co.uk</a>
              </div>
              <div style="padding-top: 10px;">You’re receiving this email because you placed an order with DryClean Plus.</div>
            </td>
          </tr>`;
}

function buildDeliveredHtml(order = {}, id = '') {
  const b = order.bookingData || {};
  const customerName = formatCustomerName(order);
  const address = formatAddress(order);
  const trackUrl = `${SITE_URL}/track/${encodeURIComponent(id)}`;
  const todayStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const deliveryDate = formatDateValue(order.deliveredAt, b.deliveryDate || todayStr);
  const paymentMethod = order.paymentMethod || b.paymentMethod || 'Card on Delivery';

  const items = parseLineItems(order);
  const itemsSum = items.reduce((sum, i) => sum + i.totalNum, 0);
  const subtotalNum = Number(order.subtotal ?? order.pricing?.subtotal ?? b.totalPrice ?? itemsSum) || 0;
  const deliveryFeeNum = Number(order.deliveryFee ?? order.serviceFee ?? 0) || 0;
  const vatNum = Number(order.vatAmount ?? 0) || 0;
  const totalNum = Number(order.transactionAmount ?? order.totalAmount ?? order.pricing?.final ?? (subtotalNum + deliveryFeeNum + vatNum)) || 0;

  const subtotal = money(subtotalNum || totalNum);
  const deliveryFee = deliveryFeeNum === 0 ? 'Free' : money(deliveryFeeNum);
  const vatAmount = vatNum === 0 ? '£0.00' : money(vatNum);
  const totalAmount = money(totalNum);
  const itemRows = buildItemsRowsHtml(items, totalNum);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <link href="https://fonts.googleapis.com/css2?family=Satisfy&display=swap" rel="stylesheet">
  <title>Your DryClean Plus receipt, order #${id}</title>
  <style>
    @media only screen and (max-width: 480px) {
      .px { padding-left: 24px !important; padding-right: 24px !important; }
      .h1 { font-size: 23px !important; }
      .stack { display: block !important; width: 100% !important; padding-right: 0 !important; }
      .total-figure { font-size: 24px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #FFFFFF; -webkit-text-size-adjust: 100%;">
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; mso-hide: all; font-size: 1px; line-height: 1px; color: #FFFFFF;">
    Order #${id} was delivered on ${deliveryDate}. Your receipt for ${totalAmount} is below.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="background-color: #FFFFFF;">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width: 100%; max-width: 600px; background-color: #FFFFFF; border: 1px solid #E5E7EB;">
          <tr><td height="4" bgcolor="#0B2A6B" style="height: 4px; font-size: 0; line-height: 0; background-color: #0B2A6B;">&nbsp;</td></tr>
          <tr>
            <td class="px" style="padding: 28px 40px 26px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" valign="middle">${buildSignatureLogoHtml()}</td>
                  <td align="right" valign="middle" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 13px; line-height: 1.5; color: #6B7280;">
                    Receipt<br><span style="font-size: 14px; font-weight: bold; color: #111827;">INV-${id}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding: 6px 40px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
              <h1 class="h1" style="margin: 0 0 18px; font-family: Georgia, 'Times New Roman', serif; font-size: 28px; line-height: 1.2; font-weight: normal; color: #111827;">Your order has been delivered</h1>
              <p style="margin: 0 0 12px; font-size: 15px; line-height: 1.65; color: #374151;">Hello ${customerName},</p>
              <p style="margin: 0 0 30px; font-size: 15px; line-height: 1.65; color: #374151;">Your garments for order #${id} were delivered on ${deliveryDate}. Your receipt is below. Please keep it for your records.</p>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding: 0 40px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top: 1px solid #E3E6EB; border-bottom: 1px solid #E3E6EB;">
                <tr>
                  <td class="stack" valign="top" width="50%" style="padding: 18px 16px 6px 0;"><div style="font-size: 12px; color: #6B7280;">Order number</div><div style="font-size: 14px; color: #111827;">#${id}</div></td>
                  <td class="stack" valign="top" width="50%" style="padding: 18px 0 6px;"><div style="font-size: 12px; color: #6B7280;">Delivered on</div><div style="font-size: 14px; color: #111827;">${deliveryDate}</div></td>
                </tr>
                <tr>
                  <td class="stack" valign="top" width="50%" style="padding: 12px 16px 18px 0;"><div style="font-size: 12px; color: #6B7280;">Delivered to</div><div style="font-size: 14px; color: #111827;">${address}</div></td>
                  <td class="stack" valign="top" width="50%" style="padding: 12px 0 18px;"><div style="font-size: 12px; color: #6B7280;">Payment</div><div style="font-size: 14px; color: #111827;">${paymentMethod}</div><div style="font-size: 14px; font-weight: bold; color: #1A7F5A;">Paid in full</div></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding: 28px 40px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" style="padding: 0 0 10px; border-bottom: 1px solid #0B2A6B; font-size: 13px; font-weight: bold; color: #0B2A6B;">Service</td>
                  <td align="center" width="60" style="padding: 0 0 10px; border-bottom: 1px solid #0B2A6B; font-size: 13px; font-weight: bold; color: #0B2A6B;">Qty</td>
                  <td align="right" width="100" style="padding: 0 0 10px; border-bottom: 1px solid #0B2A6B; font-size: 13px; font-weight: bold; color: #0B2A6B;">Amount</td>
                </tr>
                ${itemRows}
              </table>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding: 14px 40px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td align="left" style="padding: 4px 0; font-size: 14px; color: #6B7280;">Subtotal</td><td align="right" style="padding: 4px 0; font-size: 14px; color: #111827;">${subtotal}</td></tr>
                <tr><td align="left" style="padding: 4px 0; font-size: 14px; color: #6B7280;">Delivery</td><td align="right" style="padding: 4px 0; font-size: 14px; color: #111827;">${deliveryFee}</td></tr>
                <tr><td align="left" style="padding: 4px 0 14px; font-size: 14px; color: #6B7280;">VAT</td><td align="right" style="padding: 4px 0 14px; font-size: 14px; color: #111827;">${vatAmount}</td></tr>
                <tr>
                  <td align="left" valign="middle" style="padding: 16px 0; border-top: 2px solid #0B2A6B; font-size: 15px; font-weight: bold; color: #111827;">Total paid</td>
                  <td align="right" valign="middle" class="total-figure" style="padding: 16px 0; border-top: 2px solid #0B2A6B; font-family: Georgia, 'Times New Roman', serif; font-size: 28px; color: #0B2A6B;">${totalAmount}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="px" align="left" style="padding: 12px 40px 8px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="#0B2A6B" style="background-color: #0B2A6B; border-radius: 4px;">
                    <a href="${trackUrl}" style="display: inline-block; padding: 13px 28px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; font-weight: bold; color: #FFFFFF; text-decoration: none;">Track / View order</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding: 22px 40px 40px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.65; color: #374151;">
              <p style="margin: 0 0 14px;">If anything isn’t right with your order, reply to this email or call us on ${SUPPORT_PHONE}.</p>
              <p style="margin: 0;">Thank you for choosing DryClean Plus.</p>
            </td>
          </tr>
          ${buildFooterHtml()}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildApprovalHtml(order = {}, id = '') {
  const b = order.bookingData || {};
  const customerName = formatCustomerName(order);
  const address = formatAddress(order);
  const trackUrl = `${SITE_URL}/track/${encodeURIComponent(id)}`;

  const items = parseLineItems(order);
  const itemsSum = items.reduce((sum, i) => sum + i.totalNum, 0);
  const subtotalNum = Number(order.subtotal ?? order.pricing?.subtotal ?? b.totalPrice ?? itemsSum) || 0;
  const discountNum = Number(order.discountAmount ?? b.discountAmount ?? 0) || 0;
  const serviceFeeNum = Number(order.serviceFee ?? order.deliveryFee ?? 0) || 0;
  const totalNum = Number(order.transactionAmount ?? order.totalAmount ?? order.pricing?.final ?? (subtotalNum - discountNum + serviceFeeNum)) || 0;

  const subtotal = money(subtotalNum);
  const serviceFee = serviceFeeNum === 0 ? 'Free' : money(serviceFeeNum);
  const totalAmount = money(totalNum);
  const itemRows = buildItemsRowsHtml(items, totalNum);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <link href="https://fonts.googleapis.com/css2?family=Satisfy&display=swap" rel="stylesheet">
  <title>Please approve updated order #${id} · DryClean Plus</title>
  <style>
    @media only screen and (max-width: 480px) {
      .px { padding-left: 24px !important; padding-right: 24px !important; }
      .h1 { font-size: 23px !important; }
      .stack { display: block !important; width: 100% !important; padding-right: 0 !important; }
      .total-figure { font-size: 24px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #FFFFFF; -webkit-text-size-adjust: 100%;">
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; mso-hide: all; font-size: 1px; line-height: 1px; color: #FFFFFF;">
    Inspection complete for order #${id}. Updated total: ${totalAmount}. Please review and approve to begin cleaning.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="background-color: #FFFFFF;">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width: 100%; max-width: 600px; background-color: #FFFFFF; border: 1px solid #E5E7EB;">
          <tr><td height="4" bgcolor="#0B2A6B" style="height: 4px; font-size: 0; line-height: 0; background-color: #0B2A6B;">&nbsp;</td></tr>
          <tr>
            <td class="px" style="padding: 28px 40px 26px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" valign="middle">${buildSignatureLogoHtml()}</td>
                  <td align="right" valign="middle" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 13px; line-height: 1.5; color: #6B7280;">
                    Order Update<br><span style="font-size: 14px; font-weight: bold; color: #111827;">#${id}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding: 6px 40px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
              <h1 class="h1" style="margin: 0 0 18px; font-family: Georgia, 'Times New Roman', serif; font-size: 28px; line-height: 1.2; font-weight: normal; color: #111827;">Please approve your updated order</h1>
              <p style="margin: 0 0 12px; font-size: 15px; line-height: 1.65; color: #374151;">Hello ${customerName},</p>
              <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.65; color: #374151;">Your garments for order #${id} have been counted and inspected at our facility. Please review the itemised total below — you can pay online via SumUp or pay by Cash/Card on delivery.</p>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding: 0 40px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top: 1px solid #E3E6EB; border-bottom: 1px solid #E3E6EB;">
                <tr>
                  <td class="stack" valign="top" width="50%" style="padding: 16px 16px 16px 0;"><div style="font-size: 12px; color: #6B7280;">Order number</div><div style="font-size: 14px; color: #111827;">#${id}</div></td>
                  <td class="stack" valign="top" width="50%" style="padding: 16px 0;"><div style="font-size: 12px; color: #6B7280;">Collection address</div><div style="font-size: 14px; color: #111827;">${address}</div></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding: 28px 40px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" style="padding: 0 0 10px; border-bottom: 1px solid #0B2A6B; font-size: 13px; font-weight: bold; color: #0B2A6B;">Service</td>
                  <td align="center" width="60" style="padding: 0 0 10px; border-bottom: 1px solid #0B2A6B; font-size: 13px; font-weight: bold; color: #0B2A6B;">Qty</td>
                  <td align="right" width="100" style="padding: 0 0 10px; border-bottom: 1px solid #0B2A6B; font-size: 13px; font-weight: bold; color: #0B2A6B;">Amount</td>
                </tr>
                ${itemRows}
              </table>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding: 14px 40px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td align="left" style="padding: 4px 0; font-size: 14px; color: #6B7280;">Subtotal</td><td align="right" style="padding: 4px 0; font-size: 14px; color: #111827;">${subtotal}</td></tr>
                ${discountNum > 0 ? `<tr><td align="left" style="padding: 4px 0; font-size: 14px; color: #1A7F5A;">Discount</td><td align="right" style="padding: 4px 0; font-size: 14px; color: #1A7F5A;">-${money(discountNum)}</td></tr>` : ''}
                <tr><td align="left" style="padding: 4px 0 14px; font-size: 14px; color: #6B7280;">Service &amp; delivery</td><td align="right" style="padding: 4px 0 14px; font-size: 14px; color: #111827;">${serviceFee}</td></tr>
                <tr>
                  <td align="left" valign="middle" style="padding: 16px 0; border-top: 2px solid #0B2A6B; font-size: 15px; font-weight: bold; color: #111827;">Updated total</td>
                  <td align="right" valign="middle" class="total-figure" style="padding: 16px 0; border-top: 2px solid #0B2A6B; font-family: Georgia, 'Times New Roman', serif; font-size: 28px; color: #0B2A6B;">${totalAmount}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="px" align="left" style="padding: 12px 40px 8px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="#0B2A6B" style="background-color: #0B2A6B; border-radius: 4px;">
                    <a href="${trackUrl}" style="display: inline-block; padding: 13px 22px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; font-weight: bold; color: #FFFFFF; text-decoration: none;">Track / View order</a>
                  </td>
                  <td width="10">&nbsp;</td>
                  <td align="center" bgcolor="#1A7F5A" style="background-color: #1A7F5A; border-radius: 4px;">
                    <a href="${SUMUP_PAY_URL}" style="display: inline-block; padding: 13px 22px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; font-weight: bold; color: #FFFFFF; text-decoration: none;">Pay online (SumUp)</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding: 22px 40px 40px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.65; color: #374151;">
              <p style="margin: 0 0 14px;">If you have any questions about the items counted, reply to this email or call us on ${SUPPORT_PHONE}.</p>
              <p style="margin: 0;">Thank you for choosing DryClean Plus.</p>
            </td>
          </tr>
          ${buildFooterHtml()}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildConfirmationHtml(order = {}, id = '') {
  const b = order.bookingData || {};
  const customerName = formatCustomerName(order);
  const address = formatAddress(order);
  const trackUrl = `${SITE_URL}/track/${encodeURIComponent(id)}`;
  const collectionSlot = [b.collectionDate || 'Pending', b.collectionTime].filter(Boolean).join(', ');
  const deliverySlot = [b.deliveryDate || '24–48 hours', b.deliveryTime].filter(Boolean).join(', ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <link href="https://fonts.googleapis.com/css2?family=Satisfy&display=swap" rel="stylesheet">
  <title>Booking confirmed, order #${id} · DryClean Plus</title>
  <style>
    @media only screen and (max-width: 480px) {
      .px { padding-left: 24px !important; padding-right: 24px !important; }
      .h1 { font-size: 23px !important; }
      .stack { display: block !important; width: 100% !important; padding-right: 0 !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #FFFFFF; -webkit-text-size-adjust: 100%;">
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; mso-hide: all; font-size: 1px; line-height: 1px; color: #FFFFFF;">
    Booking confirmed for order #${id}. Collection scheduled for ${collectionSlot}.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="background-color: #FFFFFF;">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width: 100%; max-width: 600px; background-color: #FFFFFF; border: 1px solid #E5E7EB;">
          <tr><td height="4" bgcolor="#0B2A6B" style="height: 4px; font-size: 0; line-height: 0; background-color: #0B2A6B;">&nbsp;</td></tr>
          <tr>
            <td class="px" style="padding: 28px 40px 26px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" valign="middle">${buildSignatureLogoHtml()}</td>
                  <td align="right" valign="middle" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 13px; line-height: 1.5; color: #6B7280;">
                    Booking<br><span style="font-size: 14px; font-weight: bold; color: #111827;">#${id}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding: 6px 40px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
              <h1 class="h1" style="margin: 0 0 18px; font-family: Georgia, 'Times New Roman', serif; font-size: 28px; line-height: 1.2; font-weight: normal; color: #111827;">Your booking is confirmed</h1>
              <p style="margin: 0 0 12px; font-size: 15px; line-height: 1.65; color: #374151;">Hello ${first(customerName)},</p>
              <p style="margin: 0 0 30px; font-size: 15px; line-height: 1.65; color: #374151;">Thank you for booking with DryClean Plus. We have scheduled our driver to collect your garments at the time below.</p>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding: 0 40px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top: 1px solid #E3E6EB; border-bottom: 1px solid #E3E6EB;">
                <tr>
                  <td class="stack" valign="top" width="50%" style="padding: 18px 16px 6px 0;"><div style="font-size: 12px; color: #6B7280;">Order number</div><div style="font-size: 14px; color: #111827;">#${id}</div></td>
                  <td class="stack" valign="top" width="50%" style="padding: 18px 0 6px;"><div style="font-size: 12px; color: #6B7280;">Collection slot</div><div style="font-size: 14px; color: #111827;">${collectionSlot}</div></td>
                </tr>
                <tr>
                  <td class="stack" valign="top" width="50%" style="padding: 12px 16px 18px 0;"><div style="font-size: 12px; color: #6B7280;">Collection address</div><div style="font-size: 14px; color: #111827;">${address}</div></td>
                  <td class="stack" valign="top" width="50%" style="padding: 12px 0 18px;"><div style="font-size: 12px; color: #6B7280;">Estimated delivery</div><div style="font-size: 14px; color: #111827;">${deliverySlot}</div></td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="px" align="left" style="padding: 28px 40px 8px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="#0B2A6B" style="background-color: #0B2A6B; border-radius: 4px;">
                    <a href="${trackUrl}" style="display: inline-block; padding: 13px 28px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; font-weight: bold; color: #FFFFFF; text-decoration: none;">Track order live</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding: 22px 40px 40px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.65; color: #374151;">
              <p style="margin: 0 0 14px;">Simply place your items in any disposable bag for collection. If you need to change your slot, reply to this email or call us on ${SUPPORT_PHONE}.</p>
              <p style="margin: 0;">Thank you for choosing DryClean Plus.</p>
            </td>
          </tr>
          ${buildFooterHtml()}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = { buildDeliveredHtml, buildApprovalHtml, buildConfirmationHtml };
