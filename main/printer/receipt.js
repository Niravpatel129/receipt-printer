function drawDashed(printer) {
  printer.drawLine('-');
}

const WEBSITE = 'PIZZADEPOT.CA';
const FOOTER_MESSAGE = 'ENJOY YOUR MEAL!';

const DEFAULT_RECEIPT = {
  storeName: 'PIZZA DEPOT',
  address: '975 PETER ROBERTSON BLVD.',
  city: 'BRAMPTON, ON',
  orderNumber: '0411',
  customerName: 'MARKO',
  customerPhone: '555-555-5555',
  date: 'FEB 7, 2026',
  items: [
    {
      num: '01',
      name: 'LARGE PIZZA',
      amount: '22.99',
      toppings: [
        'TANDOORI PANEER',
        'ROASTED RED PEPPERS',
        'GREEN PEPPERS',
        'ONIONS',
        'GINGER',
        'GREEN CHILLI',
        'CORIANDER',
        'CHILLI FLAKES',
      ],
    },
    { num: '02', name: 'CREAMY GARLIC DIP', amount: '1.49' },
    { num: '03', name: 'PEPSI CAN', amount: '1.99' },
  ],
  itemCount: '3',
  subtotal: '$ 22.99',
  tax: '$ 3.48',
  total: '$ 26.47',
  cardLastFour: '9711',
  authCode: '867324',
  userId: 'MARKO K',
  barcode: '0411',
  website: WEBSITE,
  footerMessage: FOOTER_MESSAGE,
};

function buildReceipt(printer, data = null) {
  const d = data && typeof data === 'object' ? { ...DEFAULT_RECEIPT, ...data } : DEFAULT_RECEIPT;

  printer.alignCenter();
  printer.setTextDoubleHeight();
  printer.println(d.storeName);
  printer.setTextNormal();
  printer.println(d.address);
  printer.println(d.city);
  printer.newLine();
  printer.alignLeft();
  printer.println(d.customerName);
  if (d.customerPhone) {
    printer.println(d.customerPhone);
  }
  printer.println(`ORDER: #${d.orderNumber}`);
  printer.println(`DATE: ${d.date}`);
  drawDashed(printer);
  printer.bold(true);
  printer.leftRight('NUM ITEM', 'AMT ($)');
  printer.bold(false);
  drawDashed(printer);
  (d.items || []).forEach((item) => {
    printer.bold(true);
    printer.leftRight(`${item.num} ${item.name}`, item.amount);
    printer.bold(false);
    if (item.toppings) {
      item.toppings.forEach((t) => printer.println(`   ${t}`));
    }
  });
  drawDashed(printer);
  printer.leftRight('ITEM COUNT', d.itemCount);
  printer.bold(true);
  if (d.subtotal) {
    printer.leftRight('SUBTOTAL', d.subtotal);
  }
  if (d.tax) {
    printer.leftRight('TAX', d.tax);
  }
  printer.leftRight('TOTAL', d.total);
  printer.bold(false);
  drawDashed(printer);
  printer.println(`CARD #: **** **** **** ${d.cardLastFour}`);
  printer.println(`AUTH #: ${d.authCode}`);
  printer.println(`USERID: ${d.userId}`);
  printer.newLine();
  printer.alignCenter();
  printer.println(d.footerMessage);
  printer.newLine();
  printer.code128(d.barcode, { height: 50, text: 0 });
  printer.newLine();
  printer.println(d.website);
  printer.newLine();
  printer.alignCenter();
  printer.println('*');
  printer.newLine();
  printer.cut();
}

module.exports = { buildReceipt, drawDashed };
