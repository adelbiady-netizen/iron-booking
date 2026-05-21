export type ReservationStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'SEATED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

export type LiveStatus =
  | 'AVAILABLE'
  | 'OCCUPIED'
  | 'RESERVED'
  | 'RESERVED_SOON'
  | 'BLOCKED'
  | 'STALE_OCCUPIED';

export interface Section {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
}

export interface Table {
  id: string;
  name: string;
  section: Section | null;
  minCovers: number;
  maxCovers: number;
  shape: string;
  isActive: boolean;
  posX: number;
  posY: number;
  width: number;
  height: number;
  locked: boolean;
  lockReason: string | null;
  lockedUntil: string | null;
}

export interface Guest {
  id: string;
  firstName: string;
  lastName: string;
  isVip: boolean;
  tags: string[];
  visitCount?: number;
  noShowCount?: number;
}

export interface Reservation {
  id: string;
  guestName: string;
  guestPhone: string | null;
  partySize: number;
  status: ReservationStatus;
  date: string;
  time: string;
  duration: number;
  source: string;
  tableId: string | null;
  combinedTableIds: string[];
  table?: { id: string; name: string; section: { name: string } | null } | null;
  guestId: string | null;
  guest?: Guest | null;
  occasion: string | null;
  guestNotes: string | null;
  hostNotes: string | null;
  tags: string[];
  isConfirmedByGuest: boolean;
  isRunningLate: boolean;
  lateNotifiedAt: string | null;
  isArrived: boolean;
  arrivedAt: string | null;
  confirmationToken: string | null;
  confirmationSentAt: string | null;
  confirmedAt: string | null;
  remindedAt: string | null;
  reminderCount: number;
  seatedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  noShowAt: string | null;
  returnedToListAt: string | null;
  reorganizeAt: string | null;
  reorganizeFromTableId: string | null;
  reorganizeBySeatingId: string | null;
  createdByName: string | null;
  updatedByName: string | null;
  seatedByName: string | null;
  cancelledByName: string | null;
  movedByName: string | null;
  reorganizedByName: string | null;
  minutesRemaining?: number;
  minutesUntil?: number;
}

export interface FloorTable extends Table {
  liveStatus: LiveStatus;
  blockReason?: string;
  blockType?: string;
  currentReservation: (Reservation & {
    minutesRemaining: number;
    expectedEndTime: string;   // seatedAt + duration, ISO — set by backend, always present
    isOverdue: boolean;        // true when minutesRemaining < 0; host must manually complete
  }) | null;
  upcomingReservations: Array<Reservation & { minutesUntil: number }>;
  // Gap analysis — set by backend, used by frontend scoring to prevent "Best fit" on tight tables
  nextReservationStart: string | null;  // ISO of the next future reservation's start time
  effectiveGapMinutes: number | null;   // minutes from board time to next reservation (null = no next res)
  requiredGapMinutes: number;           // defaultTurnMinutes + bufferBetweenTurnsMinutes
  canFitIncomingTurn: boolean;          // effectiveGapMinutes === null || effectiveGapMinutes >= requiredGapMinutes
}

export type UserRole =
  | 'SUPER_ADMIN'       // system-wide admin
  | 'HQ_ADMIN'          // group-level admin (all branches in their group)
  | 'GROUP_MANAGER'     // group-level manager (limited cross-branch)
  | 'RESTAURANT_ADMIN'  // single-restaurant portal admin (scoped to own restaurant)
  | 'OWNER'             // restaurant owner (restaurant-scoped, same tier as ADMIN)
  | 'ADMIN'             // restaurant-level admin (backward compat)
  | 'MANAGER'
  | 'HOST'
  | 'SERVER';

export interface OperatingHourRecord {
  dayOfWeek:   number;   // 0 = Sunday … 6 = Saturday
  isOpen:      boolean;
  openTime:    string;   // "HH:mm" — service start / first booking slot
  closeTime:   string;   // "HH:mm" — physical close
  lastSeating: string;   // "HH:mm" — last reservation slot
}

