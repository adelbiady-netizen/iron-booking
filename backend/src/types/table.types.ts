export type TableShape = string;
export type ZoneType = string;

export interface TableItem {
  id: string;
  restaurantId: string;
  name: string;
  capacity: number;
  minCapacity?: number | null;
  maxCapacity?: number | null;
  shape?: TableShape | null;
  zoneType?: ZoneType | null;
  posX?: number | null;
  posY?: number | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateTableInput {
  restaurantId: string;
  name: string;
  capacity: number;
  minCapacity?: number;
  maxCapacity?: number;
  shape?: TableShape;
  zoneType?: ZoneType;
  posX?: number;
  posY?: number;
  isActive?: boolean;
}

export interface UpdateTableInput {
  name?: string;
  capacity?: number;
  minCapacity?: number;
  maxCapacity?: number;
  shape?: TableShape;
  zoneType?: ZoneType;
  posX?: number;
  posY?: number;
  isActive?: boolean;
}