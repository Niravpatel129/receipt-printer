function drawDashed(printer) {
  printer.drawLine('-');
}

function buildReceipt(printer) {
  const data = {
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

  printer.alignCenter();
  printer.setTextDoubleHeight();
  printer.println(data.storeName);
  printer.setTextNormal();
  printer.println(data.address);
  printer.println(data.city);
  printer.newLine();
  printer.alignLeft();
  printer.println(`ORDER: #${data.orderNumber} FOR ${data.customerName}`);
  printer.println(`DATE: ${data.date}`);
  drawDashed(printer);
  printer.bold(true);
  printer.leftRight('NUM ITEM', 'AMT ($)');
  printer.bold(false);
  drawDashed(printer);
  data.items.forEach((item) => {
    printer.bold(true);
    printer.leftRight(`${item.num} ${item.name}`, item.amount);
    printer.bold(false);
    if (item.toppings) {
      item.toppings.forEach((t) => printer.println(`   ${t}`));
    }
  });
  drawDashed(printer);
  printer.leftRight('ITEM COUNT', data.itemCount);
  printer.bold(true);
  printer.leftRight('TOTAL', data.total);
  printer.bold(false);
  drawDashed(printer);
  printer.println(`CARD #: **** **** **** ${data.cardLastFour}`);
  printer.println(`AUTH #: ${data.authCode}`);
  printer.println(`USERID: ${data.userId}`);
  printer.newLine();
  printer.alignCenter();
  printer.println(data.footerMessage);
  printer.newLine();
  printer.code128(data.barcode, { height: 50, text: 0 });
  printer.newLine();
  printer.println(data.website);
  printer.newLine();
  printer.alignCenter();
  printer.println('*');
  printer.newLine();
  printer.cut();
}

module.exports = { buildReceipt, drawDashed };
