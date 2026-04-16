export type WaitlistStatus =
  | "WAITING"
  | "CALLED"
  | "SEATED"
  | "CANCELLED"
  | "NO_SHOW";

export type ServicePeriod =
  | "BREAKFAST"
  | "BRUNCH"
  | "LUNCH"
  | "DINNER"
  | "LATE_NIGHT";

export type ZoneType = string;

export interface WaitlistEntry {
  id: string;
  restaurantId: string;
  guestName: string;
  guestPhone?: string | null;
  guestCount: number;
  quotedMinutes?: number | null;
  actualMinutes?: number | null;
  notes?: string | null;
  status: WaitlistStatus;
  servicePeriod?: ServicePeriod | null;
  zoneType?: ZoneType | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWaitlistInput {
  restaurantId: string;
  guestName: string;
  guestPhone?: string;
  guestCount: number;
  quotedMinutes?: number;
  notes?: string;
  servicePeriod?: ServicePeriod;
  zoneType?: ZoneType;
}

export interface UpdateWaitlistInput {
  guestName?: string;
  guestPhone?: string;
  guestCount?: number;
  quotedMinutes?: number;
  actualMinutes?: number;
  notes?: string;
  status?: WaitlistStatus;
  servicePeriod?: ServicePeriod;
  zoneType?: ZoneType;
}