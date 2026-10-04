/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                // One set of surfaces for the whole app (darkest to lightest)
                dark: {
                    primary: '#0b0b0d',   // app background
                    secondary: '#131316', // sidebar, cards, panels
                    tertiary: '#1c1c21',  // inputs, hover, raised items
                    border: '#26262c',
                },
                accent: {
                    primary: '#6366f1',
                    secondary: '#8b5cf6',
                    success: '#22c55e',
                    warning: '#f59e0b',
                    danger: '#ef4444',
                }
            },
            fontFamily: {
                // Bundled with the app (works offline): Inter for Latin, Cairo for Arabic
                sans: ['"Inter Variable"', '"Cairo Variable"', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
                arabic: ['"Cairo Variable"', '"Inter Variable"', 'system-ui', 'sans-serif'],
            },
            animation: {
                'fade-in': 'fadeIn 0.2s ease-out',
                'slide-up': 'slideUp 0.3s ease-out',
                'scale-in': 'scaleIn 0.2s ease-out',
                'pulse-soft': 'pulseSoft 2s infinite',
            },
            keyframes: {
                fadeIn: {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
                slideUp: {
                    '0%': { opacity: '0', transform: 'translateY(10px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                scaleIn: {
                    '0%': { opacity: '0', transform: 'scale(0.95)' },
                    '100%': { opacity: '1', transform: 'scale(1)' },
                },
                pulseSoft: {
                    '0%, 100%': { opacity: '1' },
                    '50%': { opacity: '0.7' },
                }
            }
        },
    },
    plugins: [
        require('@tailwindcss/typography'),
    ],
}
