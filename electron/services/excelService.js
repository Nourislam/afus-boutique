/**
 * Excel Import/Export Service
 * 
 * Handles importing data from Excel files for Products, Customers, Employees.
 */

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// Row problems are sent as "CODE|{json}" and shown in the shop's language
const coded = (code, params = {}) => `${code}|${JSON.stringify(params)}`;

// Field mappings for each data type
const FIELD_MAPPINGS = {
    products: {
        required: ['name', 'price'],
        optional: ['sku', 'barcode', 'description', 'category', 'brand', 'cost', 'stock_quantity', 'min_stock_level', 'tax_rate'],
        aliases: {
            // French and Arabic column names used in Algerian shops
            'nom': 'name', 'désignation': 'name', 'designation': 'name', 'article': 'name', 'produit': 'name',
            'الاسم': 'name', 'السلعة': 'name', 'المنتج': 'name',
            'prix': 'price', 'prix de vente': 'price', 'pv': 'price', 'السعر': 'price', 'سعر البيع': 'price',
            "prix d'achat": 'cost', 'pa': 'cost', 'coût': 'cost', 'سعر الشراء': 'cost',
            'quantité': 'stock_quantity', 'quantite': 'stock_quantity', 'qté': 'stock_quantity', 'الكمية': 'stock_quantity', 'المخزون': 'stock_quantity',
            'catégorie': 'category', 'categorie': 'category', 'famille': 'category', 'الصنف': 'category',
            'marque': 'brand', 'الماركة': 'brand', 'العلامة': 'brand',
            'code-barres': 'barcode', 'code barre': 'barcode', 'code barres': 'barcode', 'الباركود': 'barcode',
            'référence': 'sku', 'reference': 'sku', 'réf': 'sku', 'ref': 'sku', 'المرجع': 'sku',
            'stock minimum': 'min_stock_level', 'الحد الأدنى': 'min_stock_level',
            'tva': 'tax_rate',

            'product name': 'name',
            'product_name': 'name',
            'title': 'name',
            'product code': 'sku',
            'item code': 'sku',
            'upc': 'barcode',
            'ean': 'barcode',
            'desc': 'description',
            'cost price': 'cost',
            'purchase price': 'cost',
            'selling price': 'price',
            'sale price': 'price',
            'unit price': 'price',
            'quantity': 'stock_quantity',
            'stock': 'stock_quantity',
            'qty': 'stock_quantity',
            'inventory': 'stock_quantity',
            'reorder level': 'min_stock_level',
            'min stock': 'min_stock_level',
            'min_stock': 'min_stock_level',
            'tax': 'tax_rate',
            'vat': 'tax_rate',
            'tax rate': 'tax_rate',
            'category name': 'category',
            'stock quantity': 'stock_quantity',
            'stock level': 'stock_quantity',
        },
    },
    customers: {
        required: ['name'],
        optional: ['email', 'phone', 'address', 'notes', 'loyalty_points'],
        aliases: {
            'nom': 'name', 'client': 'name', 'الاسم': 'name', 'الزبون': 'name',
            'téléphone': 'phone', 'tél': 'phone', 'tel': 'phone', 'الهاتف': 'phone',
            'adresse': 'address', 'العنوان': 'address',
            'customer name': 'name',
            'full name': 'name',
            'customer': 'name',
            'email address': 'email',
            'e-mail': 'email',
            'phone number': 'phone',
            'telephone': 'phone',
            'mobile': 'phone',
            'contact': 'phone',
            'street address': 'address',
            'location': 'address',
            'points': 'loyalty_points',
            'rewards': 'loyalty_points',
            'comments': 'notes',
            'remarks': 'notes',
        },
    },
    employees: {
        required: ['name', 'pin'],
        optional: ['email', 'role'],
        aliases: {
            'employee name': 'name',
            'full name': 'name',
            'staff name': 'name',
            'email address': 'email',
            'e-mail': 'email',
            'pin code': 'pin',
            'access code': 'pin',
            'password': 'pin',
            'position': 'role',
            'job title': 'role',
            'job role': 'role',
        },
    },
};

class ExcelService {
    /**
     * Read Excel file and return sheet data
     */
    readFile(filePath) {
        try {
            const workbook = XLSX.readFile(filePath);
            const sheets = {};

            workbook.SheetNames.forEach(sheetName => {
                const sheet = workbook.Sheets[sheetName];
                const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
                sheets[sheetName] = {
                    headers: data[0] || [],
                    rows: data.slice(1),
                    rowCount: data.length - 1,
                };
            });

            return {
                success: true,
                sheets,
                sheetNames: workbook.SheetNames,
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
            };
        }
    }

    /**
     * Parse uploaded file buffer
     */
    parseBuffer(buffer) {
        try {
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            const sheets = {};

            workbook.SheetNames.forEach(sheetName => {
                const sheet = workbook.Sheets[sheetName];
                const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
                sheets[sheetName] = {
                    headers: (data[0] || []).map(h => String(h).trim()),
                    rows: data.slice(1),
                    rowCount: data.length - 1,
                };
            });

            return {
                success: true,
                sheets,
                sheetNames: workbook.SheetNames,
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
            };
        }
    }

