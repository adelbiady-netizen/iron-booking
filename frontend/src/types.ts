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
  | 'BLOCKED';

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
  table?: { id: string; name: string; section: { name: string } | null } | null;
  guestId: string | null;
  guest?: Guest | null;
  occasion: string | null;
  guestNotes: string | null;
  hostNotes: string | null;
  tags: string[];
  isConfirmedByGuest: boolean;
  confirmationToken: string | null;
  confirmationSentAt: string | null;
  confirmedAt: string | null;
  remindedAt: string | null;
  reminderCount: number;
  seatedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  noShowAt: string | null;
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
  }) | null;
  upcomingReservations: Array<Reservation & { minutesUntil: number }>;
}

export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'HOST' | 'SERVER';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  restaurant: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
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
  settings: Record<string, unknown>;
  createdAt: string;
  _count: { users: number; tables: number; reservations: number };
}

export interface AdminRestaurantDetail extends AdminRestaurant {
  operatingHours: Array<{
    id: string; dayOfWeek: number; openTime: string; closeTime: string;
    lastSeating: string; isOpen: boolean;
  }>;
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
}

export type FloorObjKind = 'WALL' | 'DIVIDER' | 'BAR' | 'ENTRANCE' | 'ZONE';

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
  source: 'PHONE' | 'INTERNAL' | 'WALK_IN';
  tags?: string[];
  depositRequired?: boolean;
}
