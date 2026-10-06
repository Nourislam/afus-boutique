/** Next ticket number of the day: YYYYMMDD + 4-digit sequence. */
function nextReceiptNumber(api, now = new Date()) {
    const today = now.toISOString().split('T')[0].replace(/-/g, '');
    const last = api.get(`
        SELECT receipt_number FROM sales
        WHERE receipt_number LIKE ?
        ORDER BY receipt_number DESC LIMIT 1
    `, [`${today}%`]);
    const sequence = last ? (parseInt(String(last.receipt_number).slice(-4), 10) || 0) + 1 : 1;
    return `${today}${String(sequence).padStart(4, '0')}`;
}

module.exports = { nextReceiptNumber };
