import type { ZoneType, TableShape } from '@prisma/client';

export interface TableWithZone {
  id: string;
  restaurantId: string;
  zoneId: string;
  zoneType: ZoneType;
  tableNumber: string;
  shape: TableShape;
  minCapacity: number;
  idealCapacity: number;
  maxCapacity: number;
  isCombinable: boolean;
  combineGroup: string | null;
  posX: number | null;
  posY: number | null;
  isActive: boolean;
}

export interface TableCombinationCandidate {
  tables: TableWithZone[];
  combinedMinCapacity: number;
  combinedMaxCapacity: number;
  adjacencyScore: number; // 0–1
  isSameCombineGroup: boolean;
}
