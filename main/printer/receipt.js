function drawDashed(printer) {
  printer.drawLine('-');
}

const DEFAULT_RECEIPT = {
  storeName: 'PIZZA DEPOT',
    address: '975 PETER ROBERTSON BLVD.',
    city: 'BRAMPTON, ON',
    orderNumber: '0411',
    customerName: 'MARKO',
    date: 'FEB 7, 2026',
    items: [
      { num: '01', name: 'LARGE PIZZA', amount: '22.99', toppings: ['TANDOORI PANEER', 'ROASTED RED PEPPERS', 'GREEN PEPPERS', 'ONIONS', 'GINGER', 'GREEN CHILLI', 'CORIANDER', 'CHILLI FLAKES'] },
      { num: '02', name: 'CREAMY GARLIC DIP', amount: '1.49' },
      { num: '03', name: 'PEPSI CAN', amount: '1.99' }
    ],
    itemCount: '3',
    total: '$ 26.47',
    cardLastFour: '9711',
    authCode: '867324',
    userId: 'MARKO K',
    barcode: '0411',
  website: 'PIZZADEPOT.CA',
  footerMessage: 'ENJOY YOUR MEAL!'
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
  printer.println(`ORDER: #${d.orderNumber} FOR ${d.customerName}`);
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
