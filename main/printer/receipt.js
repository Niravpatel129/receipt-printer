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

const RECEIPT_LINE_WIDTH = 42;
const MOD_BLOCK_INDENT = 3;
const MOD_LABEL_COL_WIDTH = 9;
const MOD_LABEL_GUTTER = 1;

const MOD_HEADER_KEYS = new Set(['SIZE', 'CRUST', 'SAUCE']);
const MOD_TAIL_KEYS = new Set(['FINISH', 'INCL', 'INCL.']);
const MOD_INSTRUCTION_KEYS = new Set([
  'SPECIAL INSTRUCTIONS',
  'SPECIAL',
  'NOTES',
  'INSTRUCTIONS',
  'COMMENT',
  'ORDER NOTES',
  'REQUEST',
  'CUSTOMER NOTE',
]);

function normModKey(key) {
  return String(key || '')
    .toUpperCase()
    .trim();
}

function formatModifierLabel(key) {
  const k = normModKey(key);
  return k === 'INCL' ? 'INCL.' : k;
}

function orderTypeShortCode(orderType) {
  const t = String(orderType || '').toUpperCase();
  if (t.includes('PICK')) return 'PU';
  if (t.includes('DELIV')) return 'DL';
  if (t.includes('DINE')) return 'DI';
  return '';
}

function isRedundantRegularCheese(key, rawVal) {
  if (normModKey(key) !== 'CHEESE') return false;
  const v = Array.isArray(rawVal) ? rawVal.join(' ') : String(rawVal);
  const u = v.toUpperCase().replace(/\s+/g, ' ').trim();
  return (
    u === 'REGULAR CHEESE' ||
    u === 'REGULAR' ||
    u === 'CHEESE' ||
    u === 'NORMAL CHEESE' ||
    u === 'REGULAR CHEESE - NORMAL'
  );
}

function instructionTextForItem(item, receiptLevel) {
  const uniq = new Set();
  for (const s of [
    item && item.specialInstructions,
    item && item.orderSpecialInstructions,
    receiptLevel,
  ]) {
    const t = String(s || '').trim();
    if (t) uniq.add(t);
  }
  return [...uniq].join(' ');
}

function applyBeefAnchovySwap(instructionText, pieces) {
  const instr = String(instructionText || '').toUpperCase();
  const wantsAnchovy = /ANCHOV/.test(instr);
  const swapBeef =
    /INSTEAD\s+OF\s+BEEF|NO\s+BEEF|NOT\s+BEEF|SUB\s+BEEF|REPLACE\s+BEEF|BEEF.*ANCHOV|ANCHOV.*BEEF/.test(
      instr,
    );
  if (!wantsAnchovy || !swapBeef) return pieces;
  const out = pieces.filter((p) => !/GROUND\s*BEEF|BEEF\s+TOPPING|^BEEF\s+-/i.test(p));
  const hasAnchovy = out.some((p) => /ANCHOV/i.test(p));
  if (!hasAnchovy) out.push('ANCHOVIES');
  return out;
}

function flattenModifierValues(key, rawVal) {
  const k = normModKey(key);
  if (Array.isArray(rawVal)) {
    return rawVal.map((v) => String(v).trim()).filter(Boolean);
  }
  const s = String(rawVal || '').trim();
  if (!s) return [];
  if (k === 'FULL' || k === 'LEFT' || k === 'RIGHT') {
    return s.split(/\s*\/\s*/).map((x) => x.trim()).filter(Boolean);
  }
  return [s];
}

function collectToppingPieces(modifiers) {
  if (!modifiers || typeof modifiers !== 'object') return [];
  const pieces = [];
  for (const key of Object.keys(modifiers)) {
    const nk = normModKey(key);
    if (MOD_HEADER_KEYS.has(nk) || MOD_TAIL_KEYS.has(nk) || MOD_INSTRUCTION_KEYS.has(nk)) continue;
    if (isRedundantRegularCheese(key, modifiers[key])) continue;
    pieces.push(...flattenModifierValues(key, modifiers[key]));
  }
  return pieces;
}

