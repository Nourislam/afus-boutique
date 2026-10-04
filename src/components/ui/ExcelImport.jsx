import { t } from '../../i18n';
/**
 * Excel Import Component
 * 
 * Reusable component for importing data from Excel files with column mapping,
 * validation, and preview.
 */

import { useState, useCallback, useRef } from 'react';
import {
    Upload, FileSpreadsheet, Download, Check, X, AlertTriangle,
    ChevronRight, RefreshCw, Trash2, ArrowRight
} from 'lucide-react';
import { Button } from './Button';
import { Select } from './Select';
import { Modal, ModalBody, ModalFooter } from './Modal';
import { toast } from './Toast';
import { translateError } from '../../i18n/errors';

export function ExcelImport({
    isOpen,
    onClose,
    dataType,
    onImport,
    title = 'Import from Excel'
}) {
    const [step, setStep] = useState(1); // 1: Upload, 2: Map, 3: Preview
    const [file, setFile] = useState(null);
    const [sheetData, setSheetData] = useState(null);
    const [selectedSheet, setSelectedSheet] = useState('');
    const [columnMappings, setColumnMappings] = useState({});
    const [fieldMappings, setFieldMappings] = useState(null);
    const [validationResult, setValidationResult] = useState(null);
    const [importing, setImporting] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const fileInputRef = useRef(null);

    const handleDrag = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setDragActive(true);
        } else if (e.type === 'dragleave') {
            setDragActive(false);
        }
    }, []);

    const handleDrop = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);

        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFile(e.dataTransfer.files[0]);
        }
    }, []);

    const handleFile = async (selectedFile) => {
        if (!selectedFile.name.match(/\.(xlsx|xls)$/i)) {
            toast.error(t('excel.selectFile'));
            return;
        }

        setFile(selectedFile);

        try {
            const buffer = await selectedFile.arrayBuffer();
            const result = await window.electronAPI.excel.parseBuffer(new Uint8Array(buffer));

            if (!result.success) {
                toast.error(result.error);
                return;
            }

            setSheetData(result.sheets);
            setSelectedSheet(result.sheetNames[0]);

            // Get field mappings for this data type
            const mappings = await window.electronAPI.excel.getFieldMappings(dataType);
            setFieldMappings(mappings);

            setStep(2);
        } catch (error) {
            toast.error(t('excel.readFailed'));
            console.error(error);
        }
    };

    const detectMappings = async () => {
        if (!selectedSheet || !sheetData[selectedSheet]) return;

        const headers = sheetData[selectedSheet].headers;
        const result = await window.electronAPI.excel.detectMappings(headers, dataType);

        // Convert mappings to strings for Select component
        const stringMappings = {};
        Object.entries(result.mappings).forEach(([key, val]) => {
            stringMappings[key] = String(val);
        });

        setColumnMappings(stringMappings);

        if (result.missingRequired.length > 0) {
            toast.warning(t('excel.missingColumns', { fields: result.missingRequired.map(f => t(`excel.field.${f}`)).join(', ') }));
        }
    };

    const handleSheetChange = (sheetName) => {
        setSelectedSheet(sheetName);
        setColumnMappings({});
    };

    const updateColumnMapping = (field, columnIndex) => {
        setColumnMappings(prev => ({
            ...prev,
            [field]: columnIndex === '' ? undefined : columnIndex,
        }));
    };

    const validateAndPreview = async () => {
        // Check required fields
        const missingRequired = fieldMappings.required.filter(f => !(f in columnMappings));
        if (missingRequired.length > 0) {
            toast.error(t('excel.missingColumns', { fields: missingRequired.map(f => t(`excel.field.${f}`)).join(', ') }));
            return;
        }

        const rows = sheetData[selectedSheet].rows;
        const result = await window.electronAPI.excel.validateAndTransform(
            rows,
            columnMappings,
            dataType
        );

        setValidationResult(result);
        setStep(3);
    };

    const handleImport = async () => {
        if (!validationResult?.valid.length) {
            toast.error(t('excel.noValid'));
            return;
        }

        setImporting(true);
        try {
            await onImport(validationResult.valid);
            toast.success(t('excel.imported', { n: validationResult.valid.length }));
            handleClose();
        } catch (error) {
            toast.error(t('excel.importFailed', { error: translateError(error) }));
        } finally {
            setImporting(false);
        }
    };

    const handleClose = () => {
        setStep(1);
        setFile(null);
        setSheetData(null);
        setSelectedSheet('');
        setColumnMappings({});
        setValidationResult(null);
        onClose();
    };

    const downloadTemplate = async () => {
        try {
            const bufferArray = await window.electronAPI.excel.generateTemplate(dataType);
            const buffer = new Uint8Array(bufferArray);
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${dataType}_template.xlsx`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success(t('excel.templateDone'));
        } catch (error) {
            toast.error(t('excel.templateFailed'));
        }
    };

    const currentHeaders = selectedSheet && sheetData?.[selectedSheet]?.headers || [];
    const allFields = fieldMappings ? [...fieldMappings.required, ...fieldMappings.optional] : [];

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title={title} size="lg">
            <ModalBody>
                {/* Step Indicator */}
                <div className="flex items-center justify-center mb-6">
                    {[1, 2, 3].map((s) => (
                        <div key={s} className="flex items-center">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${s <= step ? 'bg-indigo-500 text-white' : 'bg-zinc-700 text-zinc-400'
                                }`}>
                                {s < step ? <Check className="w-4 h-4" /> : s}
                            </div>
                            {s < 3 && (
                                <div className={`w-12 h-1 ${s < step ? 'bg-indigo-500' : 'bg-zinc-700'}`} />
                            )}
                        </div>
                    ))}
                </div>
                <div className="flex justify-center mb-6 text-sm text-zinc-400 gap-8">
                    <span className={step === 1 ? 'text-indigo-400' : ''}>{t('excel.upload')}</span>
                    <span className={step === 2 ? 'text-indigo-400' : ''}>{t('excel.map')}</span>
                    <span className={step === 3 ? 'text-indigo-400' : ''}>{t('products.preview')}</span>
                </div>

                {/* Step 1: Upload */}
                {step === 1 && (
                    <div
                        onDragEnter={handleDrag}
                        onDragLeave={handleDrag}
                        onDragOver={handleDrag}
                        onDrop={handleDrop}
                        className={`border-2 border-dashed rounded-xl p-12 text-center transition-all ${dragActive
                            ? 'border-indigo-500 bg-indigo-500/10'
                            : 'border-zinc-700 hover:border-zinc-600'
                            }`}
                    >
                        <FileSpreadsheet className="w-16 h-16 mx-auto text-zinc-500 mb-4" />
                        <h3 className="text-lg font-medium mb-2">
                            {t('excel.drop')}
                        </h3>
                        <p className="text-zinc-500 mb-4">{t('excel.orBrowse')}</p>
                        <input
                            type="file"
                            accept=".xlsx,.xls"
                            onChange={(e) => handleFile(e.target.files[0])}
                            className="hidden"
                            id="excel-upload"
                            ref={fileInputRef}
                        />
                        <Button
                            variant="secondary"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <Upload className="w-4 h-4" />
                            {t('excel.browse')}
                        </Button>
                        <div className="mt-6 pt-6 border-t border-zinc-700">
                            <button
                                onClick={downloadTemplate}
                                className="text-indigo-400 hover:text-indigo-300 text-sm flex items-center gap-2 mx-auto"
                            >
                                <Download className="w-4 h-4" />
                                Download {dataType} template
                            </button>
                        </div>
                    </div>
                )}

                {/* Step 2: Column Mapping */}
                {step === 2 && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <label className="text-sm font-medium">{t('excel.sheet')}</label>
                                <Select
                                    value={selectedSheet}
                                    onChange={(val) => handleSheetChange(val)}
                                    options={Object.keys(sheetData || {}).map(name => ({
                                        value: name,
                                        label: name
                                    }))}
                                    placeholder={t('excel.sheetPlaceholder')}
                                    className="mt-1"
                                />
                            </div>
                            <Button variant="secondary" size="sm" onClick={detectMappings}>
                                <RefreshCw className="w-4 h-4" />
                                {t('excel.autoDetect')}
                            </Button>
                        </div>

                        <div className="bg-zinc-800 rounded-lg p-4 max-h-80 overflow-y-auto">
                            <h4 className="font-medium mb-3 sticky top-0 bg-zinc-800 pb-2">{t('excel.mappings')}</h4>
                            <div className="space-y-3">
                                {allFields.map(field => (
                                    <div key={field} className="flex items-center gap-4">
                                        <div className="w-40">
                                            <span className={fieldMappings.required.includes(field) ? 'text-red-400' : ''}>
                                                {t(`excel.field.${field}`)}
                                                {fieldMappings.required.includes(field) && ' *'}
                                            </span>
                                        </div>
                                        <ArrowRight className="w-4 h-4 text-zinc-600" />
                                        <Select
                                            value={columnMappings[field] ?? ''}
                                            onChange={(val) => updateColumnMapping(field, val)}
                                            options={[
                                                { value: '', label: t('excel.selectColumn') },
                                                ...currentHeaders.map((header, index) => ({
                                                    value: index.toString(),
                                                    label: header || t('excel.column', { n: index + 1 })
                                                }))
                                            ]}
                                            placeholder={t('excel.selectColumnPlaceholder')}
                                            className="flex-1"
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>

                        <p className="text-xs text-zinc-500">
                            {t('excel.found', { n: sheetData[selectedSheet]?.rowCount || 0, sheet: selectedSheet })}
                        </p>
                    </div>
                )}

                {/* Step 3: Preview & Validate */}
                {step === 3 && validationResult && (
                    <div className="space-y-4">
                        {/* Summary */}
                        <div className="grid grid-cols-3 gap-4">
                            <div className="bg-green-500/20 border border-green-500/50 rounded-lg p-4 text-center">
                                <Check className="w-6 h-6 mx-auto text-green-400" />
                                <p className="text-2xl font-bold text-green-400">{validationResult.valid.length}</p>
                                <p className="text-sm text-green-400/80">{t('excel.valid')}</p>
                            </div>
                            <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 text-center">
                                <X className="w-6 h-6 mx-auto text-red-400" />
                                <p className="text-2xl font-bold text-red-400">{validationResult.errors.length}</p>
                                <p className="text-sm text-red-400/80">{t('excel.errors')}</p>
                            </div>
                            <div className="bg-yellow-500/20 border border-yellow-500/50 rounded-lg p-4 text-center">
                                <AlertTriangle className="w-6 h-6 mx-auto text-yellow-400" />
                                <p className="text-2xl font-bold text-yellow-400">{validationResult.warnings.length}</p>
                                <p className="text-sm text-yellow-400/80">{t('excel.warnings')}</p>
                            </div>
                        </div>

                        {/* Errors */}
                        {validationResult.errors.length > 0 && (
                            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                                <h4 className="font-medium text-red-400 mb-2">{t('excel.errorsTitle')}</h4>
                                <div className="max-h-32 overflow-auto text-sm space-y-1">
                                    {validationResult.errors.slice(0, 10).map((err, i) => (
                                        <p key={i} className="text-red-300">
                                            {t('errors.row', { n: err.row })} : {err.errors.map(e => translateError(e)).join(', ')}
                                        </p>
                                    ))}
                                    {validationResult.errors.length > 10 && (
                                        <p className="text-red-400">{t('excel.moreErrors', { n: validationResult.errors.length - 10 })}</p>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Preview Table */}
                        <div className="bg-zinc-800 rounded-lg overflow-hidden">
                            <div className="p-3 border-b border-zinc-700">
                                <h4 className="font-medium">{t('excel.previewTitle')}</h4>
                            </div>
                            <div className="overflow-auto max-h-48">
                                <table className="w-full text-sm">
                                    <thead className="bg-zinc-700">
                                        <tr>
                                            {allFields.map(f => (
                                                <th key={f} className="px-3 py-2 text-start whitespace-nowrap">{t(`excel.field.${f}`)}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {validationResult.valid.slice(0, 5).map((record, i) => (
                                            <tr key={i} className="border-t border-zinc-700">
                                                {allFields.map(f => (
                                                    <td key={f} className="px-3 py-2 truncate max-w-32">
                                                        {record[f]?.toString() || '-'}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}
            </ModalBody>

            <ModalFooter>
                {step > 1 && (
                    <Button variant="secondary" onClick={() => setStep(step - 1)}>
                        {t('common.back')}
                    </Button>
                )}
                <div className="flex-1" />
                <Button variant="secondary" onClick={handleClose}>
                    {t('common.cancel')}
                </Button>
                {step === 2 && (
                    <Button onClick={validateAndPreview}>
                        <ChevronRight className="w-4 h-4" />
                        {t('products.preview')}
                    </Button>
                )}
                {step === 3 && (
                    <Button
                        onClick={handleImport}
                        disabled={importing || !validationResult?.valid.length}
                    >
                        {importing ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                            <Upload className="w-4 h-4" />
                        )}
                        Import {validationResult?.valid.length} Records
                    </Button>
                )}
            </ModalFooter>
        </Modal>
    );
}

export default ExcelImport;
