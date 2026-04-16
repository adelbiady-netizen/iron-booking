export type ZoneType = string;

export interface DashboardSummary {
  totalReservations: number;
  seatedReservations: number;
  pendingReservations: number;
  completedReservations: number;
  cancelledReservations: number;
  noShowReservations: number;
  walkIns: number;
  occupancyRate?: number;
}

export interface DashboardTableStatus {
  id: string;
  name: string;
  capacity: number;
  zoneType?: ZoneType | null;
  status: "AVAILABLE" | "OCCUPIED_NOW" | "RESERVED_SOON" | "INACTIVE";
  activeReservation?: {
    id: string;
    guestName: string;
    guestCount: number;
    startTime: string;
    endTime: string;
    status: string;
  } | null;
  upcomingReservation?: {
    id: string;
    guestName: string;
    guestCount: number;
    startTime: string;
    endTime: string;
    status: string;
  } | null;
}

export interface DashboardResponse {
  summary: DashboardSummary;
  tables: DashboardTableStatus[];
}