/**
 * The key that recognises a customer of the website: the phone number,
 * written one way (Algerian 0XXXXXXXXX). "+213 661 22 33 44",
 * "00213661223344", "213661223344" and "0661-22-33-44" are one customer.
 * Not a number: '' (such orders have no customer history).
 */
function phoneKey(phone) {
    let d = String(phone ?? '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('213') && d.length >= 11) d = `0${d.slice(3)}`;
    if (d.length === 9 && /^[5-7]/.test(d)) d = `0${d}`;
    return d.length >= 8 && d.length <= 15 ? d : '';
}

module.exports = { phoneKey };
