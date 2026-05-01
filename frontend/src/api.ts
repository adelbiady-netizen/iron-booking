import type { AdminRestaurant, AdminRestaurantDetail, AdminUser, AuthUser, CreateReservationBody, FloorInsight, FloorObjectData, FloorSuggestion, FloorTable, GuestDetail, GuestListItem, GuestLookupResult, GuestSearchResult, Reservation, Section, Table, WaitlistEntry } from './types';

export const BASE = "https://iron-booking.onrender.com/api";

// Carries field-level validation errors from the backend (Zod VALIDATION_ERROR responses).
export class ApiError extends Error {
  readonly fieldErrors: Record<string, string[]>;
  constructor(message: string, fieldErrors: Record<string, string[]> = {}) {
    super(message);
    this.name = 'ApiError';
    this.fieldErrors = fieldErrors;
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

interface AuthState {
  token: string;
  user: AuthUser;
}

function authHeaders(): Record<string, string> {
  const auth = getStoredAuth();
  const base: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth?.token) base['Authorization'] = `Bearer ${auth.token}`;
  return base;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: authHeaders(),
  });

  if (res.status === 401) {
    clearAuth();
    window.location.reload();
    throw new Error('Session expired');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null) as {
      error?: { message?: string; details?: { fieldErrors?: Record<string, string[]> } };
    } | null;
    const fieldErrors = body?.error?.details?.fieldErrors ?? {};
    throw new ApiError(body?.error?.message ?? `HTTP ${res.status}`, fieldErrors);
  }

  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

export const api = {
  auth: {
    login: (email: string, password: string) =>
      request<{ token: string; user: AuthUser }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
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
  },

  tables: {
    floor: (date: string, time: string) =>
      request<FloorTable[]>(`/tables/floor?date=${date}&time=${encodeURIComponent(time)}`),
    suggestions: (date: string, time: string) =>
      request<FloorSuggestion[]>(`/tables/floor-suggestions?date=${date}&time=${encodeURIComponent(time)}`),
    insights: (date: string, time: string) =>
      request<FloorInsight[]>(`/tables/insights?date=${date}&time=${encodeURIComponent(time)}`),
    list: () => request<Table[]>('/tables'),
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
      request<Reservation>(`/reservations/${id}/confirm`, { method: 'POST' }),
    seat: (id: string, tableId: string, overrideConflicts = false) =>
      request<Reservation>(`/reservations/${id}/seat`, {
        method: 'POST',
        body: JSON.stringify({ tableId, overrideConflicts }),
      }),
    move: (id: string, tableId: string, reason?: string) =>
      request<Reservation>(`/reservations/${id}/move`, {
        method: 'POST',
        body: JSON.stringify({ tableId, reason: reason || undefined, overrideConflicts: false }),
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
      guestNotes: string;
      hostNotes: string;
      duration: number;
    }>) =>
      request<Reservation>(`/reservations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    undo: (id: string) =>
      request<Reservation>(`/reservations/${id}/undo`, { method: 'POST' }),
    sendConfirmation: (id: string) =>
      request<Reservation>(`/reservations/${id}/send-confirmation`, { method: 'POST' }),
    markConfirmedByGuest: (id: string) =>
      request<Reservation>(`/reservations/${id}/mark-confirmed`, { method: 'POST' }),
    sendBulkConfirmations: (body: { date: string; timeFrom?: string; timeTo?: string }) =>
      request<{ sent: number; failed: string[]; total: number }>('/reservations/send-confirmations', {
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
  },

  waitlist: {
    list: (date: string, time?: string) =>
      request<WaitlistEntry[]>(`/waitlist?date=${date}${time ? `&time=${encodeURIComponent(time)}` : ''}`),
    add: (body: { guestName: string; partySize: number; guestPhone?: string; date: string; notes?: string }) =>
      request<WaitlistEntry>('/waitlist', { method: 'POST', body: JSON.stringify(body) }),
    seat: (id: string, tableId?: string) =>
      request<{ entry: WaitlistEntry; reservation: Reservation }>(`/waitlist/${id}/seat`, {
        method: 'POST',
        body: JSON.stringify({ tableId }),
      }),
    notify: (id: string) =>
      request<WaitlistEntry>(`/waitlist/${id}/notify`, { method: 'POST' }),
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
  },
};
