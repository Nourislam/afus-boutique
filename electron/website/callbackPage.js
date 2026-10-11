/**
 * The small page the browser shows when it comes back from Cloudflare to
 * the program (http://127.0.0.1:<port>/oauth/callback): what happened, and
 * that the shop can go back to the program. Plain text only (no script, no
 * outside resource: the server sends a strict Content-Security-Policy).
 */
const TEXT = {
    ok: {
        ar: ['تم ربط Cloudflare', 'يمكنك إغلاق هذه الصفحة والرجوع إلى Afus Boutique.'],
        fr: ['Cloudflare est lié', 'Vous pouvez fermer cette page et revenir à Afus Boutique.'],
        en: ['Cloudflare is linked', 'You can close this page and go back to Afus Boutique.'],
    },
    denied: {
        ar: ['لم يتم الربط', 'رفضتَ في Cloudflare. ارجع إلى Afus Boutique وأعد المحاولة إن كان ذلك خطأ.'],
        fr: ['Liaison refusée', 'Vous avez refusé sur Cloudflare. Revenez à Afus Boutique pour réessayer si c\'était une erreur.'],
        en: ['Not linked', 'You refused on Cloudflare. Go back to Afus Boutique to try again if it was a mistake.'],
    },
    error: {
        ar: ['تعذّر الربط', 'ارجع إلى Afus Boutique وأعد المحاولة.'],
        fr: ['La liaison n\'a pas abouti', 'Revenez à Afus Boutique et réessayez.'],
        en: ['Linking did not work', 'Go back to Afus Boutique and try again.'],
    },
};

const escape = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function callbackPage(kind, language) {
    const lang = ['ar', 'fr', 'en'].includes(language) ? language : 'ar';
    const [title, body] = (TEXT[kind] || TEXT.error)[lang];
    const color = kind === 'ok' ? '#10b981' : '#ef4444';
    return `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Afus Boutique</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0b0f;color:#e4e4e7;font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif}main{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.4rem;color:${color};margin:0 0 .75rem}p{line-height:1.6;color:#a1a1aa;margin:0}</style></head>
<body><main><h1>${escape(title)}</h1><p>${escape(body)}</p></main></body></html>`;
}

module.exports = callbackPage;