    /**
     * Auto-detect column mappings based on header names
     */
    detectColumnMappings(headers, dataType) {
        console.log(`[Excel] Detecting mappings for ${dataType} with headers:`, headers);
        const mapping = FIELD_MAPPINGS[dataType];
        if (!mapping) {
            throw new Error(`Unknown data type: ${dataType}`);
        }

        const columnMappings = {};
        const allFields = [...mapping.required, ...mapping.optional];

        headers.forEach((header, index) => {
            if (!header) return;
            const normalizedHeader = String(header).toLowerCase().trim();

            // Check exact match first
            if (allFields.includes(normalizedHeader)) {
                console.log(`[Excel] Direct match: '${header}' -> '${normalizedHeader}'`);
                columnMappings[normalizedHeader] = index;
            }
            // Check aliases
            else if (mapping.aliases[normalizedHeader]) {
                console.log(`[Excel] Alias match: '${header}' -> '${mapping.aliases[normalizedHeader]}'`);
                columnMappings[mapping.aliases[normalizedHeader]] = index;
            }
        });

        console.log('[Excel] Final Mappings:', columnMappings);
        return {
            mappings: columnMappings,
            unmappedHeaders: headers.filter((h, i) =>
                !Object.values(columnMappings).includes(i)
            ),
            missingRequired: mapping.required.filter(f =>
                !(f in columnMappings)
            ),
        };
    }

    /**
     * Validate and transform data based on type
     */
    validateAndTransform(rows, columnMappings, dataType) {
        const mapping = FIELD_MAPPINGS[dataType];
        const results = {
            valid: [],
            errors: [],
            warnings: [],
        };

        rows.forEach((row, rowIndex) => {
            const record = {};
            const rowErrors = [];
            const rowWarnings = [];

            // Extract values based on column mappings
            for (const [field, colIndex] of Object.entries(columnMappings)) {
                let value = row[colIndex];

                // Handle empty values
                if (value === undefined || value === null || value === '') {
                    if (mapping.required.includes(field)) {
                        rowErrors.push(coded('EXCEL_MISSING', { field }));
                    }
                    continue;
                }

                // Type-specific transformations
                value = this.transformValue(field, value, dataType);

                record[field] = value;
            }

            // Validate required fields
            for (const required of mapping.required) {
                if (!record[required] && !rowErrors.some(e => e.includes(`"${required}"`))) {
                    rowErrors.push(coded('EXCEL_MISSING', { field: required }));
                }
            }

            // Data type specific validations
            if (dataType === 'products') {
                if (record.price && isNaN(parseFloat(record.price))) {
                    rowErrors.push(coded('EXCEL_PRICE_NAN'));
                }
                if (record.stock_quantity && isNaN(parseInt(record.stock_quantity))) {
                    rowWarnings.push(coded('EXCEL_STOCK_NAN'));
                    record.stock_quantity = 0;
                }
            }

            if (dataType === 'customers') {
                if (record.email && !this.isValidEmail(record.email)) {
                    rowWarnings.push(coded('EXCEL_EMAIL'));
                }
            }

            if (dataType === 'employees') {
                if (record.pin && (record.pin.length < 4 || record.pin.length > 6)) {
                    rowErrors.push(coded('EXCEL_PIN'));
                }
                if (record.role && !['admin', 'manager', 'cashier'].includes(record.role.toLowerCase())) {
                    rowWarnings.push(coded('EXCEL_ROLE'));
                    record.role = 'cashier';
                }
            }

            if (rowErrors.length > 0) {
                results.errors.push({
                    row: rowIndex + 2, // Excel row (1-indexed + header)
                    errors: rowErrors,
                    data: record,
                });
            } else {
                if (rowWarnings.length > 0) {
                    results.warnings.push({
                        row: rowIndex + 2,
                        warnings: rowWarnings,
                    });
                }
                results.valid.push(record);
            }
        });

        return results;
    }

    /**
     * Transform value based on field type
     */
    transformValue(field, value, dataType) {
        // Convert to string first
        value = String(value).trim();

        // Number fields
        const numberFields = ['price', 'cost', 'stock_quantity', 'min_stock_level', 'tax_rate', 'loyalty_points'];
        if (numberFields.includes(field)) {
            // Remove currency symbols, commas, percentages, etc.
            const cleanValue = value.replace(/[^0-9.-]/g, '');
            const num = parseFloat(cleanValue);
            return isNaN(num) ? 0 : num;
        }

        // PIN should be string
        if (field === 'pin') {
            return value.replace(/\D/g, '');
        }

        // Role should be lowercase
        if (field === 'role') {
            return value.toLowerCase();
        }

        return value;
    }

    /**
     * Simple email validation
     */
    isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    /**
     * Get field mappings info for UI
     */
    getFieldMappings(dataType) {
        return FIELD_MAPPINGS[dataType] || null;
    }

    /**
     * Generate sample Excel template
     */
    generateTemplate(dataType) {
        const mapping = FIELD_MAPPINGS[dataType];
        if (!mapping) {
            throw new Error(`Unknown data type: ${dataType}`);
        }

        const headers = [...mapping.required, ...mapping.optional];
        const sampleData = this.getSampleData(dataType);

        const worksheet = XLSX.utils.aoa_to_sheet([headers, ...sampleData]);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, dataType);

        return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    }

    /**
     * Get sample data for templates
     */
    getSampleData(dataType) {
        switch (dataType) {
            case 'products':
                return [
                    // Same order as the headers: name, price, sku, barcode, description, category, brand, cost, stock, min stock, tax
                    ['T-shirt basique', 1500, 'TSH-001', '', 'T-shirt 100% coton', 'T-shirts', 'Zara', 900, 20, 3, 0],
                ];
            case 'customers':
                return [
                    ['Amina B.', '', '0555 12 34 56', 'Alger', '', 0],
                ];
            case 'employees':
                return [
                    ['Karim', '1234', '', 'cashier'],
                ];
            default:
                return [];
        }
    }

    /**
     * Export data to Excel buffer
     */
    exportData(data, dataType) {
        const mapping = FIELD_MAPPINGS[dataType];
        const headers = [...mapping.required, ...mapping.optional];

        const rows = data.map(item =>
            headers.map(header => item[header] ?? '')
        );

        const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, dataType);

        return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    }
}

module.exports = new ExcelService();
