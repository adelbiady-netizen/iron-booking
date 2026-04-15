import type { WaitlistStatus, ServicePeriod, ZoneType } from '@prisma/client';

export interface WaitlistEntryView {
  id: string;
  guestName: string;
  guestPhone?: string;
  guestCount: number;
  requestedDate: string; // "YYYY-MM-DD"
  preferredPeriod?: ServicePeriod;
  preferredZone?: ZoneType;
  status: WaitlistStatus;
  position: number;
  estimatedWaitMin?: number;
  notifiedAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
}

export interface AddToWaitlistInput {
  restaurantId: string;
  customerId?: string;
  guestName: string;
  guestPhone?: string;
  guestCount: number;
  requestedDate: string; // "YYYY-MM-DD" in restaurant local time
  preferredPeriod?: ServicePeriod;
  preferredZone?: ZoneType;
}

export interface WaitTimeEstimate {
  estimatedMin: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  partiesAhead: number;
  avgTurnMin: number;
  cancellationRate: number;
}
