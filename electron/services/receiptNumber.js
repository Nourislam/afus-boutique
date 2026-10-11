/**
 * Next ticket number of the day: YYYYMMDD (the shop's own calendar day, not
 * UTC: a sale at 00:30 in Algiers belongs to the new day) + a sequence of at
 * least 4 digits (no limit on the number of tickets in a day).
 */
const pad = (n) => String(n).padStart(2, '0');
const localDay = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

function nextReceiptNumber(api, now = new Date()) {
    const today = localDay(now);
    const last = api.get(`
        SELECT receipt_number FROM sales
        WHERE receipt_number LIKE ?
        ORDER BY length(receipt_number) DESC, receipt_number DESC LIMIT 1
    `, [`${today}%`]);
    const sequence = last ? (parseInt(String(last.receipt_number).slice(8), 10) || 0) + 1 : 1;
    return `${today}${String(sequence).padStart(4, '0')}`;
}

module.exports = { nextReceiptNumber, localDay };
