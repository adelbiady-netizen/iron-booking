// ─── Guest Hub brand presets ───────────────────────────────────────────────────
// Six curated hospitality atmosphere presets for the public page.
// Operators choose a preset; Iron Booking controls the design system within it.
//
// LOCKED across all presets: typography, spacing, border-radius, layout, motion.
// CONTROLLED per preset: surface warmth, accent tone, border mood, hero atmosphere.
//
// Design principle: surfaces carry the mood — not just the accent color.
// Each theme shifts bg, surface, elevated, and border as a coherent temperature
// system so switching presets feels like walking into a different venue.

export interface HubColorPalette {
  bg:        string;
  surface:   string;
  elevated:  string;
  border:    string;
  borderSub: string;
  text:      string;
  muted:     string;
  sub:       string;
  gold:      string;   // primary accent — the mood-setter
  goldDim:   string;   // dim accent for secondary elements
}

export interface HubTheme {
  id:          string;
  label:       string;   // admin display name
  description: string;   // one-line descriptor for admin UI
  colors:      HubColorPalette;
  heroGradient: string;  // fallback gradient when no cover image
  heroGlowA:    string;  // inner glow rgba (e.g. rgba(…,0.16))
  heroGlowB:    string;  // outer glow rgba (e.g. rgba(…,0.04))
  css: {
    // CSS custom properties applied to the page root wrapper
    '--gh-cat-border':            string;  // category card border (gold-alpha)
    '--gh-cat-border-hover':      string;  // category card hover border
    '--gh-cat-glow':              string;  // top accent-line gradient start
    '--gh-carousel-border-hover': string;  // carousel card hover border
    '--gh-surface-hover':         string;  // button/row hover background
    '--gh-border-hover':          string;  // button/row hover border
    '--gh-row-hover-bg':          string;  // social row hover background
  };
}

// ─── Preset definitions ────────────────────────────────────────────────────────