export interface HostUser {
  id: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  avatarUrl: string | null;
  isActive: boolean;
  email: string | null;
  hasPin: boolean;
  createdAt: string;
}

export interface AuthUser {
  id: string;
  email: string | null;
  firstName: string;
  lastName: string;
  role: UserRole;
  groupId?: string; // present for HQ_ADMIN / GROUP_MANAGER users
  restaurant: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    settings?: {
      openingHour?: string;
      closingHour?: string;
      defaultTurnMinutes?: number;
      [key: string]: unknown;
    };
    operatingHours?: OperatingHourRecord[];
  } | null;
}

// ─── Admin portal types ───────────────────────────────────────────────────────

export interface AdminRestaurant {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  isSystem: boolean;
  groupId: string | null;
  settings: Record<string, unknown>;
  createdAt: string;
  _count: { users: number; tables: number; reservations: number };
}

export interface AdminGroup {
  id: string;
  name: string;
  slug: string;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  _count: { restaurants: number; users: number };
}

export interface AdminGroupDetail extends AdminGroup {
  restaurants: AdminRestaurant[];
  users: Array<{
    id: string; email: string | null; firstName: string; lastName: string;
    role: string; isActive: boolean; createdAt: string;
  }>;
}

export interface AdminRestaurantDetail extends AdminRestaurant {
  operatingHours: Array<{
    id: string; dayOfWeek: number; openTime: string; closeTime: string;
    lastSeating: string; isOpen: boolean;
  }>;
  ultramsgInstanceId: string | null;
  whatsappPhone:      string | null;
  tokenSet:           boolean;
  cuisine:            string | null;
  primaryColor:       string | null;
  accentColor:        string | null;
  publicThemePreset:  string | null;
  logoUrl:            string | null;
  coverImageUrl:      string | null;
  heroVideoUrl:       string | null;
  buttonStyle:           string | null;
  cardStyle:             string | null;
  backgroundMood:        string | null;
  backgroundColorHex:    string | null;
  backgroundGradientHex: string | null;
  websiteUrl:    string | null;
  instagramUrl:  string | null;
  googleMapsUrl: string | null;
  wazeUrl:       string | null;
  portalPermissions: {
    canManageOperatingHours:     boolean;
    canManageOnlineRestrictions: boolean;
  } | null;
}

export interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Exclude<UserRole, 'SUPER_ADMIN'>;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuthState {
  token: string;
  user: AuthUser;
}

export interface LocationTonightStats {
  restaurantId: string;
  booked: number;
  seated: number;
  late: number;
  upcoming: number;
}

export interface FloorInsight {
  type: 'SEAT_NOW' | 'LATE_GUEST' | 'ENDING_SOON' | 'ARRIVING_SOON' | 'DUE_NOW' | 'LATE' | 'NO_SHOW_RISK';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  tableId: string;
  reservationId?: string;
  message: string;
  reservation?: { guestName: string; partySize: number; time: string; status: string };
  reason?: string;
}

export interface FloorSuggestion {
  tableId: string;
  suggestedReservationId: string;
  score: number;
  reason: string;
  reservation: {
    guestName: string;
    partySize: number;
    time: string;
    status: ReservationStatus;
  };
}

export type TablePickerStatus = 'recommended' | 'possible' | 'tight' | 'blocked';

export type ScoredReason =
  | { code: 'CONFLICT'; at?: string; occupied?: boolean }
  | { code: 'TOO_SMALL' }
  | { code: 'TABLE_BLOCKED' }
  | { code: 'PERFECT_FIT' }
  | { code: 'GOOD_FIT' }
  | { code: 'LARGE_TABLE'; excess: number; partySize: number }
  | { code: 'GAP_BEFORE_TIGHT'; prevTime: string; gapMins: number }
  | { code: 'GAP_AFTER_TIGHT'; nextTime: string; gapMins: number }
  | { code: 'GAP_BEFORE_WARN'; prevTime: string }
  | { code: 'GAP_AFTER_WARN'; nextTime: string };

