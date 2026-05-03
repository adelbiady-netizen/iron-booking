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
  'Wall':     'קיר',
  'Divider':  'מחיצה',
  'Bar':      'בר',
  'Entrance': 'כניסה',
  'Zone':     'אזור',
};

export function formatFloorObjLabel(label: string, locale: 'en' | 'he'): string {
  if (locale === 'he') return FLOOR_OBJ_LABELS_HE[label] ?? label;
  return label;
}