const PRESETS: Record<string, HubTheme> = {

  // ── ESPRESSO — warm Italian evening ─────────────────────────────────────────
  // Surfaces carry brown wood warmth. Amber candlelight accent.
  // Venue feel: candlelit trattoria, aged oak tables, espresso on the bar.
  ESPRESSO: {
    id: 'ESPRESSO', label: 'Espresso',
    description: 'Warm Italian evening — amber candlelight & oak tables',
    colors: {
      bg:        '#0D0A07',
      surface:   '#181310',
      elevated:  '#231A12',
      border:    '#342618',
      borderSub: '#281E14',
      text:      '#F5EDE2',
      muted:     '#887568',
      sub:       '#504238',
      gold:      '#C9A96E',
      goldDim:   '#8E6A38',
    },
    heroGradient: 'linear-gradient(180deg, #3A1E08 0%, #1E0E04 35%, #0D0A07 100%)',
    heroGlowA: 'rgba(201,169,110,0.16)',
    heroGlowB: 'rgba(201,169,110,0.04)',
    css: {
      '--gh-cat-border':            'rgba(201,169,110,0.14)',
      '--gh-cat-border-hover':      'rgba(201,169,110,0.28)',
      '--gh-cat-glow':              'rgba(201,169,110,0.60)',
      '--gh-carousel-border-hover': 'rgba(201,169,110,0.22)',
      '--gh-surface-hover':         '#241C14',
      '--gh-border-hover':          '#3E2E20',
      '--gh-row-hover-bg':          '#201610',
    },
  },

  // ── WINE — deep burgundy, premium service ────────────────────────────────────
  // Surfaces carry deep plum-wine character. Restrained rose-burgundy accent.
  // Venue feel: wine cellar, dark mahogany, crystal glasses, silver service.
  WINE: {
    id: 'WINE', label: 'Wine',
    description: 'Deep burgundy — premium dinner service & wine cellar elegance',
    colors: {
      bg:        '#0C0609',
      surface:   '#180A14',
      elevated:  '#20101C',
      border:    '#3A1C2C',
      borderSub: '#2A1220',
      text:      '#F5EAF0',
      muted:     '#7A6072',
      sub:       '#4E2E42',
      gold:      '#C06882',
      goldDim:   '#8C3A58',
    },
    heroGradient: 'linear-gradient(180deg, #3A0818 0%, #1E0408 35%, #0C0609 100%)',
    heroGlowA: 'rgba(192,104,130,0.18)',
    heroGlowB: 'rgba(192,104,130,0.04)',
    css: {
      '--gh-cat-border':            'rgba(192,104,130,0.16)',
      '--gh-cat-border-hover':      'rgba(192,104,130,0.30)',
      '--gh-cat-glow':              'rgba(192,104,130,0.58)',
      '--gh-carousel-border-hover': 'rgba(192,104,130,0.24)',
      '--gh-surface-hover':         '#2A1424',
      '--gh-border-hover':          '#4A2438',
      '--gh-row-hover-bg':          '#22101E',
    },
  },

  // ── OLIVE — Mediterranean garden ─────────────────────────────────────────────
  // Surfaces carry earthy olive-green character. Vibrant natural-green accent.
  // Venue feel: garden terrace under olive trees, natural stone, linen napkins.
  OLIVE: {
    id: 'OLIVE', label: 'Olive',
    description: 'Mediterranean garden — natural earth warmth & terrace dining',
    colors: {
      bg:        '#0A0D08',
      surface:   '#141A0C',
      elevated:  '#1E2812',
      border:    '#2E4018',
      borderSub: '#222E16',
      text:      '#EEF4E4',
      muted:     '#728060',
      sub:       '#485838',
      gold:      '#96C070',
      goldDim:   '#5E8040',
    },
    heroGradient: 'linear-gradient(180deg, #1A3008 0%, #0E1A04 35%, #0A0D08 100%)',
    heroGlowA: 'rgba(150,192,112,0.15)',
    heroGlowB: 'rgba(150,192,112,0.04)',
    css: {
      '--gh-cat-border':            'rgba(150,192,112,0.14)',
      '--gh-cat-border-hover':      'rgba(150,192,112,0.28)',
      '--gh-cat-glow':              'rgba(150,192,112,0.55)',
      '--gh-carousel-border-hover': 'rgba(150,192,112,0.20)',
      '--gh-surface-hover':         '#28341A',
      '--gh-border-hover':          '#3E5228',
      '--gh-row-hover-bg':          '#1C2410',
    },
  },

  // ── MIDNIGHT — dark cocktail lounge ──────────────────────────────────────────
  // Surfaces carry deep midnight-navy character. Electric steel-blue accent.
  // Venue feel: rooftop cocktail bar, city lights, blue-hour, premium spirits.
  MIDNIGHT: {
    id: 'MIDNIGHT', label: 'Midnight',
    description: 'Dark cocktail lounge — navy depth & city-light sophistication',
    colors: {
      bg:        '#080A12',
      surface:   '#0E1224',
      elevated:  '#141E38',
      border:    '#1E3054',
      borderSub: '#162040',
      text:      '#E4EEF8',
      muted:     '#5A708A',
      sub:       '#2E4466',
      gold:      '#6098D8',
      goldDim:   '#3A6298',
    },
    heroGradient: 'linear-gradient(180deg, #081838 0%, #040C1E 35%, #080A12 100%)',
    heroGlowA: 'rgba(96,152,216,0.18)',
    heroGlowB: 'rgba(96,152,216,0.04)',
    css: {
      '--gh-cat-border':            'rgba(96,152,216,0.16)',
      '--gh-cat-border-hover':      'rgba(96,152,216,0.30)',
      '--gh-cat-glow':              'rgba(96,152,216,0.58)',
      '--gh-carousel-border-hover': 'rgba(96,152,216,0.24)',
      '--gh-surface-hover':         '#1A2A48',
      '--gh-border-hover':          '#283E60',
      '--gh-row-hover-bg':          '#10162E',
    },
  },

  // ── SAND — golden hour, coastal café ─────────────────────────────────────────
  // Warmest surfaces of all presets — amber gold bleeds through every layer.
  // Brightest accent. Venue feel: Mediterranean terrace, golden-hour brunch.
  SAND: {
    id: 'SAND', label: 'Sand',
    description: 'Golden hour warmth — coastal café & Mediterranean brunch',
    colors: {
      bg:        '#100C07',
      surface:   '#1E1610',
      elevated:  '#2C2010',
      border:    '#40281A',
      borderSub: '#30200E',
      text:      '#F8EEE0',
      muted:     '#9A8870',
      sub:       '#6A5238',
      gold:      '#D4A840',
      goldDim:   '#A07820',
    },
    heroGradient: 'linear-gradient(180deg, #482C06 0%, #241406 35%, #100C07 100%)',
    heroGlowA: 'rgba(212,168,64,0.22)',
    heroGlowB: 'rgba(212,168,64,0.05)',
    css: {
      '--gh-cat-border':            'rgba(212,168,64,0.16)',
      '--gh-cat-border-hover':      'rgba(212,168,64,0.30)',
      '--gh-cat-glow':              'rgba(212,168,64,0.62)',
      '--gh-carousel-border-hover': 'rgba(212,168,64,0.24)',
      '--gh-surface-hover':         '#342618',
      '--gh-border-hover':          '#4E3622',
      '--gh-row-hover-bg':          '#26200E',
    },
  },

  // ── SLATE — modern urban, contemporary ───────────────────────────────────────
  // Cool, desaturated precision. No warmth — brushed steel and concrete character.
  // Venue feel: contemporary Michelin-starred urban restaurant, clean geometry.
  SLATE: {
    id: 'SLATE', label: 'Slate',
    description: 'Modern urban precision — cool neutral & contemporary cuisine',
    colors: {
      bg:        '#0A0C10',
      surface:   '#13161E',
      elevated:  '#1C2030',
      border:    '#282E3A',
      borderSub: '#1E2430',
      text:      '#E8EBF5',
      muted:     '#6A7888',
      sub:       '#404E60',
      gold:      '#8AAFC8',
      goldDim:   '#506880',
    },
    heroGradient: 'linear-gradient(180deg, #0E1C2E 0%, #080E18 35%, #0A0C10 100%)',
    heroGlowA: 'rgba(138,175,200,0.12)',
    heroGlowB: 'rgba(138,175,200,0.03)',
    css: {
      '--gh-cat-border':            'rgba(138,175,200,0.14)',
      '--gh-cat-border-hover':      'rgba(138,175,200,0.26)',
      '--gh-cat-glow':              'rgba(138,175,200,0.50)',
      '--gh-carousel-border-hover': 'rgba(138,175,200,0.20)',
      '--gh-surface-hover':         '#222838',
      '--gh-border-hover':          '#303A48',
      '--gh-row-hover-bg':          '#181E2C',
    },
  },
};

// ─── Public API ────────────────────────────────────────────────────────────────

export const ALL_PRESETS: HubTheme[] = Object.values(PRESETS);

export function getHubTheme(preset: string | null | undefined): HubTheme {
  if (!preset) return PRESETS['ESPRESSO']!;
  return PRESETS[preset.toUpperCase()] ?? PRESETS['ESPRESSO']!;
}