export interface BackendTableSuggestion {
  type: 'single' | 'combination';
  tableId?: string;
  combinationId?: string;
  tableName: string;
  sectionName: string;
  minCovers: number;
  maxCovers: number;
  score: number;
  status: TablePickerStatus;
  reasons: ScoredReason[];
  prevRes?: { guestName: string; time: string; partySize: number };
  nextRes?: { guestName: string; time: string; partySize: number };
}

export type WaitlistStatus = 'WAITING' | 'NOTIFIED' | 'SEATED' | 'LEFT' | 'REMOVED';

export interface WaitlistEntry {
  id: string;
  restaurantId: string;
  date: string;
  guestName: string;
  guestPhone: string | null;
  partySize: number;
  status: WaitlistStatus;
  source: string;
  quotedWaitMinutes: number | null;
  estimatedWaitMin: number | null;
  addedAt: string;
  notifiedAt: string | null;
  seatedAt: string | null;
  leftAt: string | null;
  notes: string | null;
  reservationId: string | null;
  preferredTime: string | null;
  flexibleTime: boolean;
}

export type FloorObjKind =
  | 'WALL' | 'DIVIDER' | 'BAR' | 'ENTRANCE' | 'ZONE'
  | 'PLANTER' | 'HOST_STAND' | 'SERVICE_LANE' | 'LOUNGE_BOUNDARY' | 'VIP_ENCLOSURE'
  | 'CURVED_LOUNGE_BOUNDARY' | 'CURVED_BOOTH_SEGMENT';

/**
 * All named visual or geometric variants a map object kind supports.
 * ARC_*, CURVED, U_SHAPE, L_SHAPE, and MODULAR are reserved for curved/modular furniture.
 */
export type VariantId =
  // Universal
  | 'DEFAULT'
  // DIVIDER
  | 'PANEL' | 'GLASS' | 'LOW' | 'GREENERY'
  // BAR
  | 'STRAIGHT' | 'ISLAND' | 'COUNTER'
  // PLANTER
  | 'POT' | 'ROW' | 'PRIVACY'
  // Curved / modular furniture
  | 'ARC_LEFT' | 'ARC_RIGHT' | 'U_SHAPE' | 'L_SHAPE' | 'CURVED' | 'MODULAR';

export interface FloorObjectData {
  id: string;
  kind: FloorObjKind;
  label: string;
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotation: number;
  color: string | null;
  /** Explicit semantic variant. Optional — null when unset (as returned from DB), undefined for new unsaved objects. */
  variant?: VariantId | null;
}

export interface GuestListItem {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  isVip: boolean;
  isBlacklisted: boolean;
  visitCount: number;
  noShowCount: number;
  cancelCount: number;
  lastVisitAt: string | null;
  createdAt: string;
}

export interface GuestDetail extends GuestListItem {
  allergies: string[];
  tags: string[];
  preferences: Record<string, unknown>;
  internalNotes: string | null;
  reservations: Array<{
    id: string;
    date: string;
    time: string;
    partySize: number;
    status: ReservationStatus;
    occasion: string | null;
    guestNotes: string | null;
    table: { name: string } | null;
  }>;
}

export interface GuestSearchResult {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  isVip: boolean;
  visitCount: number;
}

export interface GuestLookupResult {
  id: string;
  firstName: string;
  lastName: string;
  isVip: boolean;
  allergies: string[];
  tags: string[];
  internalNotes: string | null;
  visitCount: number;
  noShowCount: number;
  lastVisitAt: string | null;
  recentReservations?: Array<{
    id: string;
    date: string;
    time: string;
    partySize: number;
    status: ReservationStatus;
    occasion: string | null;
    table: { name: string } | null;
  }>;
}

