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

function drawUnderscore(printer) {
  printer.drawLine('_');
}

function printUnderscoreBanner(printer, text) {
  const t = String(text || '').trim();
  if (!t) return;
  printer.newLine();
  drawUnderscore(printer);
  printer.newLine();
  printer.bold(true);
  printer.println(t);
  printer.bold(false);
  drawUnderscore(printer);
}

function formatHeaderDateTime(date, time) {
  const datePart = String(date || '')
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const timePart = String(time || '').trim();
  if (datePart && timePart) return `${datePart} | ${timePart}`;
  return [datePart, timePart].filter(Boolean).join(' | ');
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
  phoneBannerText: 'PICK UP / DELIVERY',
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
const MOD_HEADER_KEYS = new Set(['SIZE', 'CRUST', 'SAUCE', 'BASE', 'CRUSTTYPE']);
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
  'CRUSTTYPE',
  'BASE',
  'SIZE',
  'WHOLE',
  'FULL',
  'LEFT',
  'RIGHT',
  'CHEESE',
  'TOPPINGS',
  'TOPPING',
].sort((a, b) => b.length - a.length);

// “Full …” / “FULL: …” / “WHOLE …” at start of a segment (POS often omits colon).
function stripFullWholePrefixes(s) {
  let t = String(s || '').trim();
  let prev;
  do {
    prev = t;
    t = t
      .replace(/^\s*(?:FULL|WHOLE)\s*:\s*/i, '')
      .replace(/^\s*(?:FULL|WHOLE)\b\s+/i, '')
      .trim();
  } while (t !== prev);
  return t;
}

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
  return stripFullWholePrefixes(s);
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

// POS keys are not always exactly CRUST / SAUCE; still print “… CRUST” / “… SAUCE” lines.
function modifierRowSuffixKind(key) {
  const nk = normModKey(key);
  const ks = String(key || '');
  if (/crust/i.test(ks) && /sauce/i.test(ks)) return '';
  if (nk === 'SAUCE' || nk.endsWith('SAUCE') || /\bsauce\b/i.test(ks)) return 'SAUCE';
  if (
    nk === 'CRUST' ||
    nk === 'BASE' ||
    nk === 'CRUSTTYPE' ||
    nk.endsWith('CRUST') ||
    /crust/i.test(ks)
  ) {
    return 'CRUST';
  }
  return '';
}

function ensureTrailingKindSuffix(valueText, suffixWord) {
  const s = String(valueText || '')
    .trim()
    .replace(/,\s*$/, '');
  const suf = String(suffixWord || '').trim();
  if (!suf) return s;
  if (!s) return suf;
  const re = new RegExp(`\\b${escapeRegExp(suf)}\\b`, 'i');
  if (re.test(s)) return s;
  return `${s} ${suf}`.trim();
}

function findModifierEntryForPrint(m, exactCanons, suffixKind) {
  for (const canon of exactCanons) {
    const e = Object.entries(m).find(([k]) => normModKey(k) === canon);
    if (e) return e;
  }
  return Object.entries(m).find(([k]) => modifierRowSuffixKind(k) === suffixKind);
}

function findCrustModifierEntry(m) {
  const direct = findModifierEntryForPrint(m, ['CRUST', 'BASE', 'CRUSTTYPE'], 'CRUST');
  if (direct) return direct;
  for (const [k, v] of Object.entries(m)) {
    const ks = String(k);
    if (/crust/i.test(ks) && /sauce/i.test(ks)) continue;
    if (!/crust/i.test(ks)) continue;
    const vals = asStringArray(v);
    if (!vals.length) continue;
    return [k, vals.length === 1 ? vals[0] : vals];
  }
  return null;
}

function findSauceModifierEntry(m) {
  const direct = findModifierEntryForPrint(m, ['SAUCE'], 'SAUCE');
  if (direct) return direct;
  for (const [k, v] of Object.entries(m)) {
    const ks = String(k);
    if (/crust/i.test(ks) && /sauce/i.test(ks)) continue;
    const nk = normModKey(k);
    if (!/\bsauce\b/i.test(ks) && !nk.endsWith('SAUCE')) continue;
    const vals = asStringArray(v);
    if (!vals.length) continue;
    return [k, vals.length === 1 ? vals[0] : vals];
  }
  return null;
}

