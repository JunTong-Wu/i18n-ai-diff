/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './panel/index.html',
    './panel/src/**/*.{js,ts,jsx,tsx,scss,css}',
    './src/panel/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      screens: {
        sm: '768px',
        lg: '1080px',
        xl: '1600px',
      },
      colors: {
        canvas: 'var(--canvas)',
        surface: 'var(--surface)',
        'surface-quiet': 'var(--surface-quiet)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        brand: 'var(--brand)',
        'brand-soft': 'var(--brand-soft)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: 'var(--danger)',
      },
      borderRadius: {
        'panel-sm': 'var(--radius-sm)',
        'panel-md': 'var(--radius-md)',
        'panel-lg': 'var(--radius-lg)',
        'panel-xl': 'var(--radius-xl)',
      },
      boxShadow: {
        shell: 'var(--shadow-shell)',
        hover: 'var(--shadow-hover)',
      },
      animation: {
        'panel-spin': 'spin 0.8s linear infinite',
      },
    },
  },
  // The panel owns its reset in panel/src/styles/_base.scss. Keeping Tailwind
  // preflight disabled protects VTable internals and the approved panel visual system.
  corePlugins: {
    preflight: false,
    textOpacity: false,
    backgroundOpacity: false,
    borderOpacity: false,
    divideOpacity: false,
    placeholderOpacity: false,
    ringOpacity: false,
  },
  plugins: [],
};
