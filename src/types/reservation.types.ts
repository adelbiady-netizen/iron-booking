import type { ReservationStatus, ReservationSource, ServicePeriod, ZoneType } from '@prisma/client';

export interface TimeRange {
  start: Date; // UTC
  end: Date;   // UTC
}

export interface AssignedTable {
  tableId: string;
  tableNumber: string;
  zoneType: ZoneType;
  minCapacity: number;
  idealCapacity: number;
  maxCapacity: number;
  isPrimary: boolean;
}

export interface ScoreBreakdown {
  fitScore: number;
  zoneScore: number;
  vipScore: number;
  comboScore: number;
  utilizationScore: number;
  preferredBonus: number;
  total: number;
}

export interface TableAssignment {
  tables: AssignedTable[];
  totalCapacity: number;
  isCombination: boolean;
  score: number;
  scoreBreakdown: ScoreBreakdown;
}

export interface SlotOption {
  startTime: Date;           // UTC
  endTime: Date;             // UTC
  durationMin: number;
  localStartTime: string;    // "HH:MM" in restaurant timezone — for display
  assignment: TableAssignment;
  alternativeAssignments: TableAssignment[];
}

export interface PeriodAvailability {
  period: ServicePeriod;
  openTime: string;         // "HH:MM" local
  closeTime: string;        // "HH:MM" local
  lastSeatingTime: string;  // "HH:MM" local
  slots: SlotOption[];
}

export interface AvailabilityResponse {
  date: string;               // "YYYY-MM-DD"
  restaurantTimezone: string;
  servicePeriods: PeriodAvailability[];
}

export interface AvailabilityQuery {
  restaurantId: string;
  guestCount: number;
  date: string;               // "YYYY-MM-DD" in restaurant local time
  preferredPeriod?: ServicePeriod;
  preferredZone?: ZoneType;
  durationMin?: number;
}

export interface CreateReservationInput {
  restaurantId: string;
  customerId?: string;

  // Guest info (required even if customerId is set — for fast display)
  guestName: string;
  guestPhone?: string;
  guestEmail?: string;
  guestCount: number;

  // Time
  requestedStartTime: Date; // UTC — caller converts from local wall-clock before calling
  durationMin?: number;     // if omitted, uses service period or restaurant default

  // Preferences
  preferredZone?: ZoneType;
  preferredTableId?: string;

  // Notes
  guestNotes?: string;
  staffNotes?: string;

  source?: ReservationSource;
  createdById?: string; // staffId
}

export interface UpdateReservationInput {
  guestName?: string;
  guestPhone?: string;
  guestEmail?: string;
  guestCount?: number;
  requestedStartTime?: Date;
  durationMin?: number;
  preferredZone?: ZoneType;
  guestNotes?: string;
  staffNotes?: string;
  status?: ReservationStatus;
}

export interface ReservationView {
  id: string;
  confirmationCode: string;
  restaurantId: string;
  customerId?: string;
  guestName: string;
  guestPhone?: string;
  guestEmail?: string;
  guestCount: number;
  startTime: Date;
  endTime: Date;
  durationMin: number;
  servicePeriod: ServicePeriod;
  status: ReservationStatus;
  source: ReservationSource;
  tables: AssignedTable[];
  isVIP: boolean;
  guestNotes?: string;
  staffNotes?: string;
  seatedAt?: Date;
  departedAt?: Date;
  createdAt: Date;
}
