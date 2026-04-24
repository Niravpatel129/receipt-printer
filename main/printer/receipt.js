/**
 * Thermal receipt layout for Epson (42 cols). Builds ESC/POS via node-thermal-printer.
 * Item modifiers: size as [BRACKET] bold line, label/value rows, comma toppings (L-/R- sides),
 * INCL on its own + > bold value, totals, rewards, barcode, cut.
 */

// --- simple rules -----------------------------------------------------------
function drawDashed(printer) {
  printer.drawLine('-');
}

function drawSolid(printer) {
  printer.drawLine('=');
}

// --- defaults & branding (merged with live payload in buildReceipt) --------
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

// --- text layout (character width matches RECEIPT_LINE_WIDTH) ---------------
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

// Receipt width; modifier block is indented with a fixed label column + gutter.
const RECEIPT_LINE_WIDTH = 42;
const MOD_BLOCK_INDENT = 3;
const MOD_LABEL_COL_WIDTH = 9;
const MOD_LABEL_GUTTER = 1;

// Which modifier keys are handled outside the “topping comma list” pipeline.
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

// --- modifier parsing helpers -----------------------------------------------
function normModKey(key) {
  return String(key || '')
    .toUpperCase()
    .trim();
}

// Thermal column header; INCL prints as INCL. to match kitchen tickets.
function formatModifierLabel(key) {
  const k = normModKey(key);
  return k === 'INCL' ? 'INCL.' : k;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// POS often sends "CRUST: REGULAR" in the value; strip so the label column + value reads CRUST | REGULAR.
const MOD_LABELS_COLON_STRIP = [
  'SPECIAL INSTRUCTIONS',
  ...Array.from(MOD_INSTRUCTION_KEYS),
  'INCL.',
  'INCL',
  'FINISH',
  'SAUCE',
  'CRUST',
  'SIZE',
  'WHOLE',
  'FULL',
  'LEFT',
  'RIGHT',
  'CHEESE',
  'TOPPINGS',
  'TOPPING',
].sort((a, b) => b.length - a.length);

function stripColonPrefixedLabels(text) {
  let s = String(text || '').trim();
  let prev;
  do {
    prev = s;
    for (const lab of MOD_LABELS_COLON_STRIP) {
      const re = new RegExp(`^${escapeRegExp(lab)}\\s*:\\s*`, 'i');
      s = s.replace(re, '').trim();
    }
  } while (s !== prev);
  return s;
}

function stripColonPrefixedLabelsFromCommaLine(text) {
  return text
    .split(',')
    .map((p) => stripColonPrefixedLabels(p.trim()))
    .filter(Boolean)
    .join(', ');
}

function stripModifierValueForRow(modKey, rawText) {
  let s = String(rawText || '').trim();
  const nk = normModKey(modKey);
  const labels = new Set([nk, formatModifierLabel(modKey)]);
  for (const lab of labels) {
    if (!lab) continue;
    const re = new RegExp(`^${escapeRegExp(lab)}\\s*:\\s*`, 'i');
    s = s.replace(re, '').trim();
  }
  return stripColonPrefixedLabels(s);
}

// Shown next to order # on the receipt (PU / DL / DI).
function orderTypeShortCode(orderType) {
  const t = String(orderType || '').toUpperCase();
  if (t.includes('PICK')) return 'PU';
  if (t.includes('DELIV')) return 'DL';
  if (t.includes('DINE')) return 'DI';
  return '';
}

// Drop “regular cheese” noise so it does not clutter the topping list.
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

// Merge line + order-level instruction strings (deduped) for beef/anchovy logic + SPECIAL row.
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

// If instructions ask for anchovy instead of beef, strip beef-like tokens and ensure anchovies.
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

// LEFT/RIGHT “-” means no toppings on that side; omit from lists.
function isBlankSideToken(t) {
  const u = String(t || '').trim();
  if (!u) return true;
  return u === '-' || u === '–' || u === '—';
}

// POS sometimes sends "SIZE: …" inside arrays or topping blobs; strip from comma line (size prints as […]).
function isSizeColonLine(s) {
  return /^\s*SIZE\s*:/i.test(String(s || '').trim());
}

// First SIZE: line wins for [BRACKET] row; remaining lines pass through to toppings text.
function pullSizeValueFromLines(lines) {
  let sizeInner = null;
  const out = [];
  for (const raw of lines) {
    const s = String(raw || '').trim();
    const m = /^\s*SIZE\s*:\s*(.+)$/i.exec(s);
    if (m) {
      if (!sizeInner) sizeInner = m[1].trim();
      continue;
    }
    out.push(raw);
  }
  return { sizeInner, rest: out };
}

// Single bold line under the item: [X-LARGE] style (no “SIZE:” label).
function printBracketSizeLine(printer, trimmed) {
  if (!trimmed) return;
  const inBrackets = `[${String(trimmed).toUpperCase()}]`;
  printer.print(`${' '.repeat(MOD_BLOCK_INDENT)}`);
  printer.bold(true);
  printer.println(inBrackets);
  printer.bold(false);
}

// One key → string pieces; FULL/LEFT/RIGHT split on “ / ” for half-and-half style lists.
function flattenModifierValues(key, rawVal) {
  const k = normModKey(key);
  if (Array.isArray(rawVal)) {
    return rawVal.map((v) => String(v).trim()).filter((v) => v && !isBlankSideToken(v));
  }
  const s = String(rawVal || '').trim();
  if (!s || isBlankSideToken(s)) return [];
  if (k === 'FULL' || k === 'WHOLE' || k === 'LEFT' || k === 'RIGHT') {
    return s
      .split(/\s*\/\s*/)
      .map((x) => x.trim())
      .filter((x) => x && !isBlankSideToken(x) && !isSizeColonLine(x));
  }
  return [s];
}

// Strip POS “FULL:” / “WHOLE:” on whole pie; “LEFT:”/“RIGHT:” only for that side (avoid stripping wrong side).
function stripToppingSegmentForModifierKey(modKey, seg) {
  let s = String(seg || '').trim();
  const nk = normModKey(modKey);
  const stripFullWhole = () => {
    s = s.replace(/^\s*FULL\s*:\s*/i, '').replace(/^\s*WHOLE\s*:\s*/i, '').trim();
  };
  if (nk === 'FULL' || nk === 'WHOLE') {
    stripFullWhole();
    return s;
  }
  if (nk === 'LEFT') {
    stripFullWhole();
    s = s.replace(/^\s*LEFT\s*:\s*/i, '').trim();
    return s;
  }
  if (nk === 'RIGHT') {
    stripFullWhole();
    s = s.replace(/^\s*RIGHT\s*:\s*/i, '').trim();
    return s;
  }
  return stripColonPrefixedLabels(s);
}

// L-/R- only when missing; whole pie (FULL/WHOLE) has no prefix.
function withSidePrefix(sidePrefix, text) {
  const s = String(text || '').trim();
  if (!s) return '';
  if (!sidePrefix) return s;
  const u = s.toUpperCase();
  if (sidePrefix === 'L-' && u.startsWith('L-')) return s;
  if (sidePrefix === 'R-' && u.startsWith('R-')) return s;
  return `${sidePrefix}${s}`;
}

// Order: whole pie first, then sides; other keys (e.g. CHEESE) after, unprefixed.
const TOPPING_SIDE_KEYS = ['FULL', 'WHOLE', 'LEFT', 'RIGHT'];

function collectToppingPieces(modifiers) {
  if (!modifiers || typeof modifiers !== 'object') return [];
  const pieces = [];

  // Skip header/tail/instruction keys; prefix LEFT/RIGHT segments for the comma line.
  function pushFromKey(key) {
    if (!Object.prototype.hasOwnProperty.call(modifiers, key)) return;
    const nk = normModKey(key);
    if (MOD_HEADER_KEYS.has(nk) || MOD_TAIL_KEYS.has(nk) || MOD_INSTRUCTION_KEYS.has(nk)) return;
    if (isRedundantRegularCheese(key, modifiers[key])) return;
    const sidePrefix = nk === 'LEFT' ? 'L-' : nk === 'RIGHT' ? 'R-' : '';
    const isSideLayout = TOPPING_SIDE_KEYS.includes(nk);
    for (const seg of flattenModifierValues(key, modifiers[key])) {
      if (isSizeColonLine(seg)) continue;
      const cleaned = isSideLayout
        ? stripToppingSegmentForModifierKey(key, seg)
        : stripColonPrefixedLabels(String(seg));
      const t = String(cleaned || '').trim();
      if (!t) continue;
      pieces.push(withSidePrefix(sidePrefix, t));
    }
  }

  for (const canon of TOPPING_SIDE_KEYS) {
    const hit = Object.keys(modifiers).find((k) => normModKey(k) === canon);
    if (hit) pushFromKey(hit);
  }
  for (const key of Object.keys(modifiers)) {
    if (TOPPING_SIDE_KEYS.includes(normModKey(key))) continue;
    pushFromKey(key);
  }
  return pieces;
}

// Modifier label column: pad left so labels align (CRUST, SAUCE, …).
function rightAlignInColumn(text, width) {
  const s = String(text);
  if (s.length >= width) return s.slice(0, width);
  return ' '.repeat(width - s.length) + s;
}

// --- modifier rows on the printer -------------------------------------------
// Default: [indent][label right 9][gap][value…]. omitLabel: full width value only (toppings).
function printModifierRows(printer, key, rawVal, opts = {}) {
  const rawJoined = Array.isArray(rawVal) ? rawVal.join(' / ') : String(rawVal);
  const prefix = ' '.repeat(MOD_BLOCK_INDENT);
  printer.bold(false);
  if (opts.omitLabel) {
    const valueText = stripColonPrefixedLabelsFromCommaLine(rawJoined);
    const valueWidth = RECEIPT_LINE_WIDTH - MOD_BLOCK_INDENT;
    const lines = wordWrap(valueText, valueWidth);
    for (let i = 0; i < lines.length; i += 1) {
      printer.println(`${prefix}${lines[i]}`);
    }
    return;
  }
  const valueText = stripModifierValueForRow(key, rawJoined);
  const labelCol = rightAlignInColumn(formatModifierLabel(key), MOD_LABEL_COL_WIDTH);
  const valueWidth = RECEIPT_LINE_WIDTH - MOD_BLOCK_INDENT - MOD_LABEL_COL_WIDTH - MOD_LABEL_GUTTER;
  const lines = wordWrap(valueText, valueWidth);
  const gap = ' '.repeat(MOD_LABEL_GUTTER);
  const contIndent = prefix + ' '.repeat(MOD_LABEL_COL_WIDTH + MOD_LABEL_GUTTER);

  printer.print(`${prefix}${labelCol}${gap}`);
  printer.println(lines[0]);
  for (let i = 1; i < lines.length; i += 1) {
    printer.print(contIndent);
    printer.println(lines[i]);
  }
}

// Match INCL / INCL. keys from different POS spellings.
function isInclKey(key) {
  const k = normModKey(key).replace(/\./g, '');
  return k === 'INCL';
}

// INCL.: label-only row, then “> ” + bold value (wrapped); “>” stays normal weight.
function printInclHighlight(printer, rawVal, modKey) {
  const rawJoined = Array.isArray(rawVal) ? rawVal.join(' / ') : String(rawVal);
  if (!String(rawJoined).trim()) return;
  const valueText = stripModifierValueForRow(modKey, rawJoined);
  const prefix = ' '.repeat(MOD_BLOCK_INDENT);
  const labelCol = rightAlignInColumn(formatModifierLabel(modKey), MOD_LABEL_COL_WIDTH);
  const gap = ' '.repeat(MOD_LABEL_GUTTER);
  printer.bold(false);
  printer.println(`${prefix}${labelCol}${gap}`);

  const bullet = `${prefix}> `;
  const valueStartLen = bullet.length;
  const valueWidth = RECEIPT_LINE_WIDTH - valueStartLen;
  const lines = wordWrap(valueText, valueWidth);
  const contIndent = ' '.repeat(valueStartLen);

  printer.print(bullet);
  printer.bold(true);
  printer.println(lines[0]);
  for (let i = 1; i < lines.length; i += 1) {
    printer.bold(false);
    printer.print(contIndent);
    printer.bold(true);
    printer.println(lines[i]);
  }
  printer.bold(false);
}

// Under each line item: structured modifiers object, or legacy toppings[] only.
function printItemModifierSection(printer, item, mergedInstr) {
  if (item.modifiers) {
    const m = item.modifiers;
    const sizeEntry = Object.entries(m).find(([k]) => normModKey(k) === 'SIZE');
    if (sizeEntry) {
      const sizeVal = sizeEntry[1];
      const sizeStr = Array.isArray(sizeVal) ? sizeVal.join(' ') : String(sizeVal);
      const trimmed = sizeStr.trim();
      printBracketSizeLine(printer, trimmed);
    }

    // Label + value rows (not bold except size line above).
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

    // Comma-separated toppings; SIZE: text stripped (size already [BRACKET]).
    let pieces = collectToppingPieces(m);
    pieces = applyBeefAnchovySwap(mergedInstr, pieces);
    pieces = pieces.filter((p) => !isSizeColonLine(p));
    if (pieces.length) {
      printModifierRows(printer, 'TOPPINGS', pieces.join(', '), { omitLabel: true });
    }

    // FINISH row; INCL uses special “>” second line.
    const tailOrder = ['FINISH', 'INCL'];
    for (const canon of tailOrder) {
      const entry = Object.entries(m).find(([k]) =>
        canon === 'INCL' ? isInclKey(k) : normModKey(k) === canon,
      );
      if (!entry) continue;
      const [key, val] = entry;
      if (val === undefined) continue;
      if (isInclKey(key)) {
        printInclHighlight(printer, val, key);
      } else {
        printModifierRows(printer, key, val);
      }
    }
    printer.bold(false);
    return;
  }

  // Legacy path: modifiers arrived as string[] → normalizeItem moved them to toppings.
  if (!item.toppings || !item.toppings.length) return;

  const instr = mergedInstr;
  let parts = item.toppings.map((t) => String(t).trim()).filter(Boolean);
  const pulled = pullSizeValueFromLines(parts);
  parts = pulled.rest;
  printBracketSizeLine(printer, pulled.sizeInner);
  parts = applyBeefAnchovySwap(instr, parts);
  parts = parts.filter((p) => !isSizeColonLine(p));
  if (instr) {
    printModifierRows(printer, 'SPECIAL', instr);
  }
  const oneLine = parts.join(', ');
  if (oneLine) {
    printModifierRows(printer, 'TOPPINGS', oneLine, { omitLabel: true });
  }
}

// --- payload normalization & money -----------------------------------------
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

// Coerce modifier values to non-empty arrays per key; arrays at top level → null (handled as toppings).
function normalizeModifierGroups(modifiers) {
  if (!modifiers || typeof modifiers !== 'object' || Array.isArray(modifiers)) return null;
  const out = {};
  for (const [key, value] of Object.entries(modifiers)) {
    const values = asStringArray(value);
    if (values.length) out[key] = values;
  }
  return Object.keys(out).length ? out : null;
}

// Prefer explicit fields from the original API payload when merging rewards, etc.
function fromSource(source, key, fallback = '') {
  if (!source || typeof source !== 'object') return fallback;
  return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : fallback;
}

// Stable qty/name/amount; object modifiers kept, array modifiers become toppings only.
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

// Main entry: merge defaults + optional nested data.receipt, normalize, then emit ESC/POS.
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
  // `d` is the single object used for the whole print run (defaults filled in).
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

  // --- Header (centered store block + dashed rule) -------------------------
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

  // --- Order meta (left / right columns) ------------------------------------
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

  // --- Line items + modifier blocks ----------------------------------------
  printer.alignLeft();

  for (const item of d.items) {
    printer.bold(false);
    printer.leftRight(`${item.qty}  ${item.name}`, `$${item.amount}`);

    const mergedInstr = instructionTextForItem(item, d.specialInstructions);
    printItemModifierSection(printer, item, mergedInstr);

    printer.newLine();
  }

  drawDashed(printer);

  // --- Totals & payment ------------------------------------------------------
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

  // --- Footer: commentary, optional rewards, barcode, URLs, cut -----------
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

// Public API for main/printer/index.js and tests.
module.exports = { buildReceipt, drawDashed, drawSolid, DEFAULT_RECEIPT };
