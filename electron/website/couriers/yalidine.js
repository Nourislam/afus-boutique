/**
 * Yalidine (Algerian courier), the shop's own account: send a home-delivery
 * parcel of a website order, read where a parcel is. The API id and token
 * stay in the program's encrypted store (secureStore), never in the screen,
 * the website or the logs.
 *
 * API (as used by Yalidine's own clients): https://api.yalidine.app/v1/ with
 * headers X-API-ID / X-API-TOKEN; POST parcels (a list), GET parcels/{tracking}.
 * Its answers are read with care: only a tracking number and a status text
 * are taken from them.
 */
const BASE = 'https://api.yalidine.app/v1/';
const TRACKING = /^[A-Za-z0-9-]{4,40}$/;

class YalidineError extends Error {
    constructor(reason, status = 0) {
        super(`yalidine ${reason}`);
        this.reason = reason;
        this.status = status;
    }
}

function createYalidineClient({ fetch: fetchImpl = globalThis.fetch, base = BASE, timeoutMs = 20000 } = {}) {
    async function call(path, { id, token, method = 'GET', body } = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let res;
        try {
            res = await fetchImpl(new URL(path, base).toString(), {
                method, signal: controller.signal,
                headers: { 'X-API-ID': id, 'X-API-TOKEN': token, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
                body: body ? JSON.stringify(body) : undefined,
            });
        } catch {
            throw new YalidineError('network');
        } finally {
            clearTimeout(timer);
        }
        if (res.status === 401 || res.status === 403) throw new YalidineError('key', res.status);
        if (res.status === 429) throw new YalidineError('busy', res.status);
        if (!res.ok) throw new YalidineError('refused', res.status);
        try { return await res.json(); } catch { throw new YalidineError('answer', res.status); }
    }

    /** The key works: a small read (the wilayas). */
    async function check(id, token) {
        await call('wilayas/?page_size=1', { id, token });
        return true;
    }

    /** First tracking number found in an answer (whatever its exact layout). */
    function trackingOf(answer) {
        const seen = [answer];
        while (seen.length) {
            const x = seen.shift();
            if (!x || typeof x !== 'object') continue;
            if (typeof x.tracking === 'string' && TRACKING.test(x.tracking)) return x.tracking;
            seen.push(...Object.values(x));
        }
        return '';
    }

    function statusOf(answer) {
        const seen = [answer];
        while (seen.length) {
            const x = seen.shift();
            if (!x || typeof x !== 'object') continue;
            for (const k of ['last_status', 'status']) if (typeof x[k] === 'string' && x[k].trim()) return x[k].trim().slice(0, 80);
            seen.push(...Object.values(x));
        }
        return '';
    }

    /** One home-delivery parcel; returns its tracking number. */
    async function createParcel(id, token, parcel) {
        const answer = await call('parcels', { id, token, method: 'POST', body: [parcel] });
        const tracking = trackingOf(answer);
        if (!tracking) throw new YalidineError('answer');
        return { tracking };
    }

    async function parcelStatus(id, token, tracking) {
        if (!TRACKING.test(tracking)) throw new YalidineError('tracking');
        return { status: statusOf(await call(`parcels/${encodeURIComponent(tracking)}`, { id, token })) };
    }

    return { check, createParcel, parcelStatus };
}

/** A website order as a Yalidine parcel (home delivery). */
function parcelOf(order, { fromWilaya = '', shopName = '' } = {}) {
    const name = String(order.customerName || '').trim().split(/\s+/);
    const wilaya = String(order.wilaya || '').replace(/^\d+\s*-\s*/, '').trim();
    return {
        order_id: String(order.number || order.id).slice(0, 40),
        from_wilaya_name: fromWilaya,
        firstname: order.firstName || name[0] || '',
        familyname: order.lastName || name.slice(1).join(' ') || name[0] || '',
        contact_phone: order.phone,
        address: order.address || order.commune || '',
        to_commune_name: order.commune || '',
        to_wilaya_name: wilaya,
        product_list: (order.items || []).map(i => [i.productName, i.color, i.size, `x${i.quantity}`].filter(Boolean).join(' ')).join(', ').slice(0, 250) || shopName,
        price: Math.round(Number(order.toCollect) || 0),
        do_insurance: false,
        declared_value: Math.round(Number(order.total) || 0),
        // A price the website already told the customer: collected as it is (the shop pays the courier);
        // none told ("by phone"): Yalidine adds its own delivery price
        freeshipping: order.deliveryFee !== null && order.deliveryFee !== undefined,
        is_stopdesk: false,
        has_exchange: false,
    };
}

module.exports = { createYalidineClient, parcelOf, YalidineError, BASE };
