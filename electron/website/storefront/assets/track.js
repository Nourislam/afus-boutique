/*
 * The ads and visit tools the shop turned on (Website screen › Settings ›
 * Ads & analytics): Meta (Facebook / Instagram) Pixel, TikTok Pixel, Snap
 * Pixel, Google Analytics 4. Only on the shop's published website, only the
 * ones with an id; their own scripts from their own addresses (allowed one by
 * one by the page's Content-Security-Policy). Nothing about the customer is
 * sent by the shop's own pages: the events say what was seen or ordered
 * (article, price, quantity), never a name, phone or address.
 *
 * window.afusTrack(event, data) — events: view_item, add_to_cart,
 * begin_checkout, purchase (data: { id, name, value, currency, quantity }).
 */
(function () {
    'use strict';
    var ids = {};
    try { ids = JSON.parse(document.body.getAttribute('data-track') || '{}') || {}; } catch { ids = {}; }
    var currency = document.body.getAttribute('data-currency') || 'DZD';
    function load(src) { var s = document.createElement('script'); s.async = true; s.src = src; document.head.appendChild(s); }

    // Meta Pixel (its documented loader, without inline code)
    if (/^\d{10,20}$/.test(ids.facebook || '')) {
        var f = window.fbq = function () { f.callMethod ? f.callMethod.apply(f, arguments) : f.queue.push(arguments); };
        if (!window._fbq) window._fbq = f;
        f.push = f; f.loaded = true; f.version = '2.0'; f.queue = [];
        load('https://connect.facebook.net/en_US/fbevents.js');
        window.fbq('init', ids.facebook);
        window.fbq('track', 'PageView');
    }
    // TikTok Pixel
    if (/^[A-Z0-9]{15,30}$/.test(ids.tiktok || '')) {
        var ttq = window.ttq = window.ttq || [];
        ttq.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie'];
        ttq.setAndDefer = function (t, e) { t[e] = function () { t.push([e].concat(Array.prototype.slice.call(arguments, 0))); }; };
        for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
        load('https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=' + encodeURIComponent(ids.tiktok) + '&lib=ttq');
        ttq.page();
    }
    // Snap Pixel
    if (/^[0-9a-f-]{36}$/.test(ids.snapchat || '')) {
        var a = window.snaptr = function () { a.handleRequest ? a.handleRequest.apply(a, arguments) : a.queue.push(arguments); };
        a.queue = [];
        load('https://sc-static.net/scevent.min.js');
        window.snaptr('init', ids.snapchat, {});
        window.snaptr('track', 'PAGE_VIEW');
    }
    // Google Analytics 4
    if (/^G-[A-Z0-9]{6,14}$/.test(ids.google || '')) {
        window.dataLayer = window.dataLayer || [];
        window.gtag = function () { window.dataLayer.push(arguments); };
        load('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(ids.google));
        window.gtag('js', new Date());
        window.gtag('config', ids.google, { anonymize_ip: true });
    }

    var META = { view_item: 'ViewContent', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout', purchase: 'Purchase' };
    var TIKTOK = { view_item: 'ViewContent', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout', purchase: 'CompletePayment' };
    var SNAP = { view_item: 'VIEW_CONTENT', add_to_cart: 'ADD_CART', begin_checkout: 'START_CHECKOUT', purchase: 'PURCHASE' };
    window.afusTrack = function (event, data) {
        var d = data || {};
        var value = Number(d.value) || 0;
        try {
            if (window.fbq && META[event]) window.fbq('track', META[event], { content_ids: d.id ? [d.id] : [], content_name: d.name || '', content_type: 'product', value: value, currency: currency });
            if (window.ttq && TIKTOK[event]) window.ttq.track(TIKTOK[event], { content_id: d.id || '', content_name: d.name || '', content_type: 'product', quantity: d.quantity || 1, value: value, currency: currency });
            if (window.snaptr && SNAP[event]) window.snaptr('track', SNAP[event], { item_ids: d.id ? [d.id] : [], price: value, currency: currency, number_items: d.quantity || 1 });
            if (window.gtag) window.gtag('event', event, { currency: currency, value: value, items: d.id ? [{ item_id: d.id, item_name: d.name || '', quantity: d.quantity || 1, price: value }] : [] });
        } catch { /* a tool that failed never stops the page */ }
    };
    // Events said before this file was read (the page's own script is first)
    var early = window.afusTrackQueue || [];
    window.afusTrackQueue = { push: function (x) { window.afusTrack(x[0], x[1]); } };
    for (var k = 0; k < early.length; k++) window.afusTrack(early[k][0], early[k][1]);
}());
