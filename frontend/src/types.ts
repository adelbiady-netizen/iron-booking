// ─── IRON CLUB ───────────────────────────────────────────────────────────────

export type IronClubTier = 'NONE' | 'STARTER' | 'MEMBER' | 'INTELLIGENCE' | 'LUXURY';

export type ClubJoinSource =
  | 'HOST_STAFF'
  | 'RESERVATION_LINK'
  | 'FEEDBACK_FLOW'
  | 'QR_CODE'
  | 'WEBSITE'
  | 'IMPORT'
  | 'MANUAL';

export type ClubMemberStatus = 'ACTIVE' | 'PAUSED' | 'OPTED_OUT';

export interface ClubMember {
  id: string;
  restaurantId: string;
  guestId: string;
  joinDate: string;
  source: ClubJoinSource;
  birthday: string | null;   // "MM-DD"
  anniversary: string | null;
  marketingConsent: boolean;
  smsConsent: boolean;
  emailConsent: boolean;
  status: ClubMemberStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  guest?: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    email: string | null;
    visitCount: number;
    vipScore: number | null;
    isVip: boolean;
    lastVisitAt: string | null;
    firstVisitAt?: string | null;
    silentScore?: number | null;
    allergies?: string[];
    tags?: string[];
    internalNotes?: string | null;
  };
}

// ─── Consent Audit ───────────────────────────────────────────────────────────

export type ConsentAuditAction = 'GRANTED' | 'REVOKED' | 'UPDATED';
export type ConsentAuditSource =
  | 'BOOKING_FLOW'
  | 'CLUB_JOIN_FORM'
  | 'FEEDBACK_FORM'
  | 'HOST_MANUAL'
  | 'IMPORT'
  | 'API'
  | 'UNSUBSCRIBE_LINK';

export interface ConsentAuditRow {
  id:                 string;
  consentType:        string;
  action:             ConsentAuditAction;
  source:             ConsentAuditSource;
  smsConsent:         boolean | null;
  marketingConsent:   boolean | null;
  emailConsent:       boolean | null;
  consentTextVersion: string | null;
  ipAddress:          string | null;   // already masked by backend
  userAgent:          string | null;   // already summarised by backend
  actorId:            string | null;
  notes:              string | null;
  clubMemberId:       string | null;
  createdAt:          string;
}

// ─── IRON CLUB ───────────────────────────────────────────────────────────────

export interface UpcomingClubEvent {
  memberId:            string;
  name:                string;
  phoneMasked:         string;
  mmdd:                string;
  daysUntil:           number;
  smsConsent:          boolean;
  automationEnabled:   boolean;
  alreadySentThisYear: boolean;
  willReceiveSms:      boolean;
}

export interface UpcomingClubEvents {
  birthdays:    UpcomingClubEvent[];
  anniversaries: UpcomingClubEvent[];
}

export interface ClubStats {
  total: number;
  active: number;
  optedOut: number;
  paused: number;
  smsConsent: number;
}

export type RewardType   = 'BIRTHDAY' | 'ANNIVERSARY' | 'RECOVERY' | 'MANUAL';
export type RewardStatus = 'ISSUED' | 'REDEEMED' | 'EXPIRED' | 'CANCELLED';

export interface GuestReward {
  id:               string;
  restaurantId:     string;
  guestId:          string;
  clubMemberId:     string | null;
  type:             RewardType;
  title:            string;
  description:      string | null;
  issuedAt:         string;
  expiresAt:        string | null;
  status:           RewardStatus;
  redeemedAt:       string | null;
  redeemedByUserId: string | null;
  guest?:           { id: string; firstName: string; lastName: string; phone: string | null };
  redeemedByUser?:  { id: string; firstName: string; lastName: string } | null;
}

export interface RewardStats {
  active:            number;
  redeemedThisMonth: number;
  expired:           number;
  totalIssued:       number;
  totalRedeemed:     number;
  redemptionRate:    number;
}

export interface PendingApproval {
  id: string;
  restaurantId: string;
  guestId: string;
  type: string;
  status: string;
  draftMessage: string;
  createdAt: string;
  guest?: { id: string; firstName: string; lastName: string; phone: string | null };
}

export interface ClubJoinInvite {
  id: string;
  restaurantId: string;
  token: string;
  guestName: string | null;
  guestPhone: string | null;
  guestId: string | null;
  reservationId: string | null;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
  joinUrl?: string;
  status?: 'USED' | 'EXPIRED' | 'PENDING';
}

export type RecoveryPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
export type RecoveryStatus = 'OPEN' | 'CONTACTED' | 'RESOLVED';

export interface RecoveryAction {
  id: string;
  recoveryCaseId: string;
  actorName: string;
  note: string;
  createdAt: string;
}

