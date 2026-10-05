// Merges every message module. Each entry is [English, French, Arabic].
import common from './common';
import round2 from './round2';
import misc from './misc';
import ecommerce from './ecommerce';
import excel from './excel';
import barcode from './barcode';
import modals from './modals';
import purchases from './purchases';
import gift from './gift';
import promos from './promos';
import reports from './reports';
import credit from './credit';
import customers from './customers';
import inventory from './inventory';
import dashboard from './dashboard';
import pos from './pos';
import settings from './settings';
import setup from './setup';
import products from './products';
import errors from './errors';
import catalog from './catalog';
import login from './login';
import printing from './printing';
import layout from './layout';

const MODULES = { common, round2, misc, ecommerce, excel, barcode, modals, purchases, gift, promos, reports, credit, customers, inventory, dashboard, pos, settings, setup, products, errors, catalog, login, printing, layout };

function merge(modules) {
    const all = {};
    for (const [moduleName, messages] of Object.entries(modules)) {
        for (const [key, value] of Object.entries(messages)) {
            if (all[key]) throw new Error(`Duplicate translation key "${key}" (in ${moduleName})`);
            all[key] = value;
        }
    }
    return all;
}

export const MESSAGES = merge(MODULES);
export const MESSAGE_MODULES = MODULES;