function joinModifierValueForPrint(rawVal) {
  if (rawVal == null || rawVal === '') return '';
  return asStringArray(rawVal).join(' / ');
}

// Shown next to order # on the receipt (PU / DL / DI).
function orderTypeShortCode(orderType) {
  const t = String(orderType || '').toUpperCase();
  if (t.includes('PICK')) return 'PU';
  if (t.includes('DELIV')) return 'DL';
  if (t.includes('DINE')) return 'DI';
  return '';
}

function orderTypePhoneBannerText(orderType) {
  const t = String(orderType || '').toUpperCase();
  if (!t.trim()) return DEFAULT_RECEIPT.phoneBannerText;
  if (t.includes('PICK')) return 'PICK UP';
  if (t.includes('DELIV')) return 'DELIVERY';
  if (t.includes('DINE')) return 'DINE IN';
  return String(orderType || '')
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toUpperCase();
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
  if (nk === 'FULL' || nk === 'WHOLE') {
    return stripFullWholePrefixes(s);
  }
  if (nk === 'LEFT') {
    let t = stripFullWholePrefixes(s);
    t = t
      .replace(/^\s*LEFT\s*:\s*/i, '')
      .replace(/^\s*LEFT\b\s+/i, '')
      .trim();
    return t;
  }
  if (nk === 'RIGHT') {
    let t = stripFullWholePrefixes(s);
    t = t
      .replace(/^\s*RIGHT\s*:\s*/i, '')
      .replace(/^\s*RIGHT\b\s+/i, '')
      .trim();
    return t;
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

// Same list often appears again under TOPPINGS/OPTIONS after FULL — skip to avoid printing twice.
const MOD_AGGREGATE_TOPPING_BAG_KEYS = new Set([
  'TOPPINGS',
  'TOPPING',
  'OPTIONS',
  'OPTION',
  'EXTRAS',
  'SELECTEDTOPPINGS',
  'ITEMTOPPINGS',
]);

function collectToppingPieces(modifiers) {
  if (!modifiers || typeof modifiers !== 'object') return [];
  const pieces = [];

  // Skip header/tail/instruction keys; prefix LEFT/RIGHT segments for the comma line.
  function pushFromKey(key) {
    if (!Object.prototype.hasOwnProperty.call(modifiers, key)) return;
    const nk = normModKey(key);
    if (MOD_AGGREGATE_TOPPING_BAG_KEYS.has(nk)) return;
    if (MOD_HEADER_KEYS.has(nk) || MOD_TAIL_KEYS.has(nk) || MOD_INSTRUCTION_KEYS.has(nk)) return;
    const rowKind = modifierRowSuffixKind(key);
    if (rowKind === 'CRUST' || rowKind === 'SAUCE') return;
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

function collectToppingPiecesFromAggregateBags(modifiers) {
  if (!modifiers || typeof modifiers !== 'object') return [];
  const pieces = [];
  for (const key of Object.keys(modifiers)) {
    if (!MOD_AGGREGATE_TOPPING_BAG_KEYS.has(normModKey(key))) continue;
    for (const seg of flattenModifierValues(key, modifiers[key])) {
      if (isSizeColonLine(seg)) continue;
      const cleaned = stripColonPrefixedLabels(String(seg));
      const t = String(cleaned || '').trim();
      if (!t) continue;
      for (const part of t.split(',')) {
        const p = stripColonPrefixedLabels(part.trim()).trim();
        if (p && !isSizeColonLine(p)) pieces.push(p);
      }
    }
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
  const rawJoined = joinModifierValueForPrint(rawVal);
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
  const rowSuffix = modifierRowSuffixKind(key);
  if (rowSuffix) {
    const valueText = stripModifierValueForRow(key, rawJoined);
    const combined = ensureTrailingKindSuffix(valueText, rowSuffix);
    const valueWidth = RECEIPT_LINE_WIDTH - MOD_BLOCK_INDENT;
    const lines = wordWrap(combined, valueWidth);
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
    } else {
      const fromField = String(item.size || '').trim();
      if (fromField) printBracketSizeLine(printer, fromField);
    }

    // Crust / sauce (aliases like BASE, selectedCrust); value line always ends with CRUST / SAUCE.
    const crustEntry = findCrustModifierEntry(m);
    if (crustEntry) {
      const [key, val] = crustEntry;
      if (val !== undefined) printModifierRows(printer, key, val);
    }
    const sauceEntry = findSauceModifierEntry(m);
    if (sauceEntry) {
      const [key, val] = sauceEntry;
      if (val !== undefined) printModifierRows(printer, key, val);
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
    if (!pieces.length) {
      pieces = collectToppingPiecesFromAggregateBags(m);
    }
    if (!pieces.length) {
      pieces = asStringArray(item.toppings || item.options)
        .map((p) => String(p).trim())
        .filter((p) => p && !isSizeColonLine(p));
    }
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

  // Legacy path: flat options/toppings[] (no structured modifiers object).
  if (!item.toppings || !item.toppings.length) return;

  const instr = mergedInstr;
  let parts = item.toppings.map((t) => String(t).trim()).filter(Boolean);
  const pulled = pullSizeValueFromLines(parts);
  parts = pulled.rest;
  const bracketSize = String(item.size || '').trim() || pulled.sizeInner;
  printBracketSizeLine(printer, bracketSize);
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
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap((v) => asStringArray(v));
  if (typeof value === 'object') {
    if (value.value != null && value.value !== '') return asStringArray(value.value);
    if (typeof value.name === 'string' && value.name.trim()) return [value.name.trim()];
    if (typeof value.label === 'string' && value.label.trim()) return [value.label.trim()];
    if (typeof value.displayName === 'string' && value.displayName.trim()) {
      return [value.displayName.trim()];
    }
    return [];
  }
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

// Stable qty/name/amount; object modifiers kept; flat list from options[] or toppings[].
function normalizeItem(item, index) {
  const qty = item.qty || item.num || item.quantity || String(index + 1).padStart(2, '0');
  const name = String(item.name || 'ITEM').toUpperCase();
  const amount = item.amount ?? item.price ?? '0.00';
  const groupedModifiers = normalizeModifierGroups(item.modifiers);
  const modifierList = Array.isArray(item.modifiers) ? item.modifiers : [];
  const toppings = groupedModifiers
    ? asStringArray(item.toppings || item.options)
    : asStringArray(item.options || item.toppings || modifierList);
  const specialInstructions = String(
    item.specialInstructions || item.specialInstruction || item.instructions || '',
  ).trim();
  const orderSpecialInstructions = String(item.orderSpecialInstructions || '').trim();
  const size = item.size != null ? String(item.size).trim() : '';
  return {
    ...item,
    qty: String(qty),
    num: String(qty),
    name,
    amount: String(amount),
    modifiers: groupedModifiers || undefined,
    toppings: toppings.length ? toppings : undefined,
    size: size || undefined,
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
  const effectiveOrderType = merged.orderType || 'DELIVERY';
  // `d` is the single object used for the whole print run (defaults filled in).
  const d = {
    ...merged,
    storeAddress: merged.storeAddress || merged.address || DEFAULT_RECEIPT.storeAddress,
    storeCity: merged.storeCity || merged.city || DEFAULT_RECEIPT.storeCity,
    orderType: effectiveOrderType,
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
    phoneBannerText: orderTypePhoneBannerText(effectiveOrderType),
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
  if (d.storePhone) {
    printer.println(d.storePhone);
  }
  const headerDateTime = formatHeaderDateTime(d.date, d.time);
  if (headerDateTime) {
    printer.println(headerDateTime);
  }
  printUnderscoreBanner(printer, d.phoneBannerText);
  printer.newLine();
  drawDashed(printer);

  // --- Order meta (left / right columns) ------------------------------------
  printer.alignLeft();
  printer.newLine();
  printer.bold(false);
  const typeShort = orderTypeShortCode(d.orderType);
  printer.leftRight('ORDER ID', typeShort ? `#${d.orderNumber}` : `#${d.orderNumber}`);
  printer.leftRight('TYPE', d.orderType || '—');
  printer.bold(true);
  printer.leftRight('CUSTOMER', d.customerName);
  printer.bold(false);
  printer.leftRight('PHONE', d.customerPhone);
  if (d.driver) {
    printer.leftRight('DRIVER', d.driver);
  }
  if (d.eta) {
    printer.leftRight('ETA', d.eta);
  }
  printer.newLine();
  // drawDashed(printer);

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
    printer.leftRight('TAX & FEES', d.tax);
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

  if (d.cardLastFour) {
    printer.leftRight(`CARD #: **** **** **** ${d.cardLastFour}`, '');
  }
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
