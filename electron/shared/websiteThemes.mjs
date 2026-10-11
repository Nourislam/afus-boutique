// The looks a shop can give its website. Shared by the main process (what is
// published) and the window (the choice in Website). A theme is only colours
// and a style name here; the pages themselves come with the publishing step.
export const WEBSITE_THEMES = [
    { id: 'classic', colors: { primary: '#1f2937', accent: '#b45309', background: '#ffffff', text: '#111827' } },
    { id: 'modern', colors: { primary: '#4f46e5', accent: '#06b6d4', background: '#f8fafc', text: '#0f172a' } },
    { id: 'elegant', colors: { primary: '#7c2d12', accent: '#d4a373', background: '#fdf8f3', text: '#3f2a1e' } },
];

export const DEFAULT_THEME = 'modern';

export const isTheme = (id) => WEBSITE_THEMES.some(t => t.id === id);
