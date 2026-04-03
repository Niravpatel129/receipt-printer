const path = require('path');
const fs = require('fs');

const RECEIPT_HEADER_PNG = path.join(__dirname, '..', '..', 'assets', 'receipt-header.png');

function drawDashed(printer) {
  printer.drawLine('-');
}

function drawSolid(printer) {
  printer.drawLine('=');
}

const WEBSITE = 'PIZZADEPOT.CA';
const FEEDBACK_URL = 'PIZZADEPOT.CA/FEEDBACK';
const COMMENTARY = 'YOU HAD OPTIONS. YOU CHOSE CORRECTLY.';
const FOOTER_SIGN = 'COME BACK HUNGRY.';
const FOOTER_PRIDE = 'PROUDLY CANADIAN  -  50+ LOCATIONS';
const FOOTER_LEGAL = 'KEEP RECEIPT FOR ORDER DISPUTES.';

const DEFAULT_RECEIPT = {
  storeName: 'PIZZA DEPOT',
  storeAddress: '4525 EBENEZER RD.',
  storeCity: 'BRAMPTON, ON',
  storePhone: '(905) 204-9711',
  orderNumber: 'PD-20847',
  orderType: 'DELIVERY',
  date: 'MAR 23, 2026',
  time: '7:14 PM',
  driver: 'ARJUN K.',
  eta: '7:42 PM',
  customerName: 'NEHAL JOGANI',
  customerPhone: '416-555-0192',
  items: [
    {
      qty: '01',
      name: 'CLASSIC MEAL',
      amount: '19.99',
      modifiers: {
        SIZE: 'X-LARGE',
        CRUST: 'THIN',
        SAUCE: 'BUTTER CHICKEN',
        FULL: 'MUSHROOM / ONION / GREEN PEPPER / ACHARI PANEER / TANDOORI CHICKEN / CORIANDER / GREEN CHILLIES / CHILLI FLAKES / GINGER / GARLIC',
        LEFT: '-',
        RIGHT: '-',
        FINISH: 'STANDARD',
        INCL: 'CREAMY GARLIC DIP',
      },
    },
    { qty: '02', name: 'CREAMY GARLIC DIP', amount: '1.49' },
    { qty: '03', name: 'GARLIC BREAD + CHEESE', amount: '1.49' },
    { qty: '04', name: 'PEPSI CAN', amount: '1.49' },
  ],
  itemCount: '4',
  subtotal: '$ 24.46',
  tax: '$ 3.18',
  delivery: '$ 2.99',
  tip: null,
  total: '$ 30.63',
  cardLastFour: '4821',
  authCode: '867324',
  userId: 'NEHAL J',
  rewardPoints: '+31',
  rewardProgress: '31 / 100 PTS TO NEXT FREE PIZZA.',
  rewardNudge: "THAT'S LITERALLY ONE MORE VISIT.",
  rewardCode: 'DEPOT-8821-K',
  commentaryLine: COMMENTARY,
  footerSign: FOOTER_SIGN,
  website: WEBSITE,
  barcode: 'PD-20847',
};

function wordWrap(str, width = 38) {
  const source = String(str || '');
  const words = source.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if (`${current} ${word}`.trim().length > width) {
      if (current) {
        lines.push(current.trim());
      }
      current = word;
    } else {
      current = `${current} ${word}`.trim();
    }
  }
  if (current) {
    lines.push(current.trim());
  }
  return lines.length ? lines : [''];
}

function padLabel(label, width = 7) {
  return String(label || '').padEnd(width, ' ');
}

function toMoneyString(value, fallback = '') {
  if (value == null || value === '') return fallback;
  const raw = String(value).trim();
  if (!raw) return fallback;
  if (raw.includes('$')) return raw;
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return `$ ${n.toFixed(2)}`;
}

function amountValue(value) {
  if (value == null || value === '') return Number.NaN;
  const n = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : Number.NaN;
}

function asStringArray(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (value == null) return [];
  const s = String(value).trim();
  return s ? [s] : [];
}

function normalizeModifierGroups(modifiers) {
  if (!modifiers || typeof modifiers !== 'object' || Array.isArray(modifiers)) return null;
  const out = {};
  for (const [key, value] of Object.entries(modifiers)) {
    const values = asStringArray(value);
    if (values.length) out[key] = values;
  }
  return Object.keys(out).length ? out : null;
}

