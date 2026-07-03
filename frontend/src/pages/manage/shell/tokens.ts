/**
 * Management Workspace — design system tokens (Mission P0.2).
 *
 * The single source of truth for the shell's measurements. Every future module
 * inherits these; do not hardcode shell dimensions elsewhere. Values are chosen
 * for a calm, dense, professional feel (Linear / Stripe / Shopify class), not
 * flashy — restaurant managers scan fast and act.
 */

export const SHELL = {
  headerHeight: 60,        // px — permanent header
  railWidthExpanded: 232,  // desktop rail
  railWidthCollapsed: 64,  // tablet-landscape rail (icons only)
  pageMaxWidth: 1160,      // canvas content max width (readability cap)
  radiusCard: 12,
  radiusControl: 8,
} as const;

// Spacing scale (px) — use for gaps/padding so rhythm stays consistent.
export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

// Canvas layout standards (every WorkspacePage uses these).
export const CANVAS = {
  paddingX: 28,      // desktop horizontal padding
  paddingY: 24,
  sectionGap: 24,    // between page sections
  cardGap: 16,
  tableRowHeight: 44,
  toolbarHeight: 52,
} as const;

// Overlay surfaces (documented standard for future drawers/modals).
export const OVERLAY = {
  drawerWidth: 440,
  drawerWidthWide: 640,
  modalWidthSm: 400,
  modalWidthMd: 560,
  modalWidthLg: 720,
} as const;

// Breakpoints (px). Desktop is the home of Management; below it the rail adapts.
export const BREAKPOINTS = {
  mobile: 640,          // < 640  → mobile (rail = overlay drawer)
  tabletPortrait: 768,  // 640–767 → overlay
  desktop: 1024,        // 768–1023 → collapsed rail; ≥1024 → expanded rail
} as const;

// Motion — subtle, never distracting. Respect prefers-reduced-motion at usage.
export const MOTION = {
  fast: 120,
  base: 180,
  slow: 240,
  ease: 'cubic-bezier(0.2, 0, 0, 1)',
} as const;
