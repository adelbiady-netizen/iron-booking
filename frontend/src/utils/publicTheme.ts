import { useEffect } from 'react';

type PresetKey = 'luxury' | 'casual' | 'family' | 'nightlife' | 'minimal' | 'fineDining' | 'mediterranean' | 'italiano';

// Space-separated RGB channels for use with `rgb(var(--pub-rgb) / alpha)` syntax
const PRESET_RGB: Record<PresetKey | 'default', string> = {
  default:       '34 197 94',   // Iron green
  family:        '34 197 94',   // casual green
  luxury:        '201 168 76',  // Modern Luxury — champagne gold
  casual:        '245 158 11',  // Casual Warm — amber
  nightlife:     '168 85 247',  // nightlife purple (unchanged)
  minimal:       '113 113 122', // Japanese Minimal — warm zinc
  fineDining:    '212 175 55',  // Elegant Dark — rich gold
  mediterranean: '203 125 87',  // Mediterranean — terracotta
  italiano:      '146 135 98',  // Italiano — muted warm olive
};

// Per-preset typography + feel tokens
const PRESET_RADIUS: Record<PresetKey | 'default', string> = {
  default:       '12px',
  family:        '20px',
  luxury:        '6px',   // Modern Luxury — slightly softened
  casual:        '16px',  // Casual Warm — friendly rounded
  nightlife:     '6px',
  minimal:       '2px',   // Japanese Minimal — sharp
  fineDining:    '2px',   // Elegant Dark — sharp, refined
  mediterranean: '12px',  // Mediterranean — natural curves
  italiano:      '4px',   // Italiano — architectural, refined
};

const PRESET_TRACKING: Record<PresetKey | 'default', string> = {
  default:       '0.01em',
  family:        '0.01em',
  luxury:        '0.09em',  // Modern Luxury — wide spaced
  casual:        '0.01em',  // Casual Warm — natural
  nightlife:     '0.04em',
  minimal:       '0.08em',  // Japanese Minimal — airy
  fineDining:    '0.12em',  // Elegant Dark — very wide
  mediterranean: '0.03em',  // Mediterranean — natural
  italiano:      '0.10em',  // Italiano — elegant and spacious
};

const PRESET_GLOW: Record<PresetKey | 'default', string> = {
  default:       '0.28',
  family:        '0.28',
  luxury:        '0.22',  // Modern Luxury — subtle
  casual:        '0.32',  // Casual Warm — warm glow
  nightlife:     '0.50',
  minimal:       '0.10',  // Japanese Minimal — barely there
  fineDining:    '0.15',  // Elegant Dark — understated
  mediterranean: '0.30',  // Mediterranean — warm sun
  italiano:      '0.12',  // Italiano — understated, cinematic
};

interface BrandingInput {
  primaryColor?: string | null;
  accentColor?: string | null;
  publicThemePreset?: string | null;
  buttonStyle?: string | null;
  cardStyle?: string | null;
  backgroundMood?: string | null;
}

function hexToRgbChannels(hex: string): string | null {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  return `${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)}`;
}

export function usePublicTheme(branding: BrandingInput | null | undefined) {
  const primary        = branding?.primaryColor;
  const preset         = branding?.publicThemePreset;
  const buttonStyle    = branding?.buttonStyle;
  const cardStyle      = branding?.cardStyle;
  const backgroundMood = branding?.backgroundMood;

  useEffect(() => {
    const key = (preset && preset in PRESET_RGB) ? (preset as PresetKey) : 'default';

    const rgb = primary ? (hexToRgbChannels(primary) ?? PRESET_RGB.default) : PRESET_RGB[key];

    document.documentElement.style.setProperty('--pub-rgb',      rgb);
    document.documentElement.style.setProperty('--pub-radius',   PRESET_RADIUS[key]);
    document.documentElement.style.setProperty('--pub-tracking', PRESET_TRACKING[key]);
    document.documentElement.style.setProperty('--pub-glow',     PRESET_GLOW[key]);

    // data-pub-preset: CSS preset overrides (e.g. [data-pub-preset="italiano"])
    if (key !== 'default') {
      document.documentElement.setAttribute('data-pub-preset', key);
    } else {
      document.documentElement.removeAttribute('data-pub-preset');
    }

    // data-pub-btn: button border-radius style
    if (buttonStyle) {
      document.documentElement.setAttribute('data-pub-btn', buttonStyle);
    } else {
      document.documentElement.removeAttribute('data-pub-btn');
    }

    // data-pub-card: card surface style
    if (cardStyle) {
      document.documentElement.setAttribute('data-pub-card', cardStyle);
    } else {
      document.documentElement.removeAttribute('data-pub-card');
    }

    // data-pub-bg: background atmosphere mood
    if (backgroundMood && backgroundMood !== 'dark') {
      document.documentElement.setAttribute('data-pub-bg', backgroundMood);
    } else {
      document.documentElement.removeAttribute('data-pub-bg');
    }

    return () => {
      document.documentElement.style.removeProperty('--pub-rgb');
      document.documentElement.style.removeProperty('--pub-radius');
      document.documentElement.style.removeProperty('--pub-tracking');
      document.documentElement.style.removeProperty('--pub-glow');
      document.documentElement.removeAttribute('data-pub-preset');
      document.documentElement.removeAttribute('data-pub-btn');
      document.documentElement.removeAttribute('data-pub-card');
      document.documentElement.removeAttribute('data-pub-bg');
    };
  }, [primary, preset, buttonStyle, cardStyle, backgroundMood]);
}