function fromSource(source, key, fallback = '') {
  if (!source || typeof source !== 'object') return fallback;
  return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : fallback;
}

function normalizeItem(item, index) {
  const qty = item.qty || item.num || item.quantity || String(index + 1).padStart(2, '0');
  const name = String(item.name || 'ITEM').toUpperCase();
  const amount = item.amount ?? item.price ?? '0.00';
  const groupedModifiers = normalizeModifierGroups(item.modifiers);
  const toppings = groupedModifiers
    ? asStringArray(item.toppings)
    : asStringArray(item.toppings || item.optionsDisplay || item.options || item.modifiers);
  return {
    ...item,
    qty: String(qty),
    num: String(qty),
    name,
    amount: String(amount),
    modifiers: groupedModifiers || undefined,
    toppings: toppings.length ? toppings : undefined,
  };
}

async function buildReceipt(printer, data = null) {
  const source =
    data && typeof data === 'object' && data.receipt && typeof data.receipt === 'object'
      ? { ...data, ...data.receipt }
      : data;
  const merged =
    source && typeof source === 'object'
      ? { ...DEFAULT_RECEIPT, ...source }
      : { ...DEFAULT_RECEIPT };
  const normalizedItems = (merged.items || []).map(normalizeItem);
  const d = {
    ...merged,
    storeAddress: merged.storeAddress || merged.address || DEFAULT_RECEIPT.storeAddress,
    storeCity: merged.storeCity || merged.city || DEFAULT_RECEIPT.storeCity,
    orderType: merged.orderType || 'DELIVERY',
    time: merged.time || '7:14 PM',
    customerName: merged.customerName || 'VALUED CUSTOMER',
    customerPhone: merged.customerPhone || '000-000-0000',
    itemCount: merged.itemCount || String(normalizedItems.length),
    barcode: merged.barcode || merged.orderNumber || DEFAULT_RECEIPT.barcode,
    subtotal: toMoneyString(merged.subtotal, DEFAULT_RECEIPT.subtotal),
    tax: toMoneyString(merged.tax, DEFAULT_RECEIPT.tax),
    delivery: toMoneyString(merged.delivery ?? merged.deliveryFee, ''),
    tip: toMoneyString(merged.tip, ''),
    total: toMoneyString(merged.total, DEFAULT_RECEIPT.total),
    website: merged.website || DEFAULT_RECEIPT.website,
    footerSign: merged.footerSign || merged.footerMessage || DEFAULT_RECEIPT.footerSign,
    cardLastFour: merged.cardLastFour ? String(merged.cardLastFour).slice(-4) : '',
    authCode: merged.authCode ? String(merged.authCode) : '',
    userId: merged.userId ? String(merged.userId) : '',
    rewardPoints: fromSource(source, 'rewardPoints', ''),
    rewardProgress: fromSource(source, 'rewardProgress', ''),
    rewardNudge: fromSource(source, 'rewardNudge', ''),
    rewardCode: fromSource(source, 'rewardCode', ''),
    items: normalizedItems,
  };

  printer.alignCenter();
  if (fs.existsSync(RECEIPT_HEADER_PNG)) {
    await printer.printImage(RECEIPT_HEADER_PNG);
    printer.newLine();
  }
  printer.setTextDoubleHeight();
  printer.bold(true);
  printer.println(d.storeName);
  printer.bold(false);
  printer.setTextNormal();
  printer.println(d.storeAddress);
  printer.println(d.storeCity);
  if (d.storePhone) {
    printer.println(d.storePhone);
  }
  drawDashed(printer);

  printer.alignLeft();
  printer.newLine();
  printer.bold(false);
  printer.leftRight('ORDER ID', `#${d.orderNumber}`);
  printer.bold(true);
  printer.leftRight('CUSTOMER', d.customerName);
  printer.bold(false);
  printer.leftRight('PHONE', d.customerPhone);
  printer.newLine();
  printer.leftRight('DATE', d.date);
  printer.leftRight('TIME', d.time);
  if (d.driver) {
    printer.leftRight('DRIVER', d.driver);
  }
  if (d.eta) {
    printer.leftRight('ETA', d.eta);
  }
  printer.newLine();
  drawDashed(printer);

  printer.alignCenter();
  printer.bold(true);
  printer.println(`[ ${d.orderType} ]`);
  printer.bold(false);
  drawDashed(printer);
  printer.newLine();

  printer.alignLeft();
  for (const item of d.items) {
    printer.bold(true);
    printer.leftRight(`${item.qty}  ${item.name}`, `$${item.amount}`);
    printer.bold(false);

    if (item.modifiers) {
      const MOD_ORDER = ['SIZE', 'CRUST', 'SAUCE', 'FULL', 'LEFT', 'RIGHT', 'FINISH', 'INCL'];
      for (const key of MOD_ORDER) {
        const val = item.modifiers[key];
        if (val === undefined) {
          continue;
        }
        const label = `   ${padLabel(key)}`;
        const lines = wordWrap(Array.isArray(val) ? val.join(' / ') : val, 30);
        printer.println(`${label}${lines[0]}`);
        const indent = ' '.repeat(label.length);
        for (let i = 1; i < lines.length; i += 1) {
          printer.println(`${indent}${lines[i]}`);
        }
      }
    }

    if (!item.modifiers && item.toppings) {
      for (const topping of item.toppings) {
        printer.println(`   ${topping}`);
      }
    }

    printer.newLine();
  }

  drawDashed(printer);

  printer.leftRight('ITEM COUNT', d.itemCount);
  printer.newLine();
  if (d.subtotal) {
    printer.leftRight('SUBTOTAL', d.subtotal);
  }
  if (d.tax) {
    printer.leftRight('TAX (HST)', d.tax);
  }
  if (amountValue(d.delivery) > 0) {
    printer.leftRight('DELIVERY', d.delivery);
  }
  if (amountValue(d.tip) > 0) {
    printer.leftRight('TIP', d.tip);
  }

  printer.newLine();
  drawSolid(printer);
  printer.bold(true);
  printer.leftRight('TOTAL', d.total);
  printer.bold(false);
  drawDashed(printer);

  printer.leftRight(`CARD #: **** **** **** ${d.cardLastFour}`, '');
  if (d.authCode) {
    printer.leftRight(`AUTH #: ${d.authCode}`, '');
  }
  printer.leftRight(`USERID: ${d.userId}`, 'PAID ✓');
  printer.newLine();
  drawDashed(printer);

  printer.alignCenter();
  printer.println(d.commentaryLine || COMMENTARY);
  const hasRewardsData =
    (d.rewardPoints != null && d.rewardPoints !== '') || d.rewardProgress || d.rewardNudge || d.rewardCode;
  if (hasRewardsData) {
    drawDashed(printer);
    printer.newLine();
    drawDashed(printer);
    printer.bold(true);
    printer.println('PD REWARDS');
    printer.bold(false);
    drawDashed(printer);
    printer.newLine();
    if (d.rewardPoints != null && d.rewardPoints !== '') {
      printer.bold(true);
      printer.setTextDoubleHeight();
      printer.println(d.rewardPoints);
      printer.setTextNormal();
      printer.bold(false);
      printer.println('POINTS EARNED THIS ORDER');
      printer.newLine();
    }
    if (d.rewardProgress) {
      printer.println(d.rewardProgress);
    }
    if (d.rewardNudge) {
      printer.println(d.rewardNudge);
    }
    if (d.rewardCode) {
      printer.newLine();
      printer.bold(true);
      printer.println(`[ ${d.rewardCode} ]`);
      printer.bold(false);
    }
    drawDashed(printer);
    printer.newLine();
  }

  printer.code128(d.barcode, { height: 50, text: 0 });
  printer.newLine();

  printer.bold(true);
  printer.println(d.footerSign || FOOTER_SIGN);
  printer.bold(false);
  printer.newLine();
  printer.println('FEEDBACK? WE ACTUALLY WANT IT.');
  printer.println(FEEDBACK_URL);
  printer.newLine();
  printer.println(FOOTER_PRIDE);
  printer.newLine();
  printer.println(d.website || WEBSITE);
  printer.newLine();
  printer.println(FOOTER_LEGAL);
  printer.newLine();

  printer.cut();
}

module.exports = { buildReceipt, drawDashed, drawSolid, DEFAULT_RECEIPT };
