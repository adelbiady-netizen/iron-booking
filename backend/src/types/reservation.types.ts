export type ReservationStatus =
  | "PENDING"
  | "CONFIRMED"
  | "SEATED"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW";

export type ReservationSource =
  | "HOST"
  | "PHONE"
  | "ONLINE"
  | "WALK_IN";

export type ServicePeriod =
  | "BREAKFAST"
  | "BRUNCH"
  | "LUNCH"
  | "DINNER"
  | "LATE_NIGHT";

export type ZoneType = string;

export interface ReservationItem {
  id: string;
  restaurantId: string;
  tableId?: string | null;
  guestName: string;
  guestPhone?: string | null;
  guestEmail?: string | null;
  guestCount: number;
  startTime: string;
  endTime: string;
  durationMin: number;
  servicePeriod?: ServicePeriod | null;
  status: ReservationStatus;
  source?: ReservationSource | null;
  zoneType?: ZoneType | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateReservationInput {
  restaurantId: string;
  guestName: string;
  guestPhone?: string;
  guestEmail?: string;
  guestCount: number;
  startTime: string;
  durationMin: number;
  servicePeriod?: ServicePeriod;
  source?: ReservationSource;
  zoneType?: ZoneType;
  notes?: string;
}

export interface UpdateReservationInput {
  guestName?: string;
  guestPhone?: string;
  guestEmail?: string;
  guestCount?: number;
  startTime?: string;
  durationMin?: number;
  servicePeriod?: ServicePeriod;
  status?: ReservationStatus;
  source?: ReservationSource;
  zoneType?: ZoneType;
  notes?: string;
}