import type { ActivityLogEntry, AdminGroup, AdminGroupDetail, AdminRestaurant, AdminRestaurantDetail, AdminUser, AuthUser, AvailabilityResponse, BackendTableSuggestion, BestTableResult, BookingAlternative, BookingResult, CreateReservationBody, FloorInsight, FloorObjectData, FloorSuggestion, FloorTable, GuestDetail, GuestIntelligence, GuestListItem, GuestLookupResult, GuestMemoryRecord, GuestSearchResult, HostUser, LocationTonightStats, MorningBriefRecord, MomentRecord, PublicReservation, PublicRestaurantProfile, PublicWaitlistResult, RecoveryCaseRecord, Reservation, Section, SmsUsageDetail, SmsUsageReport, Table, WaitlistEntry } from './types';

export const BASE = import.meta.env.VITE_API_URL || "https://iron-booking.onrender.com/api";

export interface ShiftMetrics {
  totalReservations: number;
  totalExpectedGuests: number;
  seatedReservations: number;
  seatedGuests: number;
  completedReservations: number;
  completedGuests: number;
  noShowReservations: number;
  noShowGuests: number;
  cancelledReservations: number;
  cancelledGuests: number;
  pendingReservations: number;
  confirmedReservations: number;
  walkIns: number;
  phoneReservations: number;
  onlineReservations: number;
  noShowPct: number;
  cancellationPct: number;
  remainingGuests: number;
}

// Carries structured error info from the backend.
export class ApiError extends Error {
  readonly fieldErrors: Record<string, string[]>;
  readonly code: string;
  readonly status: number;
  readonly details: unknown;
  constructor(message: string, fieldErrors: Record<string, string[]> = {}, code = '', details?: unknown, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.fieldErrors = fieldErrors;
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function getStoredAuth(): AuthState | null {
  try {
    const raw = localStorage.getItem('iron_auth');
    if (!raw) return null;
    return JSON.parse(raw) as AuthState;
  } catch {
    return null;
  }
}

export function storeAuth(token: string, user: AuthUser): void {
  localStorage.setItem('iron_auth', JSON.stringify({ token, user }));
}

export function clearAuth(): void {
  localStorage.removeItem('iron_auth');
}

// ── HQ auth storage (completely separate from host auth) ─────────────────────
const HQ_KEY = 'iron_hq_auth';

export function getStoredHQAuth(): AuthState | null {
  try {
    const raw = localStorage.getItem(HQ_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthState;
  } catch {
    return null;
  }
}

export function storeHQAuth(token: string, user: AuthUser): void {
  localStorage.setItem(HQ_KEY, JSON.stringify({ token, user }));
}

export function clearHQAuth(): void {
  localStorage.removeItem(HQ_KEY);
}

// ── Active session token ──────────────────────────────────────────────────────
// A module-level token that App.tsx sets on startup and on every login/logout.
// authHeaders() uses this so API calls always carry the right token regardless
// of which localStorage key (iron_auth vs iron_hq_auth) holds the session.
let _sessionToken: string | null = null;

export function setSessionToken(token: string | null): void {
  _sessionToken = token;
}

interface AuthState {
  token: string;
  user: AuthUser;
}

function authHeaders(): Record<string, string> {
  const base: Record<string, string> = { 'Content-Type': 'application/json' };
  if (_sessionToken) base['Authorization'] = `Bearer ${_sessionToken}`;
  return base;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: authHeaders(),
  });

  if (res.status === 401) {
    // Clear only the auth key that matches the current route context, then
    // redirect to the correct login page so the user lands on the right screen
    // after session expiry. /restaurant-admin uses iron_hq_auth, same as /hq.
    _sessionToken = null;
    if (window.location.pathname.startsWith('/restaurant-admin')) {
      clearHQAuth();
      window.location.replace('/restaurant-admin');
    } else if (window.location.pathname.startsWith('/hq')) {
      clearHQAuth();
      window.location.replace('/hq');
    } else {
      clearAuth();
      window.location.reload();
    }
    throw new Error('Session expired');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null) as {
      error?: { message?: string; code?: string; details?: { fieldErrors?: Record<string, string[]> } };
    } | null;
    const fieldErrors = body?.error?.details?.fieldErrors ?? {};
    const details = body?.error?.details as unknown;
    throw new ApiError(body?.error?.message ?? `HTTP ${res.status}`, fieldErrors, body?.error?.code ?? '', details, res.status);
  }

  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

// Public request — no auth header, no 401 reload. Used for guest-facing endpoints.
async function publicRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null) as {
      error?: { message?: string; code?: string; [key: string]: unknown };
    } | null;
    throw new ApiError(
      body?.error?.message ?? `HTTP ${res.status}`,
      {},
      body?.error?.code ?? '',
      body?.error
    );
  }

  return res.json() as Promise<T>;
}

// ─── Group Allocation Rule types ───────────────────────────────────────────

export interface GroupConfigSection {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  hasCombinations: boolean;
}

