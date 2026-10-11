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
    function addLine(line) {
        var list = readCart();
        var found = list.filter(function (l) { return sameLine(l, line); })[0];
        if (found) found.qty = Math.min(MAX_QTY, found.qty + line.qty);
        else if (list.length < MAX_LINES) list.push(line);
        else return false;
        writeCart(list);
        return true;
    }

    function loadCatalog() {
        if (catalog) return Promise.resolve(catalog);
        return fetch(base + 'search.json', { credentials: 'same-origin', cache: 'no-cache' })
            .then(function (r) { if (!r.ok) throw new Error('catalog'); return r.json(); })
            .then(function (data) { catalog = data; return data; });
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
        function refresh() {
            var color = chosen('color');
            var size = chosen('size');
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
            var qty = Math.min(MAX_QTY, Math.max(1, parseInt(qtyInput && qtyInput.value, 10) || 1));
            if (!addLine({ id: form.getAttribute('data-id'), color: color, size: size, qty: qty })) return;
            if (action === 'buy') { location.href = base + 'checkout.html'; return; }
            say(texts.added || '', true, { label: texts.viewCart || '', href: base + 'cart.html' });
        });
        refresh();
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
            minus.addEventListener('click', function () { onChange(item.line, item.line.qty - 1); });
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

    function setupCheckout(root) {
        var form = root.querySelector('[data-checkout-form]');
        if (!form) return;
        var sending = false;
        loadCatalog().then(function (data) {
            var lines = linesOf(data);
            var box = root.querySelector('[data-summary-lines]');
            box.textContent = '';
            lines.forEach(function (item) { box.appendChild(lineNode(item, data, false)); });
            fillSum(root, data, lines);
            root.classList.toggle('is-empty', lines.length === 0);
            if (!lines.length) {
                var p = el('p', 'empty', data.texts.cartEmpty);
                box.appendChild(p);
                return;
            }
            form.querySelector('[data-items]').value = JSON.stringify(lines.map(function (i) {
                return { product_id: i.product.id, product_name: i.product.name, color: i.line.color || '', size: i.line.size || '', quantity: i.line.qty, unit_price: i.price };
            }));
            form.querySelector('[data-first-id]').value = lines[0].product.id;
            form.querySelector('[data-first-name]').value = lines[0].product.name + (lines.length > 1 ? ' +' + (lines.length - 1) : '');
        }).catch(function () { root.classList.add('is-empty'); });
        form.addEventListener('submit', function (e) {
            var items = form.querySelector('[data-items]').value;
            if (sending || !items || items === '[]') { e.preventDefault(); return; }
            sending = true;
            var button = form.querySelector('[data-confirm]');
            if (button) button.disabled = true;
        });
    }

    /* After the order: the cart is empty again (only when the cart was sent) */
    function afterOrder() {
        if (document.body.classList.contains('page-thanks') && new URLSearchParams(location.search).get('cart') === '1') writeCart([]);
    }

    function start() {
        try { window.AFUS_TEXTS = JSON.parse(document.body.getAttribute('data-texts') || '{}'); } catch { window.AFUS_TEXTS = {}; }
        afterOrder();
        badges();
        document.querySelectorAll('[data-add-form]').forEach(setupAddForm);
        document.querySelectorAll('[data-listing]').forEach(setupListing);
        document.querySelectorAll('[data-cart-page]').forEach(setupCart);
        document.querySelectorAll('[data-checkout]').forEach(setupCheckout);
        // Another tab changed the cart
        window.addEventListener('storage', function (e) { if (e.key === KEY) badges(); });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
