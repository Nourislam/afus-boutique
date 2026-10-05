import { describe, it, expect } from 'vitest';
import { translate } from '../src/i18n';
import { arabicCount, arabicPluralCategory } from '../src/i18n/plural';

describe('Arabic counted days', () => {
    it('picks the right form for each number', () => {
        expect([0, 1, 2, 3, 10, 11, 99, 100, 102, 103, 111].map(arabicPluralCategory))
            .toEqual(['zero', 'one', 'two', 'few', 'few', 'many', 'many', 'other', 'other', 'few', 'many']);
        expect(arabicCount(0)).toBe('0 يوم');
        expect(arabicCount(1)).toBe('يوم واحد');
        expect(arabicCount(2)).toBe('يومين');
        expect(arabicCount(2, 'days', { inSentence: false })).toBe('يومان');
        expect(arabicCount(3)).toBe('3 أيام');
        expect(arabicCount(10)).toBe('10 أيام');
        expect(arabicCount(11)).toBe('11 يومًا');
        expect(arabicCount(30)).toBe('30 يومًا');
        expect(arabicCount(100)).toBe('100 يوم');
    });

    const cases = [[0, '0 يوم'], [1, 'يوم واحد'], [2, 'يومين'], [3, '3 أيام'], [7, '7 أيام'], [10, '10 أيام'], [11, '11 يومًا'], [45, '45 يومًا']];

    it('"منذ …" (since): last sale and last backup', () => {
        for (const [n, words] of cases) {
            expect(translate('ar', 'dash.slow.days', { n })).toBe(`آخر بيع منذ ${words}`);
            expect(translate('ar', 'dash.alert.oldBackup', { n })).toBe(`آخر نسخة احتياطية منذ ${words}`);
        }
    });

    it('"آخر …" (the last): automatic copies kept', () => {
        for (const [n, words] of cases) expect(translate('ar', 'backup.keepN', { n })).toBe(`آخر ${words}`);
        expect([7, 14, 30].map(n => translate('ar', 'backup.keepN', { n }))).toEqual(['آخر 7 أيام', 'آخر 14 يومًا', 'آخر 30 يومًا']);
    });

    it('English and French are unchanged', () => {
        expect(translate('en', 'dash.slow.days', { n: 2 })).toBe('last sale 2 days ago');
        expect(translate('fr', 'dash.alert.oldBackup', { n: 11 })).toBe('Dernière sauvegarde il y a 11 jours');
        expect(translate('en', 'backup.keepN', { n: 7 })).toBe('The last 7 days');
        expect(translate('fr', 'backup.keepN', { n: 30 })).toBe('Les 30 derniers jours');
    });

    it('an Arabic message without a count keeps working, a missing count stays visible', () => {
        expect(translate('ar', 'dash.slow.days')).toBe('آخر بيع منذ {n:days}');
        expect(translate('ar', 'dash.slow.pieces', { n: 4 })).toBe('في المخزون: 4 قطعة');
    });
});