export interface RecoveryCase {
  id: string;
  restaurantId: string;
  guestId: string;
  reservationId: string | null;
  description: string;
  status: RecoveryStatus;
  priority: RecoveryPriority;
  assignedTo: string | null;
  dueDate: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  guest?: {
    id: string; firstName: string; lastName: string;
    phone: string | null; visitCount: number;
    vipScore: number | null; isVip: boolean;
  };
  reservation?: { date: string; time: string; guestName: string } | null;
  actions?: RecoveryAction[];
  _count?: { openCases: number };
}

export interface RecoveryCaseList {
  data: RecoveryCase[];
  meta: { total: number; page: number; limit: number; openCount: number; contactedCount: number };
}

export interface RecoveryStats {
  open: number;
  contacted: number;
  resolved: number;
  criticalOpen: number;
  assignees: Array<{ name: string; openCount: number }>;
}

export type AlertType =
  | 'SILENT_GUEST' | 'BIRTHDAY_SOON' | 'ANNIVERSARY_SOON'
  | 'HIGH_NOSHOW' | 'RECOVERY_OPEN' | 'FEEDBACK_NEGATIVE' | 'VIP_AT_RISK';

export interface AlertCenter {
  critical: GuestAlertRecord[];
  attention: GuestAlertRecord[];
  upcoming: GuestAlertRecord[];
  totalCount: number;
  unreadCount: number;
}

export interface MessagingSummary {
  totalSent: number;
  totalDelivered: number;
  totalFailed: number;
  deliveryRate: number;
  estimatedCost: number;
  byCategory: Record<string, { sent: number; delivered: number; failed: number }>;
  byChannel: Record<string, { sent: number; delivered: number; failed: number }>;
}

export interface MessagingByRestaurant {
  restaurantId: string;
  restaurantName: string;
  sent: number;
  delivered: number;
  failed: number;
  deliveryRate: number;
}

export interface MessagingDailyRow {
  date: string;
  sent: number;
  delivered: number;
  failed: number;
}

export interface MomentQueueItem {
  id: string;
  restaurantId: string;
  guestId: string;
  type: string;
  status: string;
  draftMessage: string;
  finalMessage: string | null;
  scheduledFor: string | null;
  sentAt: string | null;
  createdAt: string;
  guest?: { id: string; firstName: string; lastName: string; phone: string | null };
}

// ─── Reservation status ───────────────────────────────────────────────────────

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
  internalNotes?: string | null;
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
  marketingOptIn: boolean;
  birthday: string | null;
  anniversary: string | null;
  marketingConsentAt: string | null;
  marketingConsentSource: string | null;
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
    expectedEndTime: string;   // max(scheduledEnd, seatedAt + minWindow), ISO — set by backend. scheduledEnd = reservation.time + duration; minWindow defaults to 15 min
    isOverdue: boolean;        // true when minutesRemaining < 0; host must manually complete
    minutesOverdue: number;    // 0 when not overdue; positive minutes past operational end
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
      guestsPageEnabled?: boolean;
      ironClubEnabled?: boolean;
      ironClubTier?: IronClubTier;
      feedbackApprovalRequired?: boolean;
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
  guestHubSlug: string | null;
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

export interface SmsUsageRow {
  restaurantId: string;
  name: string;
  slug: string;
  smsEnabled: boolean;
  smsProvider: string;
  smsSenderName: string | null;
  sent: number;
  failed: number;
  pending: number;
  mock: number;
}

export interface SmsUsageReport {
  month: string;
  rangeStart: string;
  rangeEnd: string;
  totals: { sent: number; failed: number; pending: number; mock: number };
  restaurants: SmsUsageRow[];
}

export interface SmsUsageMessage {
  id: string;
  phone: string;
  messageType: string;
  provider: string;
  senderName: string | null;
  status: string;
  providerMessageId: string | null;
  errorMessage: string | null;
  costAgorot: number | null;
  createdAt: string;
}

