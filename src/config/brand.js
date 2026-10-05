// Afus Boutique identity for the interface. Single source shared with the
// main process: electron/shared/brand.json (see electron/brand.js).
import BRAND from '../../electron/shared/brand.json';

export const COMPANY_NAME = BRAND.companyName;
export const PRODUCT_NAME = BRAND.productName;
export const SHORT_NAME = BRAND.shortName;
export const APP_ID = BRAND.appId;

export default BRAND;
