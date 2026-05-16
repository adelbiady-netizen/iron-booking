// ─── Guest Hub brand presets ───────────────────────────────────────────────────
// Six curated visual moods for the public page.
// Operators choose a preset; Iron Booking controls the design system within it.
//
// LOCKED across all presets: typography, spacing, border-radius, layout, motion.
// CONTROLLED per preset: accent tone, background warmth, border mood, glow.

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
  heroGlowA:    string;  // inner glow rgba (e.g. rgba(…,0.13))
  heroGlowB:    string;  // outer glow rgba (e.g. rgba(…,0.03))
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

  ESPRESSO: {
    id: 'ESPRESSO', label: 'Espresso',
    description: 'Warm dark & amber gold — the Iron Booking signature',
    colors: {
      bg: '#0C0A09', surface: '#141210', elevated: '#1C1916',
      border: '#28231E', borderSub: '#201C18',
      text: '#F0EBE3', muted: '#7A6F65', sub: '#4A4139',
      gold: '#C9A96E', goldDim: '#8C6F3E',
    },
    heroGradient: 'linear-gradient(180deg, #3A1A06 0%, #1E0E04 35%, #0C0A09 100%)',
    heroGlowA: 'rgba(201,169,110,0.13)',
    heroGlowB: 'rgba(201,169,110,0.03)',
    css: {
      '--gh-cat-border':            'rgba(201,169,110,0.12)',
      '--gh-cat-border-hover':      'rgba(201,169,110,0.24)',
      '--gh-cat-glow':              'rgba(201,169,110,0.55)',
      '--gh-carousel-border-hover': 'rgba(201,169,110,0.18)',
      '--gh-surface-hover':         '#1E1914',
      '--gh-border-hover':          '#302820',
      '--gh-row-hover-bg':          '#1C1916',
    },
  },

  OLIVE: {
    id: 'OLIVE', label: 'Olive',
    description: 'Earthy olive-green — farm-to-table, garden bistro',
    colors: {
      bg: '#090C09', surface: '#111410', elevated: '#181C15',
      border: '#222819', borderSub: '#1A2015',
      text: '#EDF0E8', muted: '#6E7A60', sub: '#3E4A32',
      gold: '#8FB86E', goldDim: '#5C7A44',
    },
    heroGradient: 'linear-gradient(180deg, #182A08 0%, #0C1804 35%, #090C09 100%)',
    heroGlowA: 'rgba(143,184,110,0.13)',
    heroGlowB: 'rgba(143,184,110,0.03)',
    css: {
      '--gh-cat-border':            'rgba(143,184,110,0.12)',
      '--gh-cat-border-hover':      'rgba(143,184,110,0.24)',
      '--gh-cat-glow':              'rgba(143,184,110,0.50)',
      '--gh-carousel-border-hover': 'rgba(143,184,110,0.18)',
      '--gh-surface-hover':         '#1B1E14',
      '--gh-border-hover':          '#283020',
      '--gh-row-hover-bg':          '#181C14',
    },
  },

  WINE: {
    id: 'WINE', label: 'Wine',
    description: 'Deep burgundy — intimate wine bar, private dining',
    colors: {
      bg: '#0C0809', surface: '#140E10', elevated: '#1C1416',
      border: '#2A1E22', borderSub: '#221618',
      text: '#F0E8EC', muted: '#7A6068', sub: '#4A333A',
      gold: '#C47080', goldDim: '#904050',
    },
    heroGradient: 'linear-gradient(180deg, #3A0A14 0%, #1E0408 35%, #0C0809 100%)',
    heroGlowA: 'rgba(196,112,128,0.13)',
    heroGlowB: 'rgba(196,112,128,0.03)',
    css: {
      '--gh-cat-border':            'rgba(196,112,128,0.14)',
      '--gh-cat-border-hover':      'rgba(196,112,128,0.26)',
      '--gh-cat-glow':              'rgba(196,112,128,0.50)',
      '--gh-carousel-border-hover': 'rgba(196,112,128,0.20)',
      '--gh-surface-hover':         '#1E1416',
      '--gh-border-hover':          '#30222A',
      '--gh-row-hover-bg':          '#1A1216',
    },
  },

  MIDNIGHT: {
    id: 'MIDNIGHT', label: 'Midnight',
    description: 'Deep cool blue — omakase, premium cocktail lounge',
    colors: {
      bg: '#080A0E', surface: '#101318', elevated: '#181C24',
      border: '#202630', borderSub: '#181E28',
      text: '#E8ECF5', muted: '#637080', sub: '#3A4454',
      gold: '#7CA4D4', goldDim: '#4A6EA0',
    },
    heroGradient: 'linear-gradient(180deg, #0A1828 0%, #060E18 35%, #080A0E 100%)',
    heroGlowA: 'rgba(124,164,212,0.13)',
    heroGlowB: 'rgba(124,164,212,0.03)',
    css: {
      '--gh-cat-border':            'rgba(124,164,212,0.14)',
      '--gh-cat-border-hover':      'rgba(124,164,212,0.26)',
      '--gh-cat-glow':              'rgba(124,164,212,0.50)',
      '--gh-carousel-border-hover': 'rgba(124,164,212,0.20)',
      '--gh-surface-hover':         '#161C28',
      '--gh-border-hover':          '#242E40',
      '--gh-row-hover-bg':          '#141A24',
    },
  },

  SAND: {
    id: 'SAND', label: 'Sand',
    description: 'Warm amber honey — Mediterranean, beach club',
    colors: {
      bg: '#100E0A', surface: '#181410', elevated: '#221C16',
      border: '#2E2618', borderSub: '#241E14',
      text: '#F2EDE4', muted: '#8A7E6C', sub: '#58503E',
      gold: '#D4A855', goldDim: '#A07828',
    },
    heroGradient: 'linear-gradient(180deg, #402808 0%, #221404 35%, #100E0A 100%)',
    heroGlowA: 'rgba(212,168,85,0.13)',
    heroGlowB: 'rgba(212,168,85,0.03)',
    css: {
      '--gh-cat-border':            'rgba(212,168,85,0.14)',
      '--gh-cat-border-hover':      'rgba(212,168,85,0.26)',
      '--gh-cat-glow':              'rgba(212,168,85,0.55)',
      '--gh-carousel-border-hover': 'rgba(212,168,85,0.20)',
      '--gh-surface-hover':         '#201A12',
      '--gh-border-hover':          '#322616',
      '--gh-row-hover-bg':          '#1E1812',
    },
  },

  SLATE: {
    id: 'SLATE', label: 'Slate',
    description: 'Cool pewter grey — contemporary urban, fusion cuisine',
    colors: {
      bg: '#0A0C0E', surface: '#131618', elevated: '#1C2022',
      border: '#252A2E', borderSub: '#1E2428',
      text: '#E8EAF0', muted: '#6A7280', sub: '#404850',
      gold: '#9AB0C8', goldDim: '#607888',
    },
    heroGradient: 'linear-gradient(180deg, #0C1828 0%, #080E14 35%, #0A0C0E 100%)',
    heroGlowA: 'rgba(154,176,200,0.13)',
    heroGlowB: 'rgba(154,176,200,0.03)',
    css: {
      '--gh-cat-border':            'rgba(154,176,200,0.14)',
      '--gh-cat-border-hover':      'rgba(154,176,200,0.26)',
      '--gh-cat-glow':              'rgba(154,176,200,0.50)',
      '--gh-carousel-border-hover': 'rgba(154,176,200,0.20)',
      '--gh-surface-hover':         '#1A1E24',
      '--gh-border-hover':          '#262C34',
      '--gh-row-hover-bg':          '#171B20',
    },
  },
};

// ─── Public API ────────────────────────────────────────────────────────────────

export const ALL_PRESETS: HubTheme[] = Object.values(PRESETS);

export function getHubTheme(preset: string | null | undefined): HubTheme {
  if (!preset) return PRESETS['ESPRESSO']!;
  return PRESETS[preset.toUpperCase()] ?? PRESETS['ESPRESSO']!;
}
