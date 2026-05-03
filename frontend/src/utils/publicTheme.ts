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
    let rgb: string;

    if (primary) {
      rgb = hexToRgbChannels(primary) ?? PRESET_RGB.default;
    } else if (preset && preset in PRESET_RGB) {
      rgb = PRESET_RGB[preset as PresetKey];
    } else {
      rgb = PRESET_RGB.default;
    }

    document.documentElement.style.setProperty('--pub-rgb', rgb);

    return () => {
      document.documentElement.style.removeProperty('--pub-rgb');
    };
  }, [primary, preset]);
}
