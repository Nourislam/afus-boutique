/**
 * The QR code printed on each ticket: "T" + the ticket number
 * (T202610100001). Scanned on the sales screen or in the sales history, it
 * opens that sale for a return or an exchange. The letter keeps it apart from
 * article codes (EAN/UPC are digits only); it is the same letter on AZERTY
 * and QWERTY scanners.
 */
export const TICKET_PREFIX = 'T';

export function ticketCode(receiptNumber) {
    return receiptNumber ? `${TICKET_PREFIX}${receiptNumber}` : '';
}

/** The ticket number of a scanned ticket QR, or null for anything else. */
export function parseTicketCode(code) {
    const m = /^\s*T(\d{12,})\s*$/i.exec(String(code || ''));
    return m ? m[1] : null;
}