export interface GroupConfig {
  id: string;
  profileId: string;
  name: string;
  description: string | null;
  partySizeMin: number;
  partySizeMax: number;
  targetSectionId: string | null;
  targetSection: { id: string; name: string } | null;
  allocationMode: 'SINGLE' | 'COMBINATION';
  tableCount: number;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface GroupConfigBody {
  name: string;
  description?: string | null;
  partySizeMin: number;
  partySizeMax: number;
  targetSectionId?: string | null;
  allocationMode: 'SINGLE' | 'COMBINATION';
  tableCount?: number;
  isActive?: boolean;
  sortOrder?: number;
}

// ── Turn Time Rules ─────────────────────────────────────────────────────────
export interface TurnTimeRule {
  id: string;
  name: string;
  description: string | null;
  partySizeMin: number;
  partySizeMax: number;
  durationMinutes: number;
  isActive: boolean;
  sortOrder: number;
}
export interface TurnTimeRuleBody {
  name: string;
  description?: string | null;
  partySizeMin: number;
  partySizeMax: number;
  durationMinutes: number;
  isActive?: boolean;
  sortOrder?: number;
}

// ── Booking Time Windows ─────────────────────────────────────────────────────
export interface TimeWindow {
  id: string;
  name: string;
  description: string | null;
  dayOfWeek: number | null;
  specificDate: string | null;
  startTime: string;
  endTime: string;
  sourceScope: 'ONLINE' | 'HOST' | 'ALL';
  isActive: boolean;
  sortOrder: number;
}
export interface TimeWindowBody {
  name: string;
  description?: string | null;
  dayOfWeek?: number | null;
  specificDate?: string | null;
  startTime: string;
  endTime: string;
  sourceScope?: 'ONLINE' | 'HOST' | 'ALL';
  isActive?: boolean;
  sortOrder?: number;
}

export const api = {
  auth: {
    login: (email: string, password: string) =>
      request<{ token: string; user: AuthUser }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    pinLogin: (restaurantId: string, userId: string, pin: string) =>
      publicRequest<{ token: string; user: AuthUser }>('/auth/pin-login', {
        method: 'POST',
        body: JSON.stringify({ restaurantId, userId, pin }),
      }),
    devLogin: () =>
      request<{ token: string; user: AuthUser }>('/auth/dev-login', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    devSuperLogin: () =>
      request<{ token: string; user: AuthUser }>('/auth/dev-super-login', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    refresh: () =>
      request<{ token: string }>('/auth/refresh', { method: 'POST' }),
  },

  tables: {
    opSettings: () =>
      request<{ lateThresholdMinutes: number; noShowThresholdMinutes: number }>('/tables/op-settings'),
    floor: (date: string, time: string) =>
      request<FloorTable[]>(`/tables/floor?date=${date}&time=${encodeURIComponent(time)}`),
    suggestions: (date: string, time: string) =>
      request<FloorSuggestion[]>(`/tables/floor-suggestions?date=${date}&time=${encodeURIComponent(time)}`),
    insights: (date: string, time: string) =>
      request<FloorInsight[]>(`/tables/insights?date=${date}&time=${encodeURIComponent(time)}`),
    list: () => request<Table[]>('/tables'),
    suggest: (params: { date: string; time: string; partySize: number; duration?: number; excludeReservationId?: string }, options?: RequestInit) =>
      request<BackendTableSuggestion[]>(`/tables/suggest?date=${params.date}&time=${encodeURIComponent(params.time)}&partySize=${params.partySize}${params.duration ? `&duration=${params.duration}` : ''}${params.excludeReservationId ? `&excludeReservationId=${params.excludeReservationId}` : ''}`, options),
    best: (params: { date: string; time: string; partySize: number; duration?: number; excludeReservationId?: string }) =>
      request<BestTableResult | null>(`/tables/best?date=${params.date}&time=${encodeURIComponent(params.time)}&partySize=${params.partySize}${params.duration ? `&duration=${params.duration}` : ''}${params.excludeReservationId ? `&excludeReservationId=${params.excludeReservationId}` : ''}`),
    create: (body: {
      name: string; sectionId?: string; minCovers: number; maxCovers: number;
      shape?: string; posX?: number; posY?: number; width?: number; height?: number;
    }) => request<Table>('/tables', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: Partial<{
      name: string; sectionId: string | null; minCovers: number; maxCovers: number;
      shape: string; isActive: boolean; locked: boolean;
      posX: number; posY: number; width: number; height: number;
    }>) => request<Table>(`/tables/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id: string) => request<void>(`/tables/${id}`, { method: 'DELETE' }),
    lock: (id: string, body: { reason?: string | null; lockedUntil?: string | null }) =>
      request<Table>(`/tables/${id}/lock`, { method: 'PATCH', body: JSON.stringify(body) }),
    unlock: (id: string) =>
      request<Table>(`/tables/${id}/unlock`, { method: 'PATCH', body: JSON.stringify({}) }),
    listSections: () => request<Section[]>('/tables/sections'),
    upsertSection: (body: { name: string; color?: string; sortOrder?: number }) =>
      request<Section>('/tables/sections', { method: 'POST', body: JSON.stringify(body) }),
    listFloorObjects: () =>
      request<FloorObjectData[]>('/tables/floor-objects'),
    batchSaveFloorObjects: (objects: FloorObjectData[]) =>
      request<FloorObjectData[]>('/tables/floor-objects/batch', {
        method: 'POST',
        body: JSON.stringify({ objects }),
      }),
    rebuildDay: (tableId: string, body: { date: string; reason?: string; rebuildSessionId: string; ids?: string[] }) =>
      request<{ lifted: number; tableName: string }>(`/tables/${tableId}/rebuild-day`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },

  reservations: {
    create: (body: CreateReservationBody) =>
      request<Reservation>('/reservations', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    list: (params: Record<string, string>) => {
      const qs = new URLSearchParams(params).toString();
      return request<{ data: Reservation[]; meta: { total: number; page: number; limit: number } }>(
        `/reservations?${qs}`
      );
    },
    confirm: (id: string) =>
      request<Reservation & { _smsFailed?: boolean }>(`/reservations/${id}/confirm`, { method: 'POST' }),
    seat: (id: string, tableId: string, overrideConflicts = false, combinedTableIds: string[] = [], reorganizeIds: string[] = [], forceOverrideOccupied = false) =>
      request<Reservation & { _advisory?: { shortWindow: boolean; minutesUntil: number; nextGuestName: string; minutesLate?: number } | null }>(`/reservations/${id}/seat`, {
        method: 'POST',
        body: JSON.stringify({ tableId, overrideConflicts, combinedTableIds, reorganizeIds, forceOverrideOccupied }),
      }),
    move: (id: string, tableId: string, reason?: string, combinedTableIds: string[] = [], overrideConflicts = false, reorganizeIds: string[] = []) =>
      request<Reservation>(`/reservations/${id}/move`, {
        method: 'POST',
        body: JSON.stringify({ tableId, reason: reason || undefined, overrideConflicts, reorganizeIds, combinedTableIds }),
      }),
    swap: (aId: string, bId: string) =>
      request<{ reservationA: Reservation; reservationB: Reservation }>('/reservations/swap', {
        method: 'POST',
        body: JSON.stringify({ reservationAId: aId, reservationBId: bId }),
      }),
    complete: (id: string) =>
      request<Reservation>(`/reservations/${id}/complete`, { method: 'POST' }),
    noShow: (id: string) =>
      request<Reservation>(`/reservations/${id}/no-show`, { method: 'POST' }),
    cancel: (id: string, reason?: string) =>
      request<Reservation>(`/reservations/${id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    update: (id: string, body: Partial<{
      guestName: string;
      guestPhone: string;
      partySize: number;
      date: string;
      time: string;
      guestNotes: string;
      hostNotes: string;
      duration: number;
      tableId: string | null;
      combinedTableIds: string[];
      overrideConflicts: boolean;
      reorganizeIds: string[];
    }>) =>
      request<Reservation>(`/reservations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    unseat: (id: string) =>
      request<Reservation>(`/reservations/${id}/unseat`, { method: 'POST' }),
    unseatKeepTable: (id: string) =>
      request<Reservation>(`/reservations/${id}/unseat-keep-table`, { method: 'POST' }),
    unconfirm: (id: string) =>
      request<Reservation>(`/reservations/${id}/unconfirm`, { method: 'POST' }),
    undo: (id: string) =>
      request<Reservation>(`/reservations/${id}/undo`, { method: 'POST' }),
    sendConfirmation: (id: string) =>
      request<Reservation & { whatsappFailed?: boolean; smsFailed?: boolean }>(`/reservations/${id}/send-confirmation`, { method: 'POST' }),
    markConfirmedByGuest: (id: string) =>
      request<Reservation>(`/reservations/${id}/mark-confirmed`, { method: 'POST' }),
    markArrived: (id: string) =>
      request<Reservation>(`/reservations/${id}/mark-arrived`, { method: 'POST' }),
    unmarkArrived: (id: string) =>
      request<Reservation>(`/reservations/${id}/unmark-arrived`, { method: 'POST' }),
    sendBulkConfirmations: (body: { date: string; timeFrom?: string; timeTo?: string }) =>
      request<{ sent: number; failed: string[]; total: number }>('/reservations/send-confirmations', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    broadcast: (body: { date: string; message: string; reservationIds?: string[] }) =>
      request<{ sent: number; failed: string[]; total: number; errors: string[] }>('/reservations/broadcast', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    sendReminder: (id: string) =>
      request<Reservation>(`/reservations/${id}/send-reminder`, { method: 'POST' }),
    sendReminders: (body: { date: string; withinMinutes?: number }) =>
      request<{ sent: number; skipped: number; failed: string[]; total: number }>(
        '/reservations/send-reminders',
        { method: 'POST', body: JSON.stringify(body) }
      ),
    delete: (id: string) =>
      request<void>(`/reservations/${id}`, { method: 'DELETE' }),
    activityLog: (params: { date?: string; actor?: string; action?: string; page?: number; limit?: number }) => {
      const qs = new URLSearchParams(
        Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))
      ).toString();
      return request<{ data: ActivityLogEntry[]; meta: { total: number; page: number; limit: number } }>(
        `/reservations/activity-log${qs ? `?${qs}` : ''}`
      );
    },
  },

  waitlist: {
    list: (date: string, time?: string) =>
      request<WaitlistEntry[]>(`/waitlist?date=${date}${time ? `&time=${encodeURIComponent(time)}` : ''}`),
    add: (body: { guestName: string; partySize: number; guestPhone?: string; date: string; notes?: string }) =>
      request<WaitlistEntry>('/waitlist', { method: 'POST', body: JSON.stringify(body) }),
    seat: (id: string, tableId?: string, overrideConflicts = false) =>
      request<{ entry: WaitlistEntry; reservation: Reservation }>(`/waitlist/${id}/seat`, {
        method: 'POST',
        body: JSON.stringify({ tableId, overrideConflicts }),
      }),
    notify: (id: string) =>
      request<WaitlistEntry>(`/waitlist/${id}/notify`, { method: 'POST' }),
    update: (id: string, data: { partySize?: number; guestName?: string; notes?: string }) =>
      request<WaitlistEntry>(`/waitlist/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: string, reason: 'LEFT' | 'REMOVED') =>
      request<WaitlistEntry>(`/waitlist/${id}/remove`, { method: 'POST', body: JSON.stringify({ reason }) }),
  },

  guests: {
    lookupByPhone: (phone: string) =>
      request<{ guest: GuestLookupResult | null }>(`/guests/lookup?phone=${encodeURIComponent(phone)}`),
    search: (query: string, limit = 6) =>
      request<{ data: GuestSearchResult[]; meta: { total: number } }>(
        `/guests?search=${encodeURIComponent(query)}&limit=${limit}`
      ),
    list: (params: { search?: string; isVip?: boolean; isBlacklisted?: boolean; tag?: string; page?: number; limit?: number }) => {
      const qs = new URLSearchParams(
        Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))
      ).toString();
      return request<{ data: GuestListItem[]; meta: { total: number; page: number; limit: number } }>(
        `/guests${qs ? `?${qs}` : ''}`
      );
    },
    getById: (id: string) =>
      request<GuestDetail>(`/guests/${id}`),
    update: (id: string, body: Partial<{
      firstName: string; lastName: string; email: string | null; phone: string | null;
      isVip: boolean; isBlacklisted: boolean; allergies: string[]; tags: string[];
      preferences: Record<string, unknown>; internalNotes: string | null;
    }>) =>
      request<GuestDetail>(`/guests/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  },

  club: {
    members: (restaurantId: string, params?: { search?: string; status?: string; page?: number; limit?: number }) => {
      const qs = params ? new URLSearchParams(
        Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))
      ).toString() : '';
      return request<{ data: import('./types').ClubMember[]; meta: { total: number; page: number; limit: number } }>(
        `/restaurants/${restaurantId}/club/members${qs ? `?${qs}` : ''}`
      );
    },
    getMember: (restaurantId: string, memberId: string) =>
      request<import('./types').ClubMember>(`/restaurants/${restaurantId}/club/members/${memberId}`),
    addMember: (restaurantId: string, body: {
      guestId: string; source: import('./types').ClubJoinSource;
      birthday?: string; anniversary?: string;
      marketingConsent?: boolean; smsConsent?: boolean; emailConsent?: boolean; notes?: string;
    }) =>
      request<import('./types').ClubMember>(`/restaurants/${restaurantId}/club/members`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    updateMember: (restaurantId: string, memberId: string, body: Partial<{
      birthday: string | null; anniversary: string | null;
      marketingConsent: boolean; smsConsent: boolean; emailConsent: boolean;
      status: import('./types').ClubMemberStatus; notes: string | null;
    }>) =>
      request<import('./types').ClubMember>(`/restaurants/${restaurantId}/club/members/${memberId}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }),
    stats: (restaurantId: string) =>
      request<import('./types').ClubStats>(`/restaurants/${restaurantId}/club/stats`),
    pendingApprovals: (restaurantId: string, type?: string) => {
      const qs = type ? `?type=${type}` : '';
      return request<import('./types').PendingApproval[]>(`/restaurants/${restaurantId}/club/pending-approvals${qs}`);
    },
    upcomingEvents: (restaurantId: string, days = 30) =>
      request<import('./types').UpcomingClubEvents>(`/restaurants/${restaurantId}/club/upcoming-events?days=${days}`),
    sendEventSms: (restaurantId: string, memberId: string, eventType: 'birthday' | 'anniversary') =>
      request<{ ok: boolean; messageLogId: string }>(`/restaurants/${restaurantId}/club/members/${memberId}/send-event-sms`, {
        method: 'POST', body: JSON.stringify({ eventType }),
      }),
    rewards: (restaurantId: string, status?: string, page = 1, limit = 50) => {
      const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (status) qs.set('status', status);
      return request<{ data: import('./types').GuestReward[]; meta: { total: number; page: number; limit: number } }>(
        `/restaurants/${restaurantId}/club/rewards?${qs}`,
      );
    },
    rewardStats: (restaurantId: string) =>
      request<import('./types').RewardStats>(`/restaurants/${restaurantId}/club/rewards/stats`),
    createReward: (restaurantId: string, body: {
      guestId: string; clubMemberId?: string; type: import('./types').RewardType;
      title: string; description?: string; expiresAt?: string;
    }) =>
      request<import('./types').GuestReward>(`/restaurants/${restaurantId}/club/rewards`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    redeemReward: (restaurantId: string, rewardId: string) =>
      request<import('./types').GuestReward>(`/restaurants/${restaurantId}/club/rewards/${rewardId}/redeem`, {
        method: 'PATCH',
      }),
    guestActiveRewards: (restaurantId: string, guestId: string) =>
      request<import('./types').GuestReward[]>(`/restaurants/${restaurantId}/club/rewards/guest/${guestId}`),
    invites: (restaurantId: string) =>
      request<import('./types').ClubJoinInvite[]>(`/restaurants/${restaurantId}/club/invites`),
    createInvite: (restaurantId: string, body: {
      guestId?: string; guestName?: string; guestPhone?: string; reservationId?: string; expiresInDays?: number;
    }) =>
      request<{ invite: import('./types').ClubJoinInvite; joinUrl: string }>(`/restaurants/${restaurantId}/club/invites`, {
        method: 'POST', body: JSON.stringify(body),
      }),
  },

  join: {
    get: (token: string) =>
      request<{ restaurantName: string; restaurantSlug: string; guestName: string | null; alreadyJoined: boolean; expired: boolean }>(
        `/join/${token}`
      ),
    submit: (token: string, body: {
      firstName: string; lastName: string; phone?: string;
      birthday?: string; anniversary?: string;
      smsConsent?: boolean; marketingConsent?: boolean;
    }) =>
      request<{ ok: boolean; membershipId: string }>(`/join/${token}`, { method: 'POST', body: JSON.stringify(body) }),
  },

  recovery: {
    list: (restaurantId: string, params?: { status?: string; priority?: string; page?: number; limit?: number }) => {
      const qs = params ? new URLSearchParams(
        Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))
      ).toString() : '';
      return request<import('./types').RecoveryCaseList>(`/restaurants/${restaurantId}/recovery/cases${qs ? `?${qs}` : ''}`);
    },
    getCase: (restaurantId: string, caseId: string) =>
      request<import('./types').RecoveryCase>(`/restaurants/${restaurantId}/recovery/cases/${caseId}`),
    createCase: (restaurantId: string, body: {
      guestId: string; description: string; priority?: string; assignedTo?: string; dueDate?: string; reservationId?: string;
    }) =>
      request<import('./types').RecoveryCase>(`/restaurants/${restaurantId}/recovery/cases`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    updateCase: (restaurantId: string, caseId: string, body: Partial<{
      status: string; priority: string; assignedTo: string | null; dueDate: string | null; description: string;
    }>) =>
      request<import('./types').RecoveryCase>(`/restaurants/${restaurantId}/recovery/cases/${caseId}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }),
    addAction: (restaurantId: string, caseId: string, body: { actorName: string; note: string }) =>
      request<{ action: import('./types').RecoveryAction; case: import('./types').RecoveryCase }>(
        `/restaurants/${restaurantId}/recovery/cases/${caseId}/actions`,
        { method: 'POST', body: JSON.stringify(body) }
      ),
    stats: (restaurantId: string) =>
      request<import('./types').RecoveryStats>(`/restaurants/${restaurantId}/recovery/stats`),
  },

  alerts: {
    center: (restaurantId: string) =>
      request<import('./types').AlertCenter>(`/restaurants/${restaurantId}/alerts/center`),
    read: (restaurantId: string, alertId: string) =>
      request<{ ok: boolean }>(`/restaurants/${restaurantId}/alerts/${alertId}/read`, { method: 'PATCH' }),
    dismiss: (restaurantId: string, alertId: string) =>
      request<{ ok: boolean }>(`/restaurants/${restaurantId}/alerts/${alertId}/dismiss`, { method: 'PATCH' }),
    dismissAll: (restaurantId: string, type?: string) =>
      request<{ count: number }>(`/restaurants/${restaurantId}/alerts/dismiss-all`, {
        method: 'POST', body: JSON.stringify(type ? { type } : {}),
      }),
  },

  messaging: {
    summary: (params?: { restaurantId?: string; month?: string }) => {
      const qs = params ? new URLSearchParams(
        Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))
      ).toString() : '';
      return request<import('./types').MessagingSummary>(`/messaging/analytics/summary${qs ? `?${qs}` : ''}`);
    },
    byRestaurant: () =>
      request<import('./types').MessagingByRestaurant[]>(`/messaging/analytics/by-restaurant`),
    daily: (params?: { restaurantId?: string; days?: number }) => {
      const qs = params ? new URLSearchParams(
        Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))
      ).toString() : '';
      return request<import('./types').MessagingDailyRow[]>(`/messaging/analytics/daily${qs ? `?${qs}` : ''}`);
    },
  },

  momentQueue: {
    list: (restaurantId: string, type?: string, status?: string) => {
      const qs = new URLSearchParams(
        Object.fromEntries([['type', type], ['status', status]].filter(([, v]) => v !== undefined) as [string, string][])
      ).toString();
      return request<import('./types').MomentQueueItem[]>(
        `/restaurants/${restaurantId}/intelligence/moments${qs ? `?${qs}` : ''}`
      );
    },
    approve: (restaurantId: string, momentId: string, finalMessage?: string) =>
      request<import('./types').MomentQueueItem>(
        `/restaurants/${restaurantId}/intelligence/moments/${momentId}/review`,
        { method: 'POST', body: JSON.stringify({ action: 'approve', finalMessage }) }
      ),
    reject: (restaurantId: string, momentId: string) =>
      request<import('./types').MomentQueueItem>(
        `/restaurants/${restaurantId}/intelligence/moments/${momentId}/review`,
        { method: 'POST', body: JSON.stringify({ action: 'reject' }) }
      ),
  },

  feedback: {
    get: (token: string) =>
      request<{
        restaurant: { name: string; slug: string };
        guestName: string | null;
        date: string | null;
        time: string | null;
        alreadySubmitted: boolean;
      }>(`/feedback/${token}`),
    submit: (token: string, body: { sentiment: 'EXCELLENT' | 'GOOD' | 'BAD'; freeText?: string; tags?: string[] }) =>
      request<{ ok: boolean }>(`/feedback/${token}`, { method: 'POST', body: JSON.stringify(body) }),
  },

  intelligence: {
    getGuest: (restaurantId: string, guestId: string) =>
      request<GuestIntelligence>(`/restaurants/${restaurantId}/intelligence/guests/${guestId}`),
    refreshGuest: (restaurantId: string, guestId: string) =>
      request<GuestIntelligence>(`/restaurants/${restaurantId}/intelligence/guests/${guestId}/refresh`, { method: 'POST' }),
    addMemory: (restaurantId: string, guestId: string, body: {
      category: string; headline: string; context?: string;
      emotionalWeight?: number; occurredAt: string;
    }) =>
      request<GuestMemoryRecord>(`/restaurants/${restaurantId}/intelligence/guests/${guestId}/memories`, { method: 'POST', body: JSON.stringify(body) }),
    dismissAlert: (restaurantId: string, alertId: string) =>
      request<{ ok: boolean }>(`/restaurants/${restaurantId}/intelligence/alerts/${alertId}`, { method: 'DELETE' }),
    createRecovery: (restaurantId: string, guestId: string, body: { description: string; reservationId?: string }) =>
      request<RecoveryCaseRecord>(`/restaurants/${restaurantId}/intelligence/guests/${guestId}/recovery`, { method: 'POST', body: JSON.stringify(body) }),
    addRecoveryAction: (restaurantId: string, caseId: string, body: { actorName: string; note: string }) =>
      request<{ id: string }>(`/restaurants/${restaurantId}/intelligence/recovery/${caseId}/actions`, { method: 'POST', body: JSON.stringify(body) }),
    resolveRecovery: (restaurantId: string, caseId: string) =>
      request<RecoveryCaseRecord>(`/restaurants/${restaurantId}/intelligence/recovery/${caseId}/resolve`, { method: 'POST' }),
    getMoments: (restaurantId: string) =>
      request<MomentRecord[]>(`/restaurants/${restaurantId}/intelligence/moments`),
    reviewMoment: (restaurantId: string, momentId: string, body: { action: 'approve' | 'reject'; finalMessage?: string }) =>
      request<MomentRecord>(`/restaurants/${restaurantId}/intelligence/moments/${momentId}/review`, { method: 'POST', body: JSON.stringify(body) }),
    getMorningBrief: (restaurantId: string) =>
      request<MorningBriefRecord>(`/restaurants/${restaurantId}/intelligence/morning-brief`),
    backfillV2: (restaurantId: string, dryRun: boolean) =>
      request<{
        total: number;
        processed: number;
        errors: number;
        errorDetails: Array<{ guestId: string; error: string }>;
        labelDistribution: Record<string, number>;
        scoreStats: { scored: number; avgLoyalty: number; avgEngagement: number; maxLoyalty: number | null; minLoyalty: number | null };
        dryRun?: boolean;
      }>(`/restaurants/${restaurantId}/intelligence/backfill-v2${dryRun ? '?dryRun=true' : ''}`, { method: 'POST' }),
  },

  admin: {
    bootstrapStatus: () =>
      request<{ bootstrapped: boolean }>('/admin/bootstrap-status'),
    bootstrap: (body: { email: string; password: string; firstName: string; lastName: string }) =>
      request<{ token: string; user: AuthUser }>('/admin/bootstrap', {
        method: 'POST', body: JSON.stringify(body),
      }),
    restaurants: {
      list: () =>
        request<AdminRestaurant[]>('/admin/restaurants'),
      create: (body: {
        name: string; slug: string; timezone?: string;
        phone?: string; email?: string; address?: string;
      }) => request<AdminRestaurant>('/admin/restaurants', { method: 'POST', body: JSON.stringify(body) }),
      get: (id: string) =>
        request<AdminRestaurantDetail>(`/admin/restaurants/${id}`),
      update: (id: string, body: {
        name?: string; phone?: string | null; email?: string | null;
        address?: string | null; timezone?: string;
      }) => request<AdminRestaurant>(`/admin/restaurants/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
      settings: (id: string, body: Record<string, unknown>) =>
        request<AdminRestaurant>(`/admin/restaurants/${id}/settings`, { method: 'PATCH', body: JSON.stringify(body) }),
      sampleLayout: (id: string) =>
        request<{ ok: boolean }>(`/admin/restaurants/${id}/sample-layout`, { method: 'POST', body: JSON.stringify({}) }),
      updateWhatsapp: (id: string, body: { ultramsgInstanceId: string | null; ultramsgToken: string | null; whatsappPhone?: string | null }) =>
        request<{ id: string; ultramsgInstanceId: string | null; whatsappPhone: string | null; tokenSet: boolean }>(`/admin/restaurants/${id}/whatsapp`, { method: 'PATCH', body: JSON.stringify(body) }),
      testWhatsapp: (id: string) =>
        request<{ ok: boolean; to: string }>(`/admin/restaurants/${id}/whatsapp/test`, { method: 'POST', body: JSON.stringify({}) }),
      updateBranding: (id: string, body: { cuisine?: string | null; primaryColor?: string | null; accentColor?: string | null; publicThemePreset?: string | null; logoUrl?: string | null; coverImageUrl?: string | null; heroVideoUrl?: string | null; buttonStyle?: string | null; cardStyle?: string | null; backgroundMood?: string | null; backgroundColorHex?: string | null; backgroundGradientHex?: string | null; websiteUrl?: string | null; instagramUrl?: string | null; googleMapsUrl?: string | null; wazeUrl?: string | null }) =>
        request<{ id: string; cuisine: string | null; primaryColor: string | null; accentColor: string | null; publicThemePreset: string | null; logoUrl: string | null; coverImageUrl: string | null; heroVideoUrl: string | null; buttonStyle: string | null; cardStyle: string | null; backgroundMood: string | null; backgroundColorHex: string | null; backgroundGradientHex: string | null; websiteUrl: string | null; instagramUrl: string | null; googleMapsUrl: string | null; wazeUrl: string | null }>(`/admin/restaurants/${id}/branding`, { method: 'PATCH', body: JSON.stringify(body) }),
      updatePortalPermissions: (id: string, body: { canManageOperatingHours?: boolean; canManageOnlineRestrictions?: boolean }) =>
        request<{ canManageOperatingHours: boolean; canManageOnlineRestrictions: boolean }>(`/admin/restaurants/${id}/portal-permissions`, { method: 'PATCH', body: JSON.stringify(body) }),
      updateOperatingHours: (id: string, hours: Array<{ dayOfWeek: number; isOpen: boolean; openTime: string; closeTime: string; lastSeating: string }>) =>
        request<Array<{ dayOfWeek: number; isOpen: boolean; openTime: string; closeTime: string; lastSeating: string }>>(`/admin/restaurants/${id}/operating-hours`, { method: 'PUT', body: JSON.stringify({ hours }) }),
      onlineRestrictions: {
        list: (id: string) =>
          request<Array<{ id: string; date: string; startTime: string | null; endTime: string | null; restrictionType: string; reason: string | null; guestMessage: string | null; createdAt: string; createdBy: string }>>(`/admin/restaurants/${id}/online-restrictions`),
        create: (id: string, body: { date: string; startTime?: string | null; endTime?: string | null; restrictionType?: string; reason?: string | null; guestMessage?: string | null }) =>
          request<{ id: string; date: string; startTime: string | null; endTime: string | null; restrictionType: string; reason: string | null; guestMessage: string | null; createdAt: string; createdBy: string }>(`/admin/restaurants/${id}/online-restrictions`, { method: 'POST', body: JSON.stringify(body) }),
        delete: (id: string, rid: string) =>
          request<{ ok: boolean }>(`/admin/restaurants/${id}/online-restrictions/${rid}`, { method: 'DELETE' }),
      },
      groupConfigs: {
        list: (id: string) =>
          request<{
            configs: GroupConfig[];
            sections: GroupConfigSection[];
            hasProfile: boolean;
          }>(`/admin/restaurants/${id}/group-configs`),
        create: (id: string, body: GroupConfigBody) =>
          request<GroupConfig>(`/admin/restaurants/${id}/group-configs`, { method: 'POST', body: JSON.stringify(body) }),
        update: (id: string, cid: string, body: Partial<GroupConfigBody>) =>
          request<GroupConfig>(`/admin/restaurants/${id}/group-configs/${cid}`, { method: 'PATCH', body: JSON.stringify(body) }),
        delete: (id: string, cid: string) =>
          request<{ ok: boolean }>(`/admin/restaurants/${id}/group-configs/${cid}`, { method: 'DELETE' }),
      },
      turnTimeRules: {
        list: (id: string) =>
          request<{ rules: TurnTimeRule[] }>(`/admin/restaurants/${id}/turn-time-rules`),
        create: (id: string, body: TurnTimeRuleBody) =>
          request<TurnTimeRule>(`/admin/restaurants/${id}/turn-time-rules`, { method: 'POST', body: JSON.stringify(body) }),
        update: (id: string, rid: string, body: Partial<TurnTimeRuleBody>) =>
          request<TurnTimeRule>(`/admin/restaurants/${id}/turn-time-rules/${rid}`, { method: 'PATCH', body: JSON.stringify(body) }),
        delete: (id: string, rid: string) =>
          request<{ ok: boolean }>(`/admin/restaurants/${id}/turn-time-rules/${rid}`, { method: 'DELETE' }),
      },
      timeWindows: {
        list: (id: string) =>
          request<{ windows: TimeWindow[] }>(`/admin/restaurants/${id}/time-windows`),
        create: (id: string, body: TimeWindowBody) =>
          request<TimeWindow>(`/admin/restaurants/${id}/time-windows`, { method: 'POST', body: JSON.stringify(body) }),
        update: (id: string, wid: string, body: Partial<TimeWindowBody>) =>
          request<TimeWindow>(`/admin/restaurants/${id}/time-windows/${wid}`, { method: 'PATCH', body: JSON.stringify(body) }),
        delete: (id: string, wid: string) =>
          request<{ ok: boolean }>(`/admin/restaurants/${id}/time-windows/${wid}`, { method: 'DELETE' }),
      },
    },
    sms: {
      usage: (month?: string) =>
        request<SmsUsageReport>(`/admin/sms/usage${month ? `?month=${encodeURIComponent(month)}` : ''}`),
      usageDetail: (restaurantId: string, month?: string) =>
        request<SmsUsageDetail>(`/admin/sms/usage/${restaurantId}${month ? `?month=${encodeURIComponent(month)}` : ''}`),
      test: (body: { restaurantId: string; to: string; message: string; type?: string }) =>
        request<{ result: { success: boolean; messageLogId: string; providerMessageId?: string }; log: { status: string; provider: string; senderName: string | null; providerMessageId: string | null; errorMessage: string | null } | null }>(
          '/admin/sms/test', { method: 'POST', body: JSON.stringify(body) }),
    },
    telephony: {
      list: () =>
        request<Array<{ id: string; name: string; slug: string; linkPhone: string | null; linkGroupIds: string[] }>>('/admin/telephony'),
      unresolvedGroups: () =>
        request<{ groups: Array<{ group: string; unresolvedCount: number; lastSeen: string | null; assignedTo: string | null }> }>('/admin/telephony/unresolved-groups'),
    },
    groups: {
      list: () =>
        request<AdminGroup[]>('/admin/groups'),
      create: (body: { name: string; slug: string }) =>
        request<AdminGroup>('/admin/groups', { method: 'POST', body: JSON.stringify(body) }),
      get: (id: string) =>
        request<AdminGroupDetail>(`/admin/groups/${id}`),
      update: (id: string, body: { name: string }) =>
        request<AdminGroup>(`/admin/groups/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
      addRestaurant: (groupId: string, restaurantId: string) =>
        request<AdminRestaurant>(`/admin/groups/${groupId}/restaurants/${restaurantId}`, { method: 'POST', body: JSON.stringify({}) }),
      removeRestaurant: (groupId: string, restaurantId: string) =>
        request<AdminRestaurant>(`/admin/groups/${groupId}/restaurants/${restaurantId}`, { method: 'DELETE' }),
      createHqUser: (groupId: string, body: { email: string; password: string; firstName: string; lastName: string }) =>
        request<AdminUser>(`/admin/groups/${groupId}/users`, { method: 'POST', body: JSON.stringify(body) }),
      tonight: (id: string) =>
        request<LocationTonightStats[]>(`/admin/groups/${id}/tonight`),
    },
    users: {
      list: (restaurantId: string) =>
        request<AdminUser[]>(`/admin/restaurants/${restaurantId}/users`),
      create: (restaurantId: string, body: {
        email: string; password: string; firstName: string; lastName: string; role?: string;
      }) => request<AdminUser>(`/admin/restaurants/${restaurantId}/users`, { method: 'POST', body: JSON.stringify(body) }),
      update: (id: string, body: {
        firstName?: string; lastName?: string; role?: string; isActive?: boolean; password?: string;
      }) => request<AdminUser>(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    },
    guestHub: {
      get: (restaurantId: string) =>
        request<{
          id: string; slug: string; restaurantId: string | null; isActive: boolean;
          publicStatus: 'DRAFT' | 'PUBLISHED' | 'INACTIVE';
          lastPublishedAt: string | null; draftUpdatedAt: string | null;
          branding: { id: string; name: string; tagline: string | null; about: string | null; estYear: number | null; features: string[]; phone: string | null; address: string | null; logoUrl: string | null; coverImageUrl: string | null; primaryColor: string | null; themePreset: string | null; galleryImages: string[]; galleryEnabled: boolean } | null;
          socialLinks: Array<{ id: string; platform: string; handle: string; sortOrder: number }>;
          publishedBranding: { id: string; name: string; tagline: string | null; about: string | null; estYear: number | null; features: string[]; phone: string | null; address: string | null; logoUrl: string | null; coverImageUrl: string | null; primaryColor: string | null; themePreset: string | null; galleryImages: string[]; galleryEnabled: boolean } | null;
          publishedSocialLinks: Array<{ id: string; platform: string; handle: string; sortOrder: number }>;
          qrTokens: Array<{ id: string; token: string; label: string | null; isActive: boolean; metadata: Record<string, unknown> | null }>;
        }>(`/admin/hub/${encodeURIComponent(restaurantId)}`),
      updateBranding: (restaurantId: string, body: { name: string; tagline: string | null; about?: string | null; estYear?: number | null; features?: string[]; phone: string | null; address: string | null; logoUrl: string | null; coverImageUrl: string | null; themePreset?: string | null; galleryImages?: string[]; galleryEnabled?: boolean }) =>
        request<{ id: string; name: string; tagline: string | null; about: string | null; estYear: number | null; features: string[]; phone: string | null; address: string | null; logoUrl: string | null; coverImageUrl: string | null; primaryColor: string | null; themePreset: string | null; galleryImages: string[]; galleryEnabled: boolean }>(
          `/admin/hub/${encodeURIComponent(restaurantId)}/branding`,
          { method: 'PATCH', body: JSON.stringify(body) }
        ),
      updateSocial: (restaurantId: string, links: Array<{ platform: string; handle: string }>) =>
        request<{ links: Array<{ id: string; platform: string; handle: string; sortOrder: number }> }>(
          `/admin/hub/${encodeURIComponent(restaurantId)}/social`,
          { method: 'PUT', body: JSON.stringify({ links }) }
        ),
      publish: (restaurantId: string) =>
        request<{ publishedAt: string }>(
          `/admin/hub/${encodeURIComponent(restaurantId)}/publish`,
          { method: 'POST' }
        ),
      provision: (restaurantId: string) =>
        request<{
          id: string; slug: string; restaurantId: string | null; isActive: boolean;
          publicStatus: 'DRAFT' | 'PUBLISHED' | 'INACTIVE';
          lastPublishedAt: string | null; draftUpdatedAt: string | null;
          branding: { id: string; name: string; tagline: string | null; about: string | null; estYear: number | null; features: string[]; phone: string | null; address: string | null; logoUrl: string | null; coverImageUrl: string | null; primaryColor: string | null; themePreset: string | null; galleryImages: string[]; galleryEnabled: boolean } | null;
          socialLinks: Array<{ id: string; platform: string; handle: string; sortOrder: number }>;
          publishedBranding: { id: string; name: string; tagline: string | null; about: string | null; estYear: number | null; features: string[]; phone: string | null; address: string | null; logoUrl: string | null; coverImageUrl: string | null; primaryColor: string | null; themePreset: string | null; galleryImages: string[]; galleryEnabled: boolean } | null;
          publishedSocialLinks: Array<{ id: string; platform: string; handle: string; sortOrder: number }>;
          qrTokens: Array<{ id: string; token: string; label: string | null; isActive: boolean; metadata: Record<string, unknown> | null }>;
        }>(`/admin/hub/${encodeURIComponent(restaurantId)}/provision`, { method: 'POST' }),
      activate: (restaurantId: string) =>
        request<{ publicStatus: 'DRAFT' | 'PUBLISHED' | 'INACTIVE' }>(
          `/admin/hub/${encodeURIComponent(restaurantId)}/activate`,
          { method: 'POST' }
        ),
      deactivate: (restaurantId: string) =>
        request<{ publicStatus: 'DRAFT' | 'PUBLISHED' | 'INACTIVE' }>(
          `/admin/hub/${encodeURIComponent(restaurantId)}/deactivate`,
          { method: 'POST' }
        ),
      tokens: {
        list: (restaurantId: string) =>
          request<{
            tokens: Array<{
              id: string; token: string; label: string | null; isActive: boolean;
              metadata: { tableName?: string; zone?: string; campaign?: string; source?: string };
              createdAt: string;
            }>;
          }>(`/admin/hub/${encodeURIComponent(restaurantId)}/tokens`),
        create: (restaurantId: string, body: { label?: string | null; metadata?: { tableName?: string; zone?: string; campaign?: string; source?: string } }) =>
          request<{
            id: string; token: string; label: string | null; isActive: boolean;
            metadata: { tableName?: string; zone?: string; campaign?: string; source?: string };
            createdAt: string;
          }>(`/admin/hub/${encodeURIComponent(restaurantId)}/tokens`, { method: 'POST', body: JSON.stringify(body) }),
        update: (restaurantId: string, tokenId: string, body: { label?: string | null; metadata?: { tableName?: string; zone?: string; campaign?: string; source?: string } }) =>
          request<{
            id: string; token: string; label: string | null; isActive: boolean;
            metadata: { tableName?: string; zone?: string; campaign?: string; source?: string };
            createdAt: string;
          }>(`/admin/hub/${encodeURIComponent(restaurantId)}/tokens/${encodeURIComponent(tokenId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
        deactivate: (restaurantId: string, tokenId: string) =>
          request<{
            id: string; token: string; label: string | null; isActive: boolean;
            metadata: { tableName?: string; zone?: string; campaign?: string; source?: string };
            createdAt: string;
          }>(`/admin/hub/${encodeURIComponent(restaurantId)}/tokens/${encodeURIComponent(tokenId)}/deactivate`, { method: 'POST' }),
        reactivate: (restaurantId: string, tokenId: string) =>
          request<{
            id: string; token: string; label: string | null; isActive: boolean;
            metadata: { tableName?: string; zone?: string; campaign?: string; source?: string };
            createdAt: string;
          }>(`/admin/hub/${encodeURIComponent(restaurantId)}/tokens/${encodeURIComponent(tokenId)}/reactivate`, { method: 'POST' }),
      },
      menu: {
        get: (restaurantId: string) =>
          request<{
            menus: Array<{
              id: string; name: string; sortOrder: number; isActive: boolean;
              categories: Array<{
                id: string; menuId: string; name: string; description: string | null;
                sortOrder: number; isActive: boolean; isHidden: boolean;
                dishes: Array<{
                  id: string; categoryId: string; name: string; subtitle: string | null;
                  description: string | null; price: string | null; tag: string | null;
                  dietaryTags: string[]; availability: string;
                  isFeatured: boolean; featuredRank: number | null; sortOrder: number;
                  imageUrl: string | null; gradient: string | null;
                  isActive: boolean; isHidden: boolean;
                }>;
              }>;
            }>;
          }>(`/admin/hub/${encodeURIComponent(restaurantId)}/menu`),
        createCategory: (restaurantId: string, body: { name: string; description?: string | null; sortOrder?: number }) =>
          request<{ id: string; menuId: string; name: string; description: string | null; sortOrder: number; isActive: boolean; isHidden: boolean; dishes: unknown[] }>(
            `/admin/hub/${encodeURIComponent(restaurantId)}/menu/categories`,
            { method: 'POST', body: JSON.stringify(body) }
          ),
        updateCategory: (restaurantId: string, categoryId: string, body: Record<string, unknown>) =>
          request<{ id: string; menuId: string; name: string; description: string | null; sortOrder: number; isActive: boolean; isHidden: boolean; dishes: unknown[] }>(
            `/admin/hub/${encodeURIComponent(restaurantId)}/menu/categories/${encodeURIComponent(categoryId)}`,
            { method: 'PATCH', body: JSON.stringify(body) }
          ),
        createDish: (restaurantId: string, categoryId: string, body: Record<string, unknown>) =>
          request<{ id: string; categoryId: string; name: string; subtitle: string | null; description: string | null; price: string | null; tag: string | null; dietaryTags: string[]; availability: string; isFeatured: boolean; featuredRank: number | null; sortOrder: number; imageUrl: string | null; gradient: string | null; isActive: boolean; isHidden: boolean }>(
            `/admin/hub/${encodeURIComponent(restaurantId)}/menu/categories/${encodeURIComponent(categoryId)}/dishes`,
            { method: 'POST', body: JSON.stringify(body) }
          ),
        updateDish: (restaurantId: string, categoryId: string, dishId: string, body: Record<string, unknown>) =>
          request<{ id: string; categoryId: string; name: string; subtitle: string | null; description: string | null; price: string | null; tag: string | null; dietaryTags: string[]; availability: string; isFeatured: boolean; featuredRank: number | null; sortOrder: number; imageUrl: string | null; gradient: string | null; isActive: boolean; isHidden: boolean }>(
            `/admin/hub/${encodeURIComponent(restaurantId)}/menu/categories/${encodeURIComponent(categoryId)}/dishes/${encodeURIComponent(dishId)}`,
            { method: 'PATCH', body: JSON.stringify(body) }
          ),
      },
    },
  },

  hosts: {
    list: () =>
      request<HostUser[]>('/hosts'),
    create: (body: { firstName: string; lastName: string; role?: string; avatarUrl?: string | null; pin?: string }) =>
      request<HostUser>('/hosts', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: { firstName?: string; lastName?: string; role?: string; avatarUrl?: string | null }) =>
      request<HostUser>(`/hosts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    setPin: (id: string, pin: string) =>
      request<HostUser>(`/hosts/${id}/set-pin`, { method: 'POST', body: JSON.stringify({ pin }) }),
    toggleActive: (id: string) =>
      request<HostUser>(`/hosts/${id}/active`, { method: 'PATCH', body: JSON.stringify({}) }),
    remove: (id: string) =>
      request<void>(`/hosts/${id}`, { method: 'DELETE' }),
  },

  analytics: {
    shiftSummary: (date: string) =>
      request<{
        date: string;
        lunchStart: string;
        dinnerStart: string;
        all: ShiftMetrics;
        lunch: ShiftMetrics;
        dinner: ShiftMetrics;
      }>(`/analytics/shift-summary?date=${date}`),
  },

  public: {
    getRestaurantBySlug: (slug: string) =>
      publicRequest<{ id: string; name: string; slug: string; logoUrl: string | null; primaryColor: string | null }>(
        `/public/restaurant/${encodeURIComponent(slug)}`
      ),

    getHosts: (restaurantId: string) =>
      publicRequest<Array<{ id: string; firstName: string; lastName: string; avatarUrl: string | null; role: string }>>(`/public/hosts?restaurantId=${encodeURIComponent(restaurantId)}`),

    getReservation: (token: string) =>
      publicRequest<PublicReservation>(`/public/reservation?token=${encodeURIComponent(token)}`),
    confirm: (token: string) =>
      publicRequest<{ status: string; isConfirmedByGuest: boolean; alreadyConfirmed?: boolean }>(
        '/public/confirm', { method: 'POST', body: JSON.stringify({ token }) }
      ),
    cancel: (token: string) =>
      publicRequest<{ status: string; alreadyCancelled?: boolean }>(
        '/public/cancel', { method: 'POST', body: JSON.stringify({ token }) }
      ),
    late: (token: string) =>
      publicRequest<{ isRunningLate: boolean; alreadyNotified?: boolean }>(
        '/public/late', { method: 'POST', body: JSON.stringify({ token }) }
      ),

    book: {
      getProfile: (slug: string) =>
        publicRequest<PublicRestaurantProfile>(`/public/book/${encodeURIComponent(slug)}`),

      getAvailability: (slug: string, date: string, partySize: number) =>
        publicRequest<AvailabilityResponse>(
          `/public/book/${encodeURIComponent(slug)}/availability?date=${encodeURIComponent(date)}&partySize=${partySize}`
        ),

      // Returns BookingResult on success; throws ApiError with code='SLOT_TAKEN'
      // and details.alternatives on 409.
      reserve: async (slug: string, body: {
        date: string; time: string; partySize: number;
        guestName: string; guestPhone: string;
        guestEmail?: string; occasion?: string; guestNotes?: string;
        lang?: 'en' | 'he';
        marketingOptIn?: boolean; smsConsent?: boolean; birthday?: string; anniversary?: string;
      }): Promise<BookingResult> => {
        const res = await fetch(`${BASE}/public/book/${encodeURIComponent(slug)}/reserve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => null) as (BookingResult & {
          error?: { message?: string; code?: string; alternatives?: BookingAlternative[] }
        }) | null;
        if (!res.ok) {
          const err = json?.error ?? {};
          throw new ApiError(err.message ?? `HTTP ${res.status}`, {}, err.code ?? '', err);
        }
        return json as BookingResult;
      },

      joinWaitlist: (slug: string, body: {
        guestName: string; guestPhone: string; partySize: number; date: string;
        preferredTime: string; flexibleTime?: boolean; notes?: string; lang?: 'en' | 'he';
      }) => publicRequest<PublicWaitlistResult>(`/public/book/${encodeURIComponent(slug)}/waitlist`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    },
  },

  callLogs: {
    list: (params?: { limit?: number; offset?: number; date?: string }) => {
      const qs = new URLSearchParams();
      if (params?.limit  != null) qs.set('limit',  String(params.limit));
      if (params?.offset != null) qs.set('offset', String(params.offset));
      if (params?.date   != null) qs.set('date',   params.date);
      const query = qs.toString();
      return request<{ data: import('./types').CallLogItem[]; meta: { total: number; limit: number; offset: number } }>(
        `/call-logs${query ? `?${query}` : ''}`
      );
    },
  },
};