export interface PublicReservation {
  guestName: string;
  restaurantName: string;
  restaurantAddress: string | null;
  restaurantPhone: string | null;
  restaurantLogoUrl: string | null;
  restaurantCoverImageUrl: string | null;
  restaurantGoogleMapsUrl: string | null;
  restaurantWazeUrl: string | null;
  restaurantWebsiteUrl: string | null;
  restaurantInstagramUrl: string | null;
  restaurantParkingNotes: string | null;
  restaurantCancellationPolicy: string | null;
  restaurantSpecialInstructions: string | null;
  restaurantPrimaryColor: string | null;
  restaurantAccentColor: string | null;
  restaurantPublicThemePreset: string | null;
  restaurantButtonStyle: string | null;
  restaurantCardStyle: string | null;
  restaurantBackgroundMood: string | null;
  restaurantBackgroundColorHex: string | null;
  restaurantBackgroundGradientHex: string | null;
  date: string;
  time: string;
  partySize: number;
  status: ReservationStatus;
  isConfirmedByGuest: boolean;
  isRunningLate: boolean;
  occasion: string | null;
}

// ─── Online booking (public guest flow) ─────────────────────────────────────

export interface PublicRestaurantProfile {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  description: string | null;
  cuisine: string | null;
  address: string | null;
  phone: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  googleMapsUrl: string | null;
  wazeUrl: string | null;
  parkingNotes: string | null;
  specialInstructions: string | null;
  cancellationPolicy: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  publicThemePreset: string | null;
  heroVideoUrl: string | null;
  buttonStyle: string | null;
  cardStyle: string | null;
  backgroundMood: string | null;
  backgroundColorHex: string | null;
  backgroundGradientHex: string | null;
  maxPartySize: number;
  slotIntervalMinutes: number;
  maxAdvanceBookingDays: number;
  operatingHours: Array<{
    dayOfWeek: number;
    isOpen: boolean;
    openTime: string;
    closeTime: string;
    lastSeating: string;
  }>;
}

export interface PublicSlot {
  time: string;
  available: boolean;
  tier: 'IDEAL' | 'GOOD' | 'LIMITED';
  tablesLeft: number;
  softState?: 'HIGH_DEMAND' | 'SHORT_WINDOW' | null;
  onlineBlocked?: boolean;      // true when an OnlineBookingRestriction covers this slot
  guestMessage?: string | null; // host-authored message, surfaced when slot is online-blocked
}

export interface BookingAlternative {
  date: string;
  time: string;
  tablesLeft: number;
}

export interface AvailabilityResponse {
  date: string;
  partySize: number;
  timezone: string;
  slots: PublicSlot[];
  isFullyBooked: boolean;
  isClosed: boolean;
  isPast: boolean;
  isTooFar?: boolean;
  alternatives: BookingAlternative[];
}

export interface BookingResult {
  reservationId: string;
  confirmationToken: string;
  status: string;
  date: string;
  time: string;
  partySize: number;
  restaurantName: string;
  restaurantLogoUrl: string | null;
}

export interface PublicWaitlistResult {
  publicToken: string;
  restaurantName: string;
  restaurantLogoUrl: string | null;
  date: string;
  partySize: number;
  preferredTime: string;
}

export interface CreateReservationBody {
  guestName: string;
  guestPhone?: string;
  partySize: number;
  date: string;
  time: string;
  duration?: number;
  occasion?: string;
  guestNotes?: string;
  hostNotes?: string;
  tableId?: string;
  combinedTableIds?: string[];
  source: 'PHONE' | 'INTERNAL' | 'WALK_IN';
  lang?: 'en' | 'he';
  tags?: string[];
  depositRequired?: boolean;
}

export interface ActivityLogEntry {
  id: string;
  action: string;
  actor: string;
  timestamp: string;
  reservationId: string;
  guestName: string;
  tableId: string | null;
  tableName: string | null;
  fromTableName: string | null;
  toTableName: string | null;
  displacedFromName: string | null;
  assignedTableName: string | null;
  details: Record<string, unknown>;
}

export type BestTableResult = {
  type: 'single' | 'combined';
  tableIds: string[];
  tableNames: string[];
  score: number;
  reason: string;
};

export interface CallLogItem {
  id: string;
  phone: string;
  status: string;
  duration: number | null;
  recordUrl: string | null;
  group: string | null;
  restaurantName: string | null;
  routingStatus: string | null;
  createdAt: string;
  guestName?: string | null;
}
