/**
 * Counted words in Arabic, where the noun changes with the number:
 * 0 يوم, يوم واحد, يومان / يومين, 3–10 أيام, 11–99 يومًا, 100 يوم, 103 أيام…
 * (the hundreds repeat the rule on the last two digits).
 *
 * In a message, write {n:days} instead of {n} (Arabic text only):
 * "آخر بيع منذ {n:days}" → "آخر بيع منذ 5 أيام". After منذ or آخر the dual
 * is "يومين"; on its own it is "يومان".
 */
const WORDS = {
    days: { one: 'يوم واحد', two: ['يومان', 'يومين'], few: 'أيام', many: 'يومًا', other: 'يوم' },
};

/** CLDR plural category of an Arabic count. */
export function arabicPluralCategory(count) {
    const n = Math.abs(Math.trunc(Number(count) || 0));
    if (n === 0) return 'zero';
    if (n === 1) return 'one';
    if (n === 2) return 'two';
    const last = n % 100;
    if (last >= 3 && last <= 10) return 'few';
    if (last >= 11) return 'many';
    return 'other';
}

/** "5 أيام", "يومين"… inSentence: the count follows منذ / آخر (default). */
export function arabicCount(count, word = 'days', { inSentence = true } = {}) {
    const forms = WORDS[word];
    const n = Math.trunc(Number(count) || 0);
    switch (arabicPluralCategory(n)) {
        case 'one': return forms.one;
        case 'two': return forms.two[inSentence ? 1 : 0];
        case 'few': return `${n} ${forms.few}`;
        case 'many': return `${n} ${forms.many}`;
        default: return `${n} ${forms.other}`;
    }
}

/** Replace the {name:word} counted placeholders of an Arabic message. */
export function arabicCounted(text, params) {
    return text.replace(/\{(\w+):(\w+)\}/g, (m, name, word) => (
        WORDS[word] && params[name] !== undefined && params[name] !== null ? arabicCount(params[name], word) : m
    ));
}
