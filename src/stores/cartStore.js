import { t } from '../i18n';
import { isTaxEnabled } from '../lib/tax';
import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import { bestPromotion } from '../lib/promotions';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const lineTotal = (quantity, unitPrice, discount = 0) => round2(quantity * unitPrice - (discount || 0));

/** Lines of a ticket put on hold (stored as JSON); a damaged record gives none. */
export function heldLines(held) {
    let lines = held?.items_json ?? held?.items;
    try {
        while (typeof lines === 'string') lines = JSON.parse(lines);
    } catch {
        lines = [];
    }
    return Array.isArray(lines) ? lines : [];
}

export const useCartStore = create((set, get) => ({
    items: [],
    customer: null,
    discount: 0,
    discountType: 'fixed', // 'fixed' or 'percent'
    notes: '',

    taxType: 'inclusive', // 'exclusive' or 'inclusive' - default to inclusive
    globalTaxRate: 0,
    currency: 'DZD',
    serviceCharge: 0,
    taxExempt: false,
    // Promotions that can apply automatically, and a coupon typed at checkout
    promotions: [],
    coupon: '',
    // Line added last (highlighted in the ticket after a scan)
    lastAddedId: null,

    loadPromotions: async () => {
        try {
            const promotions = await window.electronAPI.promotions.getActive();
            set({ promotions: Array.isArray(promotions) ? promotions : [] });
        } catch {
            set({ promotions: [] });
        }
    },

    setCoupon: (coupon) => set({ coupon: String(coupon || '').trim() }),

    loadSettings: async () => {
        try {
            const settings = await window.electronAPI.settings.getAll();
            let parsed = { ...settings };
            if (settings.store_config) {
                try {
                    // store_config may already be an object (from new getAll) or a string (legacy)
                    let storeConfig = settings.store_config;
                    if (typeof storeConfig === 'string') {
                        storeConfig = JSON.parse(storeConfig);
                    }
                    parsed = { ...parsed, ...storeConfig };
                } catch (e) {
                    console.error('Error parsing store_config:', e);
                }
            }

            const finalTaxType = parsed.taxType || 'inclusive';
            // 0 is a valid rate (most small Algerian shops sell without TVA)
            const rate = parseFloat(parsed.taxRate);
            const finalTaxRate = Number.isFinite(rate) && rate >= 0 ? rate : 0;
            const finalCurrency = parsed.currency || 'DZD';

            set({
                taxType: finalTaxType,
                globalTaxRate: finalTaxRate,
                taxEnabled: isTaxEnabled(parsed),
                currency: finalCurrency
            });
        } catch (e) {
            console.error('Failed to load settings in cart store', e);
        }
    },

    setServiceCharge: (amount) => set({ serviceCharge: amount }),
    setTaxExempt: (isExempt) => set({ taxExempt: isExempt }),

    /**
     * Add a product, or one variant (colour/size) of it, to the cart.
     * Lines are keyed by product + variant, so scanning the same variant again
     * increases its quantity while a different size gets its own line.
     */
    addItem: (product, quantity = 1, variant = null) => {
        const { items, globalTaxRate } = get();
        const variantId = variant ? variant.id : null;
        const existingIndex = items.findIndex(item =>
            item.product_id === product.id && (item.variant_id || null) === variantId);
        // Use product-specific tax only if explicitly set (> 0), otherwise use global rate
        const itemTaxRate = (product.tax_rate && product.tax_rate > 0) ? product.tax_rate : globalTaxRate;
        const unitPrice = variant && variant.price !== null && variant.price !== undefined && variant.price !== ''
            ? Number(variant.price)
            : Number(product.price) || 0;
        const available = variant ? (variant.stock_quantity ?? 0) : product.stock_quantity;

        if (existingIndex >= 0) {
            const newItems = [...items];
            const line = newItems[existingIndex];
            const maxStock = line.max_stock ?? available ?? 999999;

            if (line.quantity + quantity > maxStock) {
                return { success: false, message: t('cart.insufficientStock') };
            }

            newItems[existingIndex] = {
                ...line,
                quantity: line.quantity + quantity,
                total: lineTotal(line.quantity + quantity, line.unit_price, line.discount),
            };
            set({ items: newItems, lastAddedId: line.id });
            return { success: true, quantity: newItems[existingIndex].quantity };
        }

        if (quantity > available) {
            return { success: false, message: t('cart.insufficientStock') };
        }

        const variantLabel = variant ? [variant.color, variant.size].filter(Boolean).join(' / ') : '';
        const newItem = {
            id: uuid(),
            product_id: product.id,
            product_name: product.name,
            category_id: product.category_id || null,
            brand: product.brand || null,
            image_path: product.image_path || null,
            variant_id: variantId,
            variant_label: variantLabel || null,
            color: variant?.color || null,
            color_code: variant?.color_code || null,
            size: variant?.size || null,
            sku: variant ? variant.sku : (product.sku || null),
            quantity,
            unit_price: unitPrice,
            original_price: unitPrice,
            tax_rate: itemTaxRate,
            discount: 0,
            total: lineTotal(quantity, unitPrice),
            max_stock: available
        };
        set({ items: [...items, newItem], lastAddedId: newItem.id });
        return { success: true, quantity };
    },

    updateItemQuantity: (itemId, quantity) => {
        if (quantity <= 0) {
            get().removeItem(itemId);
            return { success: true };
        }

        const { items } = get();
        const item = items.find(i => i.id === itemId);
        if (!item) return { success: false, message: t('cart.itemNotFound') };

        if (item.max_stock !== undefined && quantity > item.max_stock) {
            return { success: false, message: t('cart.insufficientStock') };
        }

        set(state => ({
            items: state.items.map(item =>
                item.id === itemId
                    ? { ...item, quantity, total: lineTotal(quantity, item.unit_price, item.discount) }
                    : item
            )
        }));
        return { success: true };
    },

    removeItem: (itemId) => {
        set(state => ({
            items: state.items.filter(item => item.id !== itemId)
        }));
    },

    setItemDiscount: (itemId, discount) => {
        set(state => ({
            items: state.items.map(item =>
                item.id === itemId
                    ? { ...item, discount, total: lineTotal(item.quantity, item.unit_price, discount) }
                    : item
            )
        }));
    },

    /** Price agreed with the customer for one line (the usual bargaining). */
    setLinePrice: (itemId, price) => {
        const value = Math.max(0, round2(price));
        set(state => ({
            items: state.items.map(item =>
                item.id === itemId
                    ? { ...item, unit_price: value, total: lineTotal(item.quantity, value, item.discount) }
                    : item
            )
        }));
    },

    setCustomer: (customer) => {
        set({ customer });
    },

    setDiscount: (discount, discountType = 'fixed') => {
        set({ discount, discountType });
    },

    setNotes: (notes) => {
        set({ notes });
    },

    getSubtotal: () => {
        const { items } = get();
        return round2(items.reduce((sum, item) => sum + item.total, 0));
    },

    /** Discount typed by the cashier for the whole ticket (fixed DA or %). */
    getManualDiscount: () => {
        const { discount, discountType } = get();
        const subtotal = get().getSubtotal();
        const value = Number(discount) || 0;
        const amount = discountType === 'percent' ? subtotal * Math.min(100, Math.max(0, value)) / 100 : value;
        return round2(Math.min(Math.max(0, amount), subtotal));
    },

    /** Best active promotion for this ticket: { promotion, amount } or null. */
    getPromotion: () => {
        const { promotions, items, coupon } = get();
        return bestPromotion(promotions, items, { coupon });
    },

    getDiscountAmount: () => {
        const subtotal = get().getSubtotal();
        const promo = get().getPromotion();
        return round2(Math.min(subtotal, get().getManualDiscount() + (promo ? promo.amount : 0)));
    },

    // Tax is computed on what the customer really pays (after discounts)
    getTaxAmount: () => {
        const { items, taxType, taxExempt, globalTaxRate, taxEnabled } = get();
        // TVA turned off in Settings: none is computed
        if (taxExempt || taxEnabled === false) return 0;
        const subtotal = get().getSubtotal();
        if (subtotal <= 0) return 0;
        const factor = (subtotal - get().getDiscountAmount()) / subtotal;
        const tax = items.reduce((sum, item) => {
            const effectiveRate = (item.tax_rate && item.tax_rate > 0) ? item.tax_rate : globalTaxRate;
            const rate = (Number(effectiveRate) || 0) / 100;
            const paid = item.total * factor;
            return sum + (taxType === 'inclusive' ? paid - paid / (1 + rate) : paid * rate);
        }, 0);
        return round2(tax);
    },

    getTotal: () => {
        const { taxType, serviceCharge } = get();
        const net = get().getSubtotal() - get().getDiscountAmount();
        const total = taxType === 'inclusive' ? net : net + get().getTaxAmount();
        return round2(Math.max(0, total + (Number(serviceCharge) || 0)));
    },

    getItemCount: () => {
        const { items } = get();
        return items.reduce((sum, item) => sum + item.quantity, 0);
    },

    clearCart: () => {
        set({
            items: [],
            customer: null,
            discount: 0,
            discountType: 'fixed',
            serviceCharge: 0,
            taxExempt: false,
            notes: '',
            coupon: '',
            lastAddedId: null,
        });
    },

    holdTransaction: async (employeeId) => {
        const { items, customer, notes } = get();
        if (items.length === 0) return null;
        const held = {
            id: uuid(),
            employee_id: employeeId,
            customer_id: customer?.id,
            items,
            subtotal: get().getSubtotal(),
            notes,
        };
        await window.electronAPI.held.create(held);
        get().clearCart();
        return held;
    },

    recallTransaction: (held) => {
        const items = heldLines(held);
        set({
            items,
            customer: held.customer_id ? { id: held.customer_id, name: held.customer_name } : null,
            notes: held.notes || '',
            discount: 0,
            discountType: 'fixed',
            serviceCharge: 0, // Reset these as they might not be in held data yet
            taxExempt: false
        });
    },

    loadQuote: (quote) => {
        set({
            items: quote.items.map(item => ({
                id: uuid(),
                product_id: item.product_id,
                product_name: item.product_name,
                variant_id: item.variant_id || null,
                variant_label: item.variant_label || null,
                quantity: item.quantity,
                unit_price: item.unit_price,
                tax_rate: 0,
                total: item.quantity * item.unit_price
            })),
            customer: quote.customer_id ? { id: quote.customer_id, name: quote.customer_name } : null,
            discount: quote.discount_amount || 0,
            discountType: 'fixed',
            notes: quote.notes || '',
        });
    },

    processPayment: async (payments, employeeId, employeeName = null, approval = null) => {
        const { items, customer, notes, serviceCharge, taxExempt } = get();
        if (items.length === 0) throw new Error(t('cart.empty'));

        const receiptNumber = await window.electronAPI.generateReceiptNumber();
        const subtotal = get().getSubtotal();
        const taxAmount = get().getTaxAmount();
        const discountAmount = get().getDiscountAmount();
        const total = get().getTotal();

        const promo = get().getPromotion();
        const saleItems = items.map(item => ({
            ...item,
            tax_amount: (taxExempt || get().taxEnabled === false) ? 0 : (item.total * (item.tax_rate / 100)), // Approximate for record
        }));

        const sale = {
            id: uuid(),
            receipt_number: receiptNumber,
            employee_id: employeeId,
            employee_name: employeeName,
            created_at: new Date().toISOString(),
            customer_id: customer?.id || null,
            subtotal,
            tax_amount: taxAmount,
            discount_amount: discountAmount,
            service_charge: serviceCharge || 0, // NEW field
            tax_exempt: taxExempt ? 1 : 0,      // NEW field
            total,
            status: 'completed',
            notes: promo ? [notes, promo.promotion.name].filter(Boolean).join(' · ') : notes,
            promotion_id: promo ? promo.promotion.id : null,
            promotion_name: promo ? promo.promotion.name : null,
            // Checked again by the main process: discount typed by hand, coupon typed
            manual_discount: get().getManualDiscount(),
            coupon: get().coupon || null,
            approval: approval || null,
            items: saleItems,
            payments: payments.map(p => ({ ...p, id: uuid() })),
        };

        // The saved sale comes back with the variant/SKU snapshot of each line
        const saved = await window.electronAPI.sales.create(sale);
        if (saved && saved.items) sale.items = saved.items;
        // The manager's PIN is never kept with the sale
        delete sale.approval;

        // Loyalty points and total spent are updated by the main process in
        // the same transaction as the sale.
        get().clearCart();
        return sale;
    },
}));
