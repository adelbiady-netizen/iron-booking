import { useEffect } from 'react';

type PresetKey = 'luxury' | 'casual' | 'family' | 'nightlife' | 'minimal' | 'fineDining';

// Space-separated RGB channels for use with `rgb(var(--pub-rgb) / alpha)` syntax
const PRESET_RGB: Record<PresetKey | 'default', string> = {
  default:    '34 197 94',   // Iron green
  family:     '34 197 94',   // same as default
  luxury:     '201 168 76',  // gold
  casual:     '245 158 11',  // amber
  nightlife:  '168 85 247',  // purple
  minimal:    '148 163 184', // slate grey
  fineDining: '220 38 38',   // crimson
};

// Per-preset typography + feel tokens
const PRESET_RADIUS: Record<PresetKey | 'default', string> = {
  default:    '12px',
  family:     '20px',
  luxury:     '4px',
  casual:     '14px',
  nightlife:  '6px',
  minimal:    '2px',
  fineDining: '0px',
};

const PRESET_TRACKING: Record<PresetKey | 'default', string> = {
  default:    '0.01em',
  family:     '0.01em',
  luxury:     '0.09em',
  casual:     '0.02em',
  nightlife:  '0.04em',
  minimal:    '0.07em',
  fineDining: '0.12em',
};

const PRESET_GLOW: Record<PresetKey | 'default', string> = {
  default:    '0.28',
  family:     '0.28',
  luxury:     '0.22',
  casual:     '0.30',
  nightlife:  '0.50',
  minimal:    '0.12',
  fineDining: '0.18',
};

interface BrandingInput {
  primaryColor?: string | null;
  accentColor?: string | null;
  publicThemePreset?: string | null;
}

function hexToRgbChannels(hex: string): string | null {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  return `${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)}`;
}

export function usePublicTheme(branding: BrandingInput | null | undefined) {
  const primary = branding?.primaryColor;
  const preset  = branding?.publicThemePreset;

  useEffect(() => {
    const key = (preset && preset in PRESET_RGB) ? (preset as PresetKey) : 'default';

    const rgb = primary ? (hexToRgbChannels(primary) ?? PRESET_RGB.default) : PRESET_RGB[key];

    document.documentElement.style.setProperty('--pub-rgb',      rgb);
    document.documentElement.style.setProperty('--pub-radius',   PRESET_RADIUS[key]);
    document.documentElement.style.setProperty('--pub-tracking', PRESET_TRACKING[key]);
    document.documentElement.style.setProperty('--pub-glow',     PRESET_GLOW[key]);

    return () => {
      document.documentElement.style.removeProperty('--pub-rgb');
      document.documentElement.style.removeProperty('--pub-radius');
      document.documentElement.style.removeProperty('--pub-tracking');
      document.documentElement.style.removeProperty('--pub-glow');
    };
  }, [primary, preset]);
}