export interface SmsUsageDetail {
  restaurantId: string;
  name: string;
  slug: string;
  smsEnabled: boolean;
  smsProvider: string;
  smsSenderName: string | null;
  month: string;
  rangeStart: string;
  rangeEnd: string;
  totals: { sent: number; failed: number; pending: number; mock: number };
  byType: Array<{ messageType: string; sent: number; failed: number }>;
  latest: SmsUsageMessage[];
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

export type WaitlistType   = 'LIVE' | 'FUTURE';
export type WaitlistStatus =
  // LIVE lifecycle
  | 'WAITING' | 'NOTIFIED' | 'SEATED' | 'LEFT'
  // FUTURE lifecycle (mechanics not yet implemented)
  | 'OFFERED' | 'BOOKED' | 'EXPIRED' | 'DECLINED'
  // Both
  | 'REMOVED' | 'ARCHIVED';

// Discriminated union for the table-first seating context menu.
// Lets FloorBoard pass a typed guest to HostDashboard without importing component types.
export type TableFirstGuest =
  | { kind: 'reservation'; data: Reservation }
  | { kind: 'waitlist';    data: WaitlistEntry };

export interface WaitlistEntry {
  id: string;
  restaurantId: string;
  date: string;
  guestName: string;
  guestPhone: string | null;
  partySize: number;
  type: WaitlistType;
  status: WaitlistStatus;
  source: string;
  quotedWaitMinutes: number | null;
  estimatedWaitMin: number | null;
  addedAt: string;
  notifiedAt: string | null;
  seatedAt: string | null;
  leftAt: string | null;
  notes: string | null;
  section: string | null;
  reservationId: string | null;
  preferredTime: string | null;
  flexibleTime: boolean;
  // FUTURE-type fields (null on LIVE entries)
  requestedTime:   string | null;
  offerExpiresAt:  string | null;
  offerToken:      string | null;
  offerAcceptedAt: string | null;
  offerDeclinedAt: string | null;
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
  tags: string[];
  internalNotes: string | null;
}

export interface GuestDetail extends GuestListItem {
  allergies: string[];
  tags: string[];
  preferences: Record<string, unknown>;
  internalNotes: string | null;
  clubMembership?: ClubMember | null;
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
  // Extended intelligence fields
  clubMembership: { status: ClubMemberStatus; joinDate: string } | null;
  openRecoveryCaseCount: number;
  upcomingBirthdayDays: number | null;   // null = no birthday or >30 days away
  preferences: { seatingPref: string | null; dietaryNotes: string | null };
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
  maxOnlinePartySize: number;
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
  duration?: number;
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
  overrideConflicts?: boolean;
  reorganizeIds?: string[];
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

// ─── Guest Intelligence Center ────────────────────────────────────────────────

export type MemoryCategory = 'CELEBRATION' | 'RECOVERY' | 'EMOTIONAL_MOMENT' | 'MILESTONE' | 'PREFERENCE' | 'GROUP_EVENT';
// AlertType and RecoveryStatus defined near top of file — kept here as reference
// AlertType: see line ~129; RecoveryStatus: see line ~83
export type MomentType = 'LONG_RETURN' | 'BIRTHDAY_ECHO' | 'ANNIVERSARY_ECHO' | 'RECOVERY_SEALED';
export type MomentStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SENT';

export interface GuestMemoryRecord {
  id: string;
  restaurantId: string;
  guestId: string;
  reservationId?: string | null;
  category: MemoryCategory;
  source: 'AUTO_DETECTED' | 'HOST_ADDED';
  headline: string;
  context?: string | null;
  emotionalWeight: number;
  occurredAt: string;
  isRecurring: boolean;
  surfacedCount: number;
  isSuppressed: boolean;
  createdAt: string;
}

export interface GuestAlertRecord {
  id: string;
  restaurantId?: string;
  guestId: string;
  type: AlertType;
  headline: string;
  context?: string | null;
  isRead: boolean;
  isDismissed: boolean;
  expiresAt?: string | null;
  createdAt: string;
  guest?: {
    id: string; firstName: string; lastName: string;
    phone: string | null; visitCount: number;
    vipScore: number | null; isVip: boolean;
  };
  openRecoveryCases?: number;
}

export interface RecoveryActionRecord {
  id: string;
  actorName: string;
  note: string;
  createdAt: string;
}

export interface RecoveryCaseRecord {
  id: string;
  restaurantId: string;
  guestId: string;
  reservationId?: string | null;
  description: string;
  status: RecoveryStatus;
  resolvedAt?: string | null;
  createdAt: string;
  actions: RecoveryActionRecord[];
}

export interface MomentRecord {
  id: string;
  restaurantId: string;
  guestId: string;
  type: MomentType;
  status: MomentStatus;
  draftMessage: string;
  finalMessage?: string | null;
  scheduledFor?: string | null;
  sentAt?: string | null;
  createdAt: string;
  guest: { id: string; firstName: string; lastName: string; phone: string | null };
}

export interface MorningBriefRecord {
  id: string;
  briefDate: string;
  content: {
    vipArrivals: Array<{ name: string; time: string; partySize: number }>;
    birthdays: Array<{ name: string; time: string }>;
    anniversaries: Array<{ name: string; time: string }>;
    silentReturns: Array<{ name: string; silentScore: number | null }>;
    openRecovery: number;
    totalCovers: number;
  };
}

export type GicLabel =
  | 'VIP' | 'LOYAL' | 'VIP_CANDIDATE' | 'HIGH_ENGAGEMENT'
  | 'RECOVERED' | 'AT_RISK' | 'SILENT' | 'NEEDS_ATTENTION'
  | 'CRM_MEMBER' | 'NEW';

export interface GuestIntelligence {
  guest: {
    id: string;
    firstVisitAt?: string | null;
    avgVisitIntervalDays?: number | null;
    nextExpectedVisitDate?: string | null;
    silentScore?: number | null;
    vipScore?: number | null;
    // V2 scoring
    loyaltyScore?: number | null;
    engagementScore?: number | null;
    gicLabel?: GicLabel | null;
    gicComputedAt?: string | null;
  } | null;
  memories: GuestMemoryRecord[];
  alerts: GuestAlertRecord[];
  recoveryCases: RecoveryCaseRecord[];
}