function titleCasePhrase(s) {
  return String(s)
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function humanizeModifierKey(key) {
  return titleCasePhrase(String(key || '').trim().replace(/_/g, ' '));
}

function narrativeValueString(val) {
  if (Array.isArray(val)) return val.map((v) => String(v).trim()).filter(Boolean).join(', ');
  return String(val || '').trim();
}

function orderedModifierEntries(modifiers) {
  if (!modifiers || typeof modifiers !== 'object') return [];
  const m = modifiers;
  const order = [];
  const used = new Set();
  const keyForCanon = (canon) => {
    const e = Object.entries(m).find(([k]) => normModKey(k) === canon);
    return e ? e[0] : null;
  };
  const take = (canon) => {
    const k = keyForCanon(canon);
    if (!k || used.has(k) || m[k] === undefined) return;
    order.push([k, m[k]]);
    used.add(k);
  };
  take('SIZE');
  take('CRUST');
  take('SAUCE');
  for (const key of Object.keys(m)) {
    if (used.has(key)) continue;
    if (MOD_INSTRUCTION_KEYS.has(normModKey(key))) {
      order.push([key, m[key]]);
      used.add(key);
    }
  }
  for (const key of Object.keys(m)) {
    if (used.has(key)) continue;
    const nk = normModKey(key);
    if (nk === 'FINISH' || nk === 'INCL' || nk === 'INCL.') continue;
    order.push([key, m[key]]);
    used.add(key);
  }
  take('FINISH');
  const inclEntry = Object.entries(m).find(([k]) => {
    const nk = normModKey(k);
    return nk === 'INCL' || nk === 'INCL.';
  });
  if (inclEntry && !used.has(inclEntry[0])) {
    order.push(inclEntry);
    used.add(inclEntry[0]);
  }
  return order;
}

function modifierNarrativeSummary(modifiers) {
  const parts = [];
  for (const [key, val] of orderedModifierEntries(modifiers)) {
    const raw = narrativeValueString(val);
    if (!raw) continue;
    parts.push(`${humanizeModifierKey(key)}: ${titleCasePhrase(raw)}`);
  }
  return parts.join(', ');
}

function printWrappedNarrative(printer, text) {
  const t = String(text || '').trim();
  if (!t) return;
  printer.bold(false);
  for (const line of wordWrap(t, RECEIPT_LINE_WIDTH)) {
    printer.println(line);
  }
}

function printModifierGroupBorder(printer) {
  printer.bold(false);
  printer.println(`${' '.repeat(MOD_BLOCK_INDENT)}${'-'.repeat(Math.max(8, RECEIPT_LINE_WIDTH - MOD_BLOCK_INDENT))}`);
}

function rightAlignInColumn(text, width) {
  const s = String(text);
  if (s.length >= width) return s.slice(0, width);
  return ' '.repeat(width - s.length) + s;
}

function printModifierRows(printer, key, rawVal) {
  const labelCol = rightAlignInColumn(formatModifierLabel(key), MOD_LABEL_COL_WIDTH);
  const valueText = Array.isArray(rawVal) ? rawVal.join(' / ') : String(rawVal);
  const prefix = ' '.repeat(MOD_BLOCK_INDENT);
  const valueWidth = RECEIPT_LINE_WIDTH - MOD_BLOCK_INDENT - MOD_LABEL_COL_WIDTH - MOD_LABEL_GUTTER;
  const lines = wordWrap(valueText, valueWidth);
  const gap = ' '.repeat(MOD_LABEL_GUTTER);
  const contIndent = prefix + ' '.repeat(MOD_LABEL_COL_WIDTH + MOD_LABEL_GUTTER);

  printer.bold(false);
  printer.print(`${prefix}${labelCol}${gap}`);
  printer.bold(true);
  printer.println(lines[0]);
  for (let i = 1; i < lines.length; i += 1) {
    printer.bold(false);
    printer.print(contIndent);
    printer.bold(true);
    printer.println(lines[i]);
  }
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
  const specialInstructions = String(
    item.specialInstructions || item.specialInstruction || item.instructions || '',
  ).trim();
  const orderSpecialInstructions = String(item.orderSpecialInstructions || '').trim();
  return {
    ...item,
    qty: String(qty),
    num: String(qty),
    name,
    amount: String(amount),
    modifiers: groupedModifiers || undefined,
    toppings: toppings.length ? toppings : undefined,
    specialInstructions: specialInstructions || undefined,
    orderSpecialInstructions: orderSpecialInstructions || undefined,
  };
}

function buildReceipt(printer, data = null) {
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
    specialInstructions: String(merged.specialInstructions || '').trim(),
    items: normalizedItems,
  };

  printer.alignCenter();
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
  const typeShort = orderTypeShortCode(d.orderType);
  printer.leftRight('ORDER ID', typeShort ? `#${d.orderNumber}  ${typeShort}` : `#${d.orderNumber}`);
  printer.leftRight('TYPE', d.orderType || '—');
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
  printer.newLine();

  printer.alignLeft();

  for (const item of d.items) {
    printer.bold(true);
    printer.leftRight(`${item.qty}  ${item.name}`, `$${item.amount}`);
    printer.bold(false);

    const mergedInstr = instructionTextForItem(item, d.specialInstructions);

    if (item.modifiers) {
      printModifierGroupBorder(printer);
      const m = item.modifiers;
      const sizeEntry = Object.entries(m).find(([k]) => normModKey(k) === 'SIZE');
      if (sizeEntry) {
        const sizeVal = sizeEntry[1];
        const sizeStr = Array.isArray(sizeVal) ? sizeVal.join(' ') : String(sizeVal);
        if (sizeStr.trim()) {
          printer.setTextDoubleHeight();
          printer.bold(true);
          printer.println(`${' '.repeat(MOD_BLOCK_INDENT)}SIZE: ${String(sizeStr).toUpperCase()}`);
          printer.setTextNormal();
          printer.bold(false);
        }
      }

      const headerOrder = ['CRUST', 'SAUCE'];
      for (const canon of headerOrder) {
        const entry = Object.entries(m).find(([k]) => normModKey(k) === canon);
        if (!entry) continue;
        const [key, val] = entry;
        if (val === undefined) continue;
        printModifierRows(printer, key, val);
      }

      const instrKeys = Object.keys(m).filter((k) => MOD_INSTRUCTION_KEYS.has(normModKey(k)));
      for (const key of instrKeys) {
        printModifierRows(printer, key, m[key]);
      }

      if (mergedInstr && !instrKeys.length) {
        printModifierRows(printer, 'SPECIAL', mergedInstr);
      }

      let pieces = collectToppingPieces(m);
      pieces = applyBeefAnchovySwap(mergedInstr, pieces);
      if (pieces.length) {
        const oneLine = pieces.join(', ');
        printModifierRows(printer, 'TOPPINGS', oneLine);
      }

      const tailOrder = ['FINISH', 'INCL'];
      for (const canon of tailOrder) {
        const entry = Object.entries(m).find(([k]) => normModKey(k) === canon);
        if (!entry) continue;
        const [key, val] = entry;
        if (val === undefined) continue;
        printModifierRows(printer, key, val);
      }
      printWrappedNarrative(printer, modifierNarrativeSummary(m));
      printer.bold(false);
    } else if (item.toppings) {
      const instr = mergedInstr;
      let parts = item.toppings.map((t) => String(t).trim()).filter(Boolean);
      parts = applyBeefAnchovySwap(instr, parts);
      if (instr) {
        printModifierRows(printer, 'SPECIAL', instr);
      }
      const oneLine = parts.join(', ');
      if (oneLine) {
        printModifierRows(printer, 'TOPPINGS', oneLine);
      }
      const toppingsNarrative = parts.map((p) => titleCasePhrase(p)).join(', ');
      if (toppingsNarrative) {
        printWrappedNarrative(printer, `Toppings: ${toppingsNarrative}`);
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
  printer.newLine();
  drawDashed(printer);

  printer.alignCenter();
  printer.println(d.commentaryLine || COMMENTARY);
  const hasRewardsData =
    (d.rewardPoints != null && d.rewardPoints !== '') ||
    d.rewardProgress ||
    d.rewardNudge ||
    d.rewardCode;
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
