const SOURCE_LABELS_EN: Record<string, string> = {
  PHONE:     'Phone',
  INTERNAL:  'Internal',
  WALK_IN:   'Walk-in',
  ONLINE:    'Online',
  OPENTABLE: 'OpenTable',
  RESY:      'Resy',
};

const SOURCE_LABELS_HE: Record<string, string> = {
  PHONE:     'טלפוני',
  INTERNAL:  'פנימי',
  WALK_IN:   'הגעה ללא הזמנה',
  ONLINE:    'אונליין',
  OPENTABLE: 'OpenTable',
  RESY:      'Resy',
};

const SECTION_LABELS_HE: Record<string, string> = {
  'Main Dining': 'חלל מרכזי',
  'Bar':         'בר',
  'Patio':       'פטיו',
};

export function formatReservationSource(source: string, locale: 'en' | 'he'): string {
  const labels = locale === 'he' ? SOURCE_LABELS_HE : SOURCE_LABELS_EN;
  return labels[source] ?? source;
}

export function formatSectionName(name: string, locale: 'en' | 'he'): string {
  if (locale === 'he') return SECTION_LABELS_HE[name] ?? name;
  return name;
}

const FLOOR_OBJ_LABELS_HE: Record<string, string> = {
  'Wall':                   'קיר',
  'Divider':                'מחיצה',
  'Bar':                    'בר',
  'Entrance':               'כניסה',
  'Zone':                   'אזור',
  'Planter':                'עציץ',
  'Host Stand':             'דוכן מארח',
  'Service Lane':           'מסלול שירות',
  'Lounge Boundary':        'גבול לאונג׳',
  'Curved Lounge':          'לאונג׳ מעוגל',
  'VIP Enclosure':          'מתחם VIP',
  'Curved Booth':           'בות׳ מעוגל',
  'Dining Table':           'שולחן אוכל',
  'Round Table':            'שולחן עגול',
  'Booth':                  'בות׳',
  'Bar Seat':               'מושב בר',
  'Lounge Table':           'שולחן לאונג׳',
  'VIP Table':              'שולחן VIP',
};

export function formatFloorObjLabel(label: string, locale: 'en' | 'he'): string {
  if (locale === 'he') return FLOOR_OBJ_LABELS_HE[label] ?? label;
  return label;
}

// ─── Guest source / import metadata filtering ─────────────────────────────────
// Import scripts write raw job names (e.g. "tabit_import_deli_italiano_2026_v2")
// into guest.tags and "Merged from Tabit CRM export..." into guest.internalNotes.
// Restaurant-facing screens must never show these — use the helpers below instead.

const IMPORT_TAG_PREFIXES = ['tabit_import', 'crm_import', 'import_'];
const IMPORT_NOTE_MARKERS = ['Merged from Tabit', 'tabit_import', 'Source: tabit', 'Source: crm_import'];

export function isImportTag(tag: string): boolean {
  const lower = tag.toLowerCase();
  return IMPORT_TAG_PREFIXES.some(prefix => lower.startsWith(prefix));
}

export function isImportNote(note: string): boolean {
  return IMPORT_NOTE_MARKERS.some(marker => note.includes(marker));
}

/** Returns guest-facing (operational) tags — strips import/migration identifiers. */
export function operationalTags(tags: string[]): string[] {
  return tags.filter(t => !isImportTag(t));
}

/**
 * Returns a friendly Hebrew origin label for the call panel / guest card.
 * Inspects tags + internalNotes to detect CRM imports.
 * Returns null when origin is unknown / not worth surfacing.
 */
export function guestOriginLabel(tags: string[], internalNotes: string | null): string | null {
  const hasImportTag  = tags.some(isImportTag);
  const hasImportNote = internalNotes ? isImportNote(internalNotes) : false;
  if (hasImportTag || hasImportNote) return 'נוצר מייבוא CRM';
  return null;
}

/**
 * True when a guest was imported from CRM and has no Iron Booking visit history.
 * Once the guest makes a real reservation (visitCount > 0), returns false —
 * so their real visit count is shown normally.
 */
export function isCrmImportWithNoHistory(
  visitCount: number,
  tags: string[],
  internalNotes: string | null,
): boolean {
  if (visitCount > 0) return false;
  return tags.some(isImportTag) || (internalNotes ? isImportNote(internalNotes) : false);
}

/** Label shown instead of "0 visits" for CRM-imported guests with no history. */
export const CRM_NO_HISTORY_LABEL = 'היסטוריית ביקורים לא זמינה';
