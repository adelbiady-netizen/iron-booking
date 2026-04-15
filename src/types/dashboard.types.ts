import type { ZoneType, ReservationStatus } from '@prisma/client';

export type TableStatusType =
  | 'AVAILABLE'
  | 'OCCUPIED'
  | 'RESERVED_SOON'  // reservation starts within RESERVED_SOON_MIN minutes
  | 'RESERVED_LATER' // reservation exists but not imminent
  | 'NEEDS_BUSSING'  // party departed, table not yet cleared
  | 'BLOCKED';       // manually blocked by staff

export interface OccupantInfo {
  type: 'reservation' | 'walkin';
  id: string;
  guestName: string;
  guestCount: number;
  seatedAt: Date;
  scheduledDepartureAt: Date;
  isOverTime: boolean;
  overtimeMin?: number;
}

export interface NextReservationInfo {
  reservationId: string;
  guestName: string;
  guestCount: number;
  startTime: Date;
  isVIP: boolean;
}

export interface TableStatus {
  tableId: string;
  tableNumber: string;
  zoneType: ZoneType;
  minCapacity: number;
  maxCapacity: number;
  status: TableStatusType;
  currentOccupant?: OccupantInfo;
  nextReservation?: NextReservationInfo;
  minutesUntilNextReservation?: number;
}

export interface ZoneStatus {
  zoneId: string;
  zoneName: string;
  zoneType: ZoneType;
  tables: TableStatus[];
}

export interface FloorSummary {
  totalTables: number;
  occupiedTables: number;
  availableTables: number;
  currentCovers: number;
  totalCapacity: number;
  occupancyPercent: number;
  waitlistCount: number;
  walkInWaitingCount: number;
}

export interface FloorStatus {
  restaurantId: string;
  asOf: Date;
  zones: ZoneStatus[];
  summary: FloorSummary;
}

export interface ReservationArrivalCard {
  reservationId: string;
  confirmationCode: string;
  guestName: string;
  guestCount: number;
  startTime: Date;
  minutesUntilArrival: number;
  status: ReservationStatus;
  assignedTables: string[]; // tableNumber list
  isVIP: boolean;
  guestNotes?: string;
}

export interface UpcomingView {
  lookaheadMin: number;
  asOf: Date;
  reservations: ReservationArrivalCard[];
}

export interface TimelineEvent {
  type: 'reservation' | 'walkin' | 'buffer' | 'blocked';
  id: string;
  startTime: Date;
  endTime: Date;
  guestName?: string;
  guestCount?: number;
  status?: ReservationStatus;
  isVIP?: boolean;
}

export interface TimelineRow {
  tableId: string;
  tableNumber: string;
  zoneType: ZoneType;
  events: TimelineEvent[];
}

export interface TimelineView {
  windowStart: Date;
  windowEnd: Date;
  rows: TimelineRow[];
}
