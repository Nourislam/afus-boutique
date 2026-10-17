/*
 * The shop website's script (published as assets/store.js, the only script
 * of the website: Content-Security-Policy script-src 'self').
 *
 *   - the cart, kept in this browser only (localStorage), never sent
 *     anywhere until the customer confirms the order on checkout.html
 *   - colour / size choice on an article page (what is available)
 *   - search, filters and sort of the lists of articles
 *   - cart and checkout pages, from search.json (the public catalogue:
 *     names, prices and availability the pages already show)
 *
 * Every shop text is put in the page with textContent, never as HTML.
 * Without this script the pages still show every article, and each article
 * page keeps its direct order form.
 */
(function () {
    'use strict';
    var base = location.pathname.replace(/[^/]*$/, '');
    var KEY = 'afus-cart-v1:' + base;
    var MAX_LINES = 30;
    var MAX_QTY = 20;
    var catalog = null;

    function readCart() {
        try {
            var list = JSON.parse(localStorage.getItem(KEY) || '[]');
            return Array.isArray(list) ? list.filter(function (l) { return l && typeof l.id === 'string'; }).slice(0, MAX_LINES) : [];
        } catch { return []; }
    }
    function writeCart(list) {
        try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_LINES))); } catch { /* private window: the cart lasts this page only */ }
        // Another cart is another order: a new order key
        try { sessionStorage.removeItem(ORDER_KEY); } catch { /* nothing kept */ }
        badges(list);
    }
    function count(list) { return list.reduce(function (n, l) { return n + (l.qty || 0); }, 0); }
    function badges(list) {
        var n = count(list || readCart());
        document.querySelectorAll('[data-cart-count]').forEach(function (el) {
            el.textContent = n > 99 ? '99+' : String(n);
            el.hidden = n === 0;
        });
    }
    function sameLine(a, b) { return a.id === b.id && (a.color || '') === (b.color || '') && (a.size || '') === (b.size || ''); }
    /** Adds to the cart (same article, colour and size: one line); 'capped' when 20 was reached. */
    function addLine(line) {
        var list = readCart();
        var found = list.filter(function (l) { return sameLine(l, line); })[0];
        var capped = false;
        if (found) { capped = found.qty + line.qty > MAX_QTY; found.qty = Math.min(MAX_QTY, found.qty + line.qty); }
        else if (list.length < MAX_LINES) list.push(line);
        else return false;
        writeCart(list);
        return capped ? 'capped' : true;
    }

    function loadCatalog() {
        if (catalog) return Promise.resolve(catalog);
        return fetch(base + 'search.json', { credentials: 'same-origin', cache: 'no-cache' })
            .then(function (r) { if (!r.ok) throw new Error('catalog'); return r.json(); })
            .then(function (data) { catalog = data; return data; });
    }

    /* The communes of each wilaya (assets/communes.json): the commune field becomes a list */
    var communes = null;
    function loadCommunes() {
        if (!communes) {
            communes = fetch(base + 'assets/communes.json', { credentials: 'same-origin' })
                .then(function (r) { if (!r.ok) throw new Error('communes'); return r.json(); })
                .catch(function () { return null; });
        }
        return communes;
    }
    /**
     * For each wilaya + commune pair of the form: once the list is there, the
     * typed field is swapped for a list of the chosen wilaya's communes (in the
     * page's language); without the list the typed field stays.
     */
    function communeLists(form, texts) {
        var ar = document.documentElement.lang === 'ar';
        [['wilaya', 'commune'], ['office_wilaya', 'office_commune']].forEach(function (pair) {
            var w = form.elements[pair[0]];
            var input = form.elements[pair[1]];
            if (!w || !input || input.tagName !== 'INPUT') return;
            loadCommunes().then(function (data) {
                if (!data) return;
                var select = document.createElement('select');
                select.required = true;
                select.disabled = input.disabled;
                select.setAttribute('data-commune-list', '');
                function fill() {
                    var list = data[String(parseInt(w.value, 10) || '')] || [];
                    var keep = select.value;
                    select.innerHTML = '';
                    var first = document.createElement('option');
                    first.value = '';
                    first.textContent = texts[list.length ? 'chooseCommune' : 'chooseWilayaFirst'] || '';
                    select.appendChild(first);
                    list.forEach(function (c) {
                        var o = document.createElement('option');
                        o.value = ar ? c[1] : c[0];
                        o.textContent = ar ? c[1] : c[0];
                        select.appendChild(o);
                    });
                    if (keep && list.some(function (c) { return (ar ? c[1] : c[0]) === keep; })) select.value = keep;
                }
                fill();
                // The typed text (when there was one) is kept if it is in the list
                if (input.value) select.value = input.value;
                input.removeAttribute('name');
                input.hidden = true;
                select.name = pair[1];
                input.parentNode.insertBefore(select, input.nextSibling);
                w.addEventListener('change', fill);
                // The block of a delivery not chosen turns its fields off: the list follows
                new MutationObserver(function () { select.disabled = input.disabled; }).observe(input, { attributes: true, attributeFilter: ['disabled'] });
            });
        });
    }

    /* Money as the pages write it ("1 234 567 د.ج") */
    function money(amount, fmt) {
        var value = Math.round((Number(amount) || 0) * 100) / 100;
        var whole = Math.floor(value);
        var cents = Math.round((value - whole) * 100);
        var digits = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, fmt.group);
        return fmt.prefix + digits + (cents ? fmt.decimal + String(cents).padStart(2, '0') : '') + fmt.suffix;
    }
    function el(tag, cls, text) {
        var node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }
    function priced(fmt, amount) {
        var b = el('bdi', '', money(amount, fmt));
        b.dir = 'ltr';
        return b;
    }

    /* The shop's ads / visit tools (assets/track.js, when turned on): what was seen or ordered, no person */
    function track(event, data) {
        if (window.afusTrack) { window.afusTrack(event, data); return; }
        (window.afusTrackQueue = window.afusTrackQueue || []).push([event, data]);
    }

    /*
     * What an order costs, under its form: the goods, the coupon, the delivery
     * (the shop's price for the wilaya and the way chosen; the API works it
     * out again), the total. getLines() -> [{ id, cat, price, qty }].
     */
    function setupTotals(form, getLines) {
        var box = form.querySelector('[data-osum]');
        var texts = window.AFUS_TEXTS || {};
        var prices = {};
        try { prices = JSON.parse(form.getAttribute('data-delivery') || '{}') || {}; } catch { prices = {}; }
        var coupon = null;
        var fmt = null;
        function wilaya() { var w = form.elements.wilaya; return w ? parseInt(w.value, 10) || 0 : 0; }
        function way() { var d = form.elements.delivery; return (d && d.value) || 'home'; }
        function has(v) { return v !== null && v !== undefined; }
        function fee(goods) {
            var code = wilaya();
            if (!code) return undefined;
            var w = (prices.wilayas || []).filter(function (x) { return x.code === code; })[0];
            if (w && w.off) return false;
            var p = w && has(w[way()]) ? w[way()] : prices[way()];
            if (!has(p)) return null;
            return has(prices.freeOver) && goods >= prices.freeOver ? 0 : p;
        }
        function discount(lines) {
            if (!coupon) return 0;
            var all = lines.reduce(function (n, l) { return n + l.price * l.qty; }, 0);
            if (coupon.minPurchase && all < coupon.minPurchase) return 0;
            var base = lines.filter(function (l) {
                return coupon.appliesTo === 'all' || (coupon.appliesTo === 'product' && coupon.ids.indexOf(l.id) !== -1) || (coupon.appliesTo === 'category' && coupon.ids.indexOf(l.cat) !== -1);
            }).reduce(function (n, l) { return n + l.price * l.qty; }, 0);
            var d = coupon.type === 'percentage' ? base * coupon.value / 100 : Math.min(coupon.value, base);
            return Math.round(Math.max(0, d) * 100) / 100;
        }
        function put(sel, amount) {
            var e = box.querySelector(sel);
            if (!e) return;
            e.textContent = '';
            e.appendChild(priced(fmt, amount));
        }
        var last = { goods: 0, fee: null, discount: 0, total: 0 };
        function update() {
            if (!box || !fmt) return last;
            var lines = getLines();
            var goods = lines.reduce(function (n, l) { return n + l.price * l.qty; }, 0);
            var d = discount(lines);
            var f = fee(goods);
            put('[data-sum-goods]', goods);
            var row = box.querySelector('[data-sum-coupon-row]');
            if (row) row.hidden = !d;
            if (d) put('[data-sum-coupon]', -d);
            var de = box.querySelector('[data-sum-delivery]');
            if (f === undefined) de.textContent = texts.deliveryChoose || '';
            else if (f === null) de.textContent = texts.deliveryByPhone || '';
            else if (f === false) de.textContent = texts.notDelivered || '';
            else if (f === 0) de.textContent = texts.deliveryFree || '';
            else { de.textContent = ''; de.appendChild(priced(fmt, f)); }
            var total = goods - d + (typeof f === 'number' ? f : 0);
            put('[data-sum-total]', total);
            last = { goods: goods, fee: f, discount: d, total: total };
            return last;
        }
        loadCatalog().then(function (data) { fmt = data.money; update(); }).catch(function () { /* no figures: the shop gives them on the phone */ });
        form.addEventListener('change', update);
        form.addEventListener('input', function (e) { if (e.target.name === 'qty') update(); });

        // A coupon: checked by the shop's API (a few tries only), checked again when the order arrives
        var cbox = form.querySelector('[data-coupon]');
        var api = document.body.getAttribute('data-api');
        if (cbox && api) {
            var input = cbox.querySelector('input[name="coupon_try"]');
            var hidden = cbox.querySelector('input[name="coupon"]');
            var msg = cbox.querySelector('[data-coupon-msg]');
            var apply = function () {
                var code = String(input.value || '').trim();
                if (!code) { coupon = null; hidden.value = ''; msg.textContent = ''; update(); return; }
                fetch(api + '/api/coupon?code=' + encodeURIComponent(code), { credentials: 'omit' })
                    .then(function (r) { return r.json(); })
                    .then(function (j) {
                        coupon = j && j.ok ? { type: j.type, value: Number(j.value) || 0, appliesTo: j.appliesTo || 'all', ids: j.ids || [], minPurchase: Number(j.minPurchase) || 0 } : null;
                        hidden.value = coupon ? j.code : '';
                        msg.textContent = coupon ? (texts.couponOk || '') + (j.name ? ' — ' + j.name : '') : texts.couponBad || '';
                        msg.className = 'coupon-msg ' + (coupon ? 'is-ok' : 'is-bad');
                        update();
                    })
                    .catch(function () { msg.textContent = texts.couponDown || ''; msg.className = 'coupon-msg is-bad'; });
            };
            cbox.querySelector('[data-coupon-apply]').addEventListener('click', apply);
            input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
        }
        return { update: update, last: function () { return last; } };
    }

    /* ---------- Article page: choose colour and size, add to cart ---------- */
    function setupAddForm(form) {
        var variants = [];
        try { variants = JSON.parse(form.getAttribute('data-variants') || '[]'); } catch { variants = []; }
        var hasColors = form.getAttribute('data-has-colors') === '1';
        var hasSizes = form.getAttribute('data-has-sizes') === '1';
        var msg = form.querySelector('[data-form-msg]');
        var submitter = 'add';
        function chosen(name) { var c = form.querySelector('input[name="' + name + '"]:checked'); return c ? c.value : ''; }
        function available(color, size) {
            return variants.some(function (v) { return v[2] && (!color || v[0] === color) && (!size || v[1] === size); });
        }
        var few = document.querySelector('[data-few]');
        var fewProduct = few ? !few.hidden : false;
        function refresh() {
            var color = chosen('color');
            var size = chosen('size');
            // "Few left": for the colour and size chosen (else the whole article)
            if (few) {
                var v = variants.filter(function (x) { return (x[0] || '') === color && (x[1] || '') === size; })[0];
                few.hidden = v ? !(v[2] && v[4]) : !fewProduct;
            }
            form.querySelectorAll('input[name="size"]').forEach(function (input) {
                var ok = available(color, input.value);
                input.disabled = !ok;
                input.parentNode.classList.toggle('is-off', !ok);
                if (!ok && input.checked) input.checked = false;
            });
            form.querySelectorAll('input[name="color"]').forEach(function (input) {
                var ok = available(input.value, size);
                input.parentNode.classList.toggle('is-off', !ok && !input.disabled);
            });
        }
        function say(text, good, link) {
            if (!msg) return;
            msg.textContent = text;
            msg.className = 'form-msg ' + (good ? 'is-ok' : 'is-bad');
            if (link) {
                var a = el('a', '', link.label);
                a.href = link.href;
                msg.appendChild(a);
            }
        }
        form.addEventListener('change', function (e) {
            // A colour or a size chosen: an old "choose first" message goes
            if ((e.target.name === 'color' || e.target.name === 'size') && msg && msg.classList.contains('is-bad')) { msg.textContent = ''; msg.className = 'form-msg'; }
            if (e.target.name === 'color') {
                // A new colour: the sizes of that colour become choosable again
                form.querySelectorAll('input[name="size"]').forEach(function (input) { input.disabled = false; });
            }
            refresh();
        });
        form.querySelectorAll('button[name="action"]').forEach(function (b) {
            b.addEventListener('click', function () { submitter = b.value; });
        });
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var texts = (window.AFUS_TEXTS || {});
            var action = (e.submitter && e.submitter.value) || submitter;
            var color = chosen('color');
            var size = chosen('size');
            if ((hasColors && !color) || (hasSizes && !size)) { say(texts.chooseFirst || '', false); return; }
            if (variants.length && !available(color, size)) { say(texts.notThisOne || '', false); return; }
            var qtyInput = form.querySelector('input[name="qty"]');
            var asked = parseInt(qtyInput && qtyInput.value, 10);
            if (!(asked >= 1 && asked <= MAX_QTY)) {
                if (qtyInput) qtyInput.value = String(Math.min(MAX_QTY, Math.max(1, asked || 1)));
                say(texts.maxQty || '', false);
                return;
            }
            var added = addLine({ id: form.getAttribute('data-id'), color: color, size: size, qty: asked });
            if (!added) return;
            track('add_to_cart', { id: form.getAttribute('data-id'), quantity: asked });
            if (action === 'buy') { location.href = base + 'checkout.html'; return; }
            say(added === 'capped' ? texts.maxQty || '' : texts.added || '', added !== 'capped', { label: texts.viewCart || '', href: base + 'cart.html' });
        });
        // The choice, for the order form under it: { ok, color, size, qty, price } or { ok: false, msg }
        form.afusChoice = function () {
            var texts = window.AFUS_TEXTS || {};
            var color = chosen('color');
            var size = chosen('size');
            if ((hasColors && !color) || (hasSizes && !size)) return { ok: false, msg: texts.chooseFirst || '' };
            if (variants.length && !available(color, size)) return { ok: false, msg: texts.notThisOne || '' };
            var qtyInput = form.querySelector('input[name="qty"]');
            var asked = parseInt(qtyInput && qtyInput.value, 10);
            if (!(asked >= 1 && asked <= MAX_QTY)) return { ok: false, msg: texts.maxQty || '' };
            var v = variants.filter(function (x) { return (x[0] || '') === color && (x[1] || '') === size; })[0];
            return { ok: true, color: color, size: size, qty: asked, price: v && v[3] !== null && v[3] !== undefined ? v[3] : null };
        };
        form.afusSay = say;
        // Quantity: - and + around the number (the number can still be typed)
        form.querySelectorAll('[data-step]').forEach(function (b) {
            b.addEventListener('click', function () {
                var input = form.querySelector('input[name="qty"]');
                var now = parseInt(input.value, 10) || 1;
                input.value = String(Math.min(MAX_QTY, Math.max(1, now + Number(b.getAttribute('data-step')))));
            });
        });
        setupBuyBar(form);
        refresh();
    }

    /* Phones: once "Order now" is scrolled away, a bar at the bottom keeps the price and the button */
    function setupBuyBar(form) {
        var bar = document.querySelector('[data-buy-bar]');
        var order = document.querySelector('[data-quick-order]');
        var buy = order || form.querySelector('[data-add]');
        if (!bar || !buy) return;
        // Only once the button is above the screen (the buyer read on), never before it.
        // Read on scroll, once per frame (a fast flick can jump over the button)
        var pending = false;
        function place() {
            pending = false;
            var show = buy.getBoundingClientRect().bottom < 0;
            if (bar.hidden === !show) return;
            bar.hidden = !show;
            document.body.classList.toggle('buybar-on', show);
        }
        window.addEventListener('scroll', function () {
            if (!pending) { pending = true; requestAnimationFrame(place); }
        }, { passive: true });
        place();
        bar.querySelector('[data-buy-now]').addEventListener('click', function () {
            // The order form: back to it, the first field ready; no form: Add to cart
            if (order) {
                form.scrollIntoView({ block: 'start', behavior: 'smooth' });
                var first = order.querySelector('input:not([type=hidden]):not([tabindex="-1"])');
                if (first) setTimeout(function () { first.focus({ preventScroll: true }); }, 400);
                return;
            }
            buy.scrollIntoView({ block: 'center', behavior: 'smooth' });
            if (form.requestSubmit) form.requestSubmit(buy); else buy.click();
        });
    }

    /* Article photos: swiped on phones (dots follow), chosen from the thumbnails */
    function setupGallery(root) {
        var track = root.querySelector('[data-track]');
        if (!track) return;
        var slides = track.children;
        var dots = root.querySelectorAll('.g-dots span');
        var thumbs = root.querySelectorAll('[data-go]');
        function current() {
            var w = track.clientWidth || 1;
            return Math.min(slides.length - 1, Math.round(Math.abs(track.scrollLeft) / w));
        }
        function mark(i) {
            dots.forEach(function (d, k) { d.classList.toggle('is-on', k === i); });
            thumbs.forEach(function (t, k) { t.classList.toggle('is-on', k === i); });
        }
        var pending = false;
        track.addEventListener('scroll', function () {
            if (pending) return;
            pending = true;
            requestAnimationFrame(function () { pending = false; mark(current()); });
        }, { passive: true });
        thumbs.forEach(function (t) {
            t.addEventListener('click', function () {
                var i = Number(t.getAttribute('data-go')) || 0;
                if (slides[i]) track.scrollTo({ left: slides[i].offsetLeft - slides[0].offsetLeft, behavior: 'smooth' });
                mark(i);
            });
        });
        mark(0);
    }

    /* ---------- Lists: search, filters, sort ---------- */
    function fold(text) {
        return String(text || '').toLowerCase()
            .replace(/[ً-ْـ]/g, '')
            .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
            .normalize('NFD').replace(/[̀-ͯ]/g, '');
    }
    function setupListing(root) {
        var form = root.querySelector('[data-filters]');
        var grid = root.querySelector('.grid');
        if (!form || !grid) return;
        var cards = Array.prototype.slice.call(grid.querySelectorAll('.card'));
        var counter = form.querySelector('[data-count]');
        var word = counter ? counter.textContent.replace(/^\s*\d+\s*/, '') : '';
        var none = root.querySelector('[data-no-results]');
        var out = form.querySelector('[data-price-out]');
        var search = form.querySelector('[data-search-input]');
        var query = new URLSearchParams(location.search).get('q');
        if (search && query) search.value = query.slice(0, 80);
        cards.forEach(function (c) { c.setAttribute('data-fold', fold(c.getAttribute('data-search'))); });

        function values(name) {
            return Array.prototype.slice.call(form.querySelectorAll('input[name="' + name + '"]:checked')).map(function (i) { return i.value; });
        }
        function apply() {
            var words = search ? fold(search.value).split(/\s+/).filter(Boolean) : [];
            var sizes = values('size');
            var colors = values('color');
            var maxInput = form.querySelector('input[name="max"]');
            var max = maxInput ? Number(maxInput.value) : Infinity;
            var onlyIn = !!form.querySelector('input[name="available"]:checked');
            var onlySale = !!form.querySelector('input[name="sale"]:checked');
            if (out && maxInput) out.textContent = maxInput.value;
            var shown = 0;
            cards.forEach(function (c) {
                var text = c.getAttribute('data-fold');
                var cs = (c.getAttribute('data-sizes') || '').split('|');
                var cc = (c.getAttribute('data-colors') || '').split('|');
                var ok = words.every(function (w) { return text.indexOf(w) !== -1; })
                    && (!sizes.length || sizes.some(function (s) { return cs.indexOf(s) !== -1; }))
                    && (!colors.length || colors.some(function (s) { return cc.indexOf(s) !== -1; }))
                    && Number(c.getAttribute('data-price')) <= max
                    && (!onlyIn || c.getAttribute('data-available') === '1')
                    && (!onlySale || c.getAttribute('data-sale') === '1');
                c.hidden = !ok;
                if (ok) shown++;
            });
            var sortBy = (form.querySelector('select[name="sort"]') || {}).value || 'new';
            var num = function (c, k) { return Number(c.getAttribute(k)) || 0; };
            var sorted = cards.slice().sort(function (a, b) {
                if (sortBy === 'price-up') return num(a, 'data-price') - num(b, 'data-price');
                if (sortBy === 'price-down') return num(b, 'data-price') - num(a, 'data-price');
                if (sortBy === 'name') return a.getAttribute('data-name').localeCompare(b.getAttribute('data-name'));
                if (sortBy === 'best') return num(a, 'data-best') - num(b, 'data-best');
                return String(b.getAttribute('data-new')).localeCompare(String(a.getAttribute('data-new')));
            });
            sorted.forEach(function (c) { grid.appendChild(c); });
            if (counter) counter.textContent = shown + ' ' + word;
            if (none) none.hidden = shown !== 0;
            grid.hidden = shown === 0;
        }
        form.addEventListener('input', apply);
        form.addEventListener('change', apply);
        form.addEventListener('submit', function (e) { e.preventDefault(); apply(); });
        form.addEventListener('reset', function () { setTimeout(function () { if (search) search.value = ''; apply(); }, 0); });
        apply();
    }

    /* ---------- Cart and checkout ---------- */
    function linesOf(data) {
        var byId = {};
        data.products.forEach(function (p) { byId[p.id] = p; });
        var kept = [];
        var lines = readCart().map(function (l) {
            var p = byId[l.id];
            if (!p || !p.available) return null;
            var price = p.price;
            if (p.variants.length) {
                var v = p.variants.filter(function (x) { return (x[0] || '') === (l.color || '') && (x[1] || '') === (l.size || ''); })[0];
                if (!v || !v[2]) return null;
                if (v[3] !== null && v[3] !== undefined) price = v[3];
            }
            kept.push(l);
            return { line: l, product: p, price: price };
        }).filter(Boolean);
        // Articles sold out or removed by the shop leave the cart
        if (kept.length !== readCart().length) writeCart(kept);
        return lines;
    }
    function lineNode(item, data, tools, onChange) {
        var row = el('div', 'cart-line');
        row.setAttribute('data-id', item.line.id);
        row.setAttribute('data-color', item.line.color || '');
        row.setAttribute('data-size', item.line.size || '');
        var img = el('img');
        img.src = item.product.image;
        img.alt = '';
        img.loading = 'lazy';
        var info = el('div');
        var name = el('a', 'line-name', item.product.name);
        name.href = item.product.url;
        info.appendChild(name);
        var opts = [item.line.color, item.line.size].filter(Boolean).join(' · ');
        info.appendChild(el('span', 'line-opts', opts + (tools ? '' : (opts ? ' · ' : '') + '× ' + item.line.qty)));
        if (tools) {
            var box = el('div', 'line-tools');
            var minus = el('button', '', '−');
            var plus = el('button', '', '+');
            var remove = el('button', 'line-remove', data.texts.remove);
            [minus, plus, remove].forEach(function (b) { b.type = 'button'; });
            minus.setAttribute('aria-label', '-1');
            plus.setAttribute('aria-label', '+1');
            // 1 to 20 pieces a line; "remove" takes the line out
            minus.disabled = item.line.qty <= 1;
            plus.disabled = item.line.qty >= MAX_QTY;
            minus.addEventListener('click', function () { onChange(item.line, Math.max(1, item.line.qty - 1)); });
            plus.addEventListener('click', function () { onChange(item.line, Math.min(MAX_QTY, item.line.qty + 1)); });
            remove.addEventListener('click', function () { onChange(item.line, 0); });
            box.appendChild(minus);
            box.appendChild(el('span', 'line-qty', String(item.line.qty)));
            box.appendChild(plus);
            box.appendChild(remove);
            info.appendChild(box);
        }
        var price = el('span', 'line-price');
        price.appendChild(priced(data.money, item.price * item.line.qty));
        row.appendChild(img);
        row.appendChild(info);
        row.appendChild(price);
        return row;
    }
    function total(lines) { return lines.reduce(function (s, i) { return s + i.price * i.line.qty; }, 0); }
    function setQty(line, qty) {
        var list = readCart();
        list.forEach(function (l) { if (sameLine(l, line)) l.qty = qty; });
        writeCart(list.filter(function (l) { return l.qty > 0; }));
    }
    function fillSum(root, data, lines) {
        root.querySelectorAll('[data-cart-sum]').forEach(function (s) {
            s.textContent = '';
            s.appendChild(priced(data.money, total(lines)));
        });
    }

    function setupCart(root) {
        function draw() {
            loadCatalog().then(function (data) {
                var lines = linesOf(data);
                var box = root.querySelector('[data-cart-lines]');
                box.textContent = '';
                lines.forEach(function (item) { box.appendChild(lineNode(item, data, true, function (l, q) { setQty(l, q); draw(); })); });
                root.querySelector('[data-cart-empty]').hidden = lines.length > 0;
                root.querySelector('[data-cart-total]').hidden = lines.length === 0;
                fillSum(root, data, lines);
            }).catch(function () { /* catalogue not reachable: the page stays as it is */ });
        }
        draw();
    }

    /* Same rules as the shop's API (worker.mjs) */
    function algerianPhone(text) {
        var d = String(text || '').replace(/[\s.-]/g, '');
        if (/[^\d+]/.test(d)) return '';
        d = d.replace(/^(\+|00)213/, '0');
        return /^0[5-7]\d{8}$/.test(d) || /^0[1-49]\d{7}$/.test(d) ? d : '';
    }
    var CHECKS = {
        customer_name: ['errFullName', function (v) { return v.length >= 3; }],
        first_name: ['errName', function (v) { return v.length >= 2; }],
        last_name: ['errName', function (v) { return v.length >= 2; }],
        phone: ['errPhone', function (v) { return !!algerianPhone(v); }],
        wilaya: ['errWilaya', function (v) { return !!v; }],
        commune: ['errCommune', function (v) { return v.length >= 2; }],
        address: ['errAddress', function (v) { return v.length >= 3; }],
        courier_company: ['errCourier', function (v) { return !!v; }],
        office_wilaya: ['errWilaya', function (v) { return !!v; }],
        office_commune: ['errCommune', function (v) { return v.length >= 2; }],
        courier_office: ['errOffice', function (v) { return v.length >= 2; }],
    };

    /**
     * The checks of an order form (the checkout, the form on an article's page):
     * each field says what is wrong next to it; the fields of the delivery not
     * chosen are off (not checked, not sent).
     */
    function orderChecks(form, texts) {
        var msg = form.querySelector('[data-form-msg]');
        var tried = false;
        // Home delivery: the address; courier office: what the form asks for it
        function delivery() { var d = form.elements.delivery; return (d && d.value) || 'home'; }
        var live = !(form.querySelector('[data-confirm]') || {}).disabled;
        function showDelivery() {
            if (!live) return;
            var chosen = delivery();
            form.querySelectorAll('[data-when]').forEach(function (block) {
                var on = block.getAttribute('data-when') === chosen;
                block.hidden = !on;
                block.querySelectorAll('input, select, textarea').forEach(function (f) { f.disabled = !on; });
            });
        }
        function check(name) {
            var f = form.elements[name];
            if (!f || !CHECKS[name]) return true;
            // A field of the delivery not chosen: nothing to say about it
            var ok = f.disabled || CHECKS[name][1](String(f.value || '').trim());
            var box = form.querySelector('[data-field="' + name + '"]');
            var err = form.querySelector('[data-err-for="' + name + '"]');
            if (box) box.classList.toggle('is-bad', !ok);
            if (err) { err.textContent = ok ? '' : texts[CHECKS[name][0]] || ''; err.hidden = ok; }
            f.setAttribute('aria-invalid', ok ? 'false' : 'true');
            return ok;
        }
        function checkAll() {
            var first = null;
            Object.keys(CHECKS).forEach(function (name) { if (!check(name) && !first) first = form.elements[name]; });
            return first;
        }
        // After a first try: the message under the button goes once all is right
        function recheck() { if (!checkAll() && msg) msg.hidden = true; }
        form.addEventListener('change', function (e) {
            if (e.target.name === 'delivery') showDelivery();
            // The office is usually in the customer's wilaya
            if (e.target.name === 'wilaya' && form.elements.office_wilaya && !form.elements.office_wilaya.value) {
                form.elements.office_wilaya.value = e.target.value;
                // Its commune list follows
                form.elements.office_wilaya.dispatchEvent(new Event('change'));
            }
            if (tried) recheck(); else if (e.target.name) check(e.target.name);
        });
        form.addEventListener('input', function (e) { if (tried && e.target.name) { check(e.target.name); recheck(); } });
        showDelivery();
        communeLists(form, texts);
        /** On sending: the first wrong field (and the message under the button), or null. */
        function verify() {
            tried = true;
            var first = checkAll();
            if (msg) { msg.textContent = first ? texts.errForm || '' : ''; msg.hidden = !first; }
            return first;
        }
        return { verify: verify, delivery: delivery };
    }

    function setupCheckout(root) {
        var form = root.querySelector('[data-checkout-form]');
        if (!form) return;
        var texts = window.AFUS_TEXTS || {};
        var sending = false;
        var checks = orderChecks(form, texts);
        var current = [];
        var totals = setupTotals(form, function () { return current; });

        // One key per order (kept until the thanks page): sent twice, it is still one order
        var keyField = form.querySelector('[data-order-key]');
        if (keyField) keyField.value = orderKey();

        var ready = false;
        loadCatalog().then(function (data) {
            var lines = linesOf(data);
            var box = root.querySelector('[data-summary-lines]');
            box.textContent = '';
            lines.forEach(function (item) { box.appendChild(lineNode(item, data, false)); });
            fillSum(root, data, lines);
            current = lines.map(function (i) { return { id: i.product.id, cat: i.product.cat || '', price: i.price, qty: i.line.qty }; });
            totals.update();
            if (lines.length) track('begin_checkout', { value: total(lines), quantity: lines.reduce(function (n, i) { return n + i.line.qty; }, 0) });
            root.classList.toggle('is-empty', lines.length === 0);
            if (!lines.length) {
                box.appendChild(el('p', 'empty', data.texts.cartEmpty));
                return;
            }
            form.querySelector('[data-items]').value = JSON.stringify(lines.map(function (i) {
                return { product_id: i.product.id, product_name: i.product.name, color: i.line.color || '', size: i.line.size || '', quantity: i.line.qty, unit_price: i.price };
            }));
            form.querySelector('[data-first-id]').value = lines[0].product.id;
            form.querySelector('[data-first-name]').value = lines[0].product.name + (lines.length > 1 ? ' +' + (lines.length - 1) : '');
            ready = true;
        }).catch(function () { root.classList.add('is-empty'); });

        form.addEventListener('submit', function (e) {
            var first = checks.verify();
            if (sending || !ready || first) {
                e.preventDefault();
                if (first) first.focus();
                return;
            }
            sending = true;
            remember(totals.update().total, current.length === 1 ? current[0].id : '', '', current.reduce(function (n, l) { return n + l.qty; }, 0));
            var button = form.querySelector('[data-confirm]');
            // Sent once (a second press would send a second order)
            if (button) setTimeout(function () { button.disabled = true; }, 0);
        });
    }

    /*
     * The order form on an article's page: the colour, size and quantity chosen
     * above go with it (one line); "Order on WhatsApp" writes the same in the chat.
     */
    function setupQuickOrder(form) {
        var texts = window.AFUS_TEXTS || {};
        var add = document.querySelector('[data-add-form]');
        var checks = orderChecks(form, texts);
        var sending = false;
        var keyField = form.querySelector('[data-order-key]');
        if (keyField) keyField.value = orderKey();
        function choice() { return add && add.afusChoice ? add.afusChoice() : { ok: true, color: '', size: '', qty: 1, price: null }; }
        function value(name) { var f = form.elements[name]; return f && !f.disabled ? String(f.value || '').trim() : ''; }
        // The price the customer pays: the cart's (search.json: the sale applied to each colour and size)
        var pid = form.elements.product_id.value;
        var listed = null;
        loadCatalog().then(function (data) { listed = data.products.filter(function (p) { return p.id === pid; })[0] || null; totals.update(); }).catch(function () { /* the page's price */ });
        function unitPrice(c) {
            if (listed && listed.variants.length) {
                var v = listed.variants.filter(function (x) { return (x[0] || '') === (c.color || '') && (x[1] || '') === (c.size || ''); })[0];
                if (v && v[3] !== null && v[3] !== undefined) return v[3];
            }
            return listed ? listed.price : Number(form.getAttribute('data-price')) || 0;
        }
        var totals = setupTotals(form, function () {
            var c = choice();
            return [{ id: pid, cat: form.getAttribute('data-cat') || '', price: unitPrice(c), qty: c.ok ? c.qty : (c.qty || 1) }];
        });
        if (add) add.addEventListener('change', function () { totals.update(); });
        if (add) add.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-step]')) setTimeout(totals.update, 0); });
        track('view_item', { id: pid, name: form.elements.product_name.value, value: Number(form.getAttribute('data-price')) || 0, quantity: 1 });

        form.addEventListener('submit', function (e) {
            var c = choice();
            if (!c.ok) {
                e.preventDefault();
                if (add && add.afusSay) add.afusSay(c.msg, false);
                if (add) add.scrollIntoView({ block: 'center', behavior: 'smooth' });
                return;
            }
            var first = checks.verify();
            if (sending || first) {
                e.preventDefault();
                if (first) first.focus();
                return;
            }
            var price = unitPrice(c);
            var sum = totals.update();
            remember(sum.total, pid, form.elements.product_name.value, c.qty);
            track('begin_checkout', { id: pid, name: form.elements.product_name.value, value: sum.total, quantity: c.qty });
            form.querySelector('[data-items]').value = JSON.stringify([{
                product_id: form.elements.product_id.value, product_name: form.elements.product_name.value,
                color: c.color || '', size: c.size || '', quantity: c.qty, unit_price: Number.isFinite(price) ? price : null,
            }]);
            sending = true;
            var button = form.querySelector('[data-confirm]');
            if (button) setTimeout(function () { button.disabled = true; }, 0);
        });

        // WhatsApp: the article, the choice and what is already filled in, in the message
        var wa = form.querySelector('[data-wa]');
        if (wa) wa.addEventListener('click', function () {
            var c = choice();
            var lines = [(texts.orderText || '') + ' ' + form.elements.product_name.value];
            if (c.color) lines.push((texts.waColor || '') + ': ' + c.color);
            if (c.size) lines.push((texts.waSize || '') + ': ' + c.size);
            if (c.qty) lines.push((texts.waQty || '') + ': ' + c.qty);
            [['customer_name', 'fullName'], ['phone', 'yourPhone'], ['wilaya', 'wilaya'], ['commune', 'commune'], ['address', 'addressField']].forEach(function (f) {
                var v = value(f[0]);
                if (v) lines.push((texts[f[1]] || f[1]) + ': ' + v);
            });
            var d = checks.delivery();
            lines.push((texts.waDelivery || '') + ': ' + (texts[d === 'office' ? 'deliveryOffice' : 'deliveryHome'] || d));
            wa.href = 'https://wa.me/' + wa.getAttribute('data-wa') + '?text=' + encodeURIComponent(lines.join('\n'));
        });
    }

    /* The order's value, kept until the thanks page (the ads tools are told the order went through) */
    var LAST = 'afus-last-order-v1';
    function remember(value, id, name, qty) {
        try { sessionStorage.setItem(LAST, JSON.stringify({ value: value, id: id, name: name, quantity: qty })); } catch { /* private window */ }
    }
    function purchased() {
        var x = null;
        try { x = JSON.parse(sessionStorage.getItem(LAST) || 'null'); sessionStorage.removeItem(LAST); } catch { x = null; }
        if (x) track('purchase', x);
    }

    /* How many times the page was seen: its name only, to the shop's own API (no person, no cookie) */
    function countView() {
        var api = document.body.getAttribute('data-api');
        var page = document.body.getAttribute('data-page');
        if (!api || !page || !navigator.sendBeacon) return;
        try { navigator.sendBeacon(api + '/api/view', page); } catch { /* not counted */ }
    }

    /* The order key of the checkout (idempotency): random, the same until the order is through */
    var ORDER_KEY = 'afus-order-key-v1:' + base;
    function randomKey() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        var bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    }
    function orderKey() {
        var key = null;
        try { key = sessionStorage.getItem(ORDER_KEY); } catch { key = null; }
        if (!key || !/^[A-Za-z0-9-]{16,64}$/.test(key)) {
            key = randomKey();
            try { sessionStorage.setItem(ORDER_KEY, key); } catch { /* private window: one key for this page */ }
        }
        return key;
    }

    /* After the order: the cart is empty again (only when the cart was sent), a new key next time */
    function afterOrder() {
        if (!document.body.classList.contains('page-thanks')) return;
        purchased();
        if (new URLSearchParams(location.search).get('cart') === '1') writeCart([]);
        try { sessionStorage.removeItem(ORDER_KEY); } catch { /* nothing kept */ }
    }

    function start() {
        try { window.AFUS_TEXTS = JSON.parse(document.body.getAttribute('data-texts') || '{}'); } catch { window.AFUS_TEXTS = {}; }
        afterOrder();
        badges();
        countView();
        document.querySelectorAll('[data-add-form]').forEach(setupAddForm);
        document.querySelectorAll('[data-gallery]').forEach(setupGallery);
        document.querySelectorAll('[data-quick-order]').forEach(setupQuickOrder);
        document.querySelectorAll('[data-listing]').forEach(setupListing);
        document.querySelectorAll('[data-cart-page]').forEach(setupCart);
        document.querySelectorAll('[data-checkout]').forEach(setupCheckout);
        // Another tab changed the cart
        window.addEventListener('storage', function (e) { if (e.key === KEY) badges(); });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
