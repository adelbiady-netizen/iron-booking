// Scoring weights — must sum to 100 for the base dimensions
export const SCORING_WEIGHTS = {
  FIT: 40,          // capacity match — the most important dimension
  ZONE: 20,         // honor guest's zone preference
  VIP: 15,          // VIP guests get premium placement
  UTILIZATION: 10,  // fill efficiently (cluster bookings, save flex tables)
  PREFERRED: 10,    // customer's favourite table
  COMBO_BASE: -10,  // penalty for needing to combine tables
} as const;

export const COMBO = {
  MAX_TABLES: 3,          // never combine more than 3 tables
  NEAR_THRESHOLD: 10,     // floor-plan units — "adjacent"
  FAR_THRESHOLD: 30,      // floor-plan units — "too far to combine"
  SAME_GROUP_RECOVERY: 5, // pts recovered from COMBO_BASE when tables share combineGroup
  MAX_ADJACENCY_BONUS: 3, // max pts recovered from COMBO_BASE via adjacency
} as const;

export const LOCK = {
  ACQUIRE_TIMEOUT_MS: 5_000, // abort booking if advisory lock not acquired in 5s
} as const;

export const WAITLIST = {
  NOTIFY_EXPIRY_MIN: 20,     // offer expires 20 min after notification sent
  LOOKBACK_DAYS: 60,         // history window for cancellation rate calculation
  MIN_SAMPLES: 10,           // minimum data points for HIGH confidence estimate
} as const;

export const BOOKING = {
  SAME_MINUTE_GUARD_MIN: 1,  // reject bookings starting < 1 min from now
  MAX_COMBO_TABLES: 3,
} as const;

export const DASHBOARD = {
  UPCOMING_LOOKAHEAD_MIN: 30, // "arriving soon" window in host dashboard
  RESERVED_SOON_MIN: 15,      // table shows RESERVED_SOON if res starts within this many min
  FLOOR_REFRESH_S: 30,        // seconds between floor status refreshes on client
} as const;

// Active reservation statuses — used in conflict detection queries
export const ACTIVE_STATUSES = ['PENDING', 'CONFIRMED', 'SEATED'] as const;
