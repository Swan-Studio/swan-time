/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#FAFAF7',
        ink: '#080822',
        accent: '#FF4E01',
        pink: '#EB0091',
        sun: '#FCED17',
        mute: '#7A7A85',
        line: 'rgba(8,8,34,0.08)',
        chip: 'rgba(8,8,34,0.04)'
      },
      backgroundImage: {
        'swan-gradient': 'linear-gradient(135deg, #EB0091 0%, #FF4E01 50%, #FCED17 100%)',
        'swan-gradient-soft':
          'linear-gradient(135deg, rgba(235,0,145,0.12) 0%, rgba(255,78,1,0.12) 50%, rgba(252,237,23,0.12) 100%)'
      },
      borderRadius: {
        // Swan spec: inputs 8px, buttons 10px. Aligning Tailwind's md/lg here.
        sm: '6px',
        md: '10px',
        lg: '12px',
        xl: '14px',
        '2xl': '18px'
      },
      fontFamily: {
        display: ['"Fraunces"', 'ui-serif', 'Georgia', 'serif'],
        sans: ['"Inter Tight"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace']
      },
      fontSize: {
        timer: ['56px', { lineHeight: '1', letterSpacing: '-0.02em' }]
      },
      keyframes: {
        rise: {
          '0%': { transform: 'translateY(4px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' }
        },
        pulse: {
          '0%,100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.55', transform: 'scale(0.92)' }
        }
      },
      animation: {
        rise: 'rise 200ms ease-out',
        livepulse: 'pulse 1.4s ease-in-out infinite'
      }
    }
  },
  plugins: []
};
