export interface TimeSlot {
    start: Date;
    end: Date;
}
export interface TableAvailability {
    tableId: string;
    isAvailable: boolean;
    conflictingReservationId?: string;
    blockedBy?: string;
    nextAvailableAt?: Date;
}
/**
 * Given a date, time string ("HH:mm"), and duration (minutes),
 * compute which tables are available for that slot.
 */
export declare function getTableAvailability(restaurantId: string, date: Date, timeStr: string, durationMinutes: number, bufferMinutes: number): Promise<TableAvailability[]>;
/**
 * Get all available slots for a given party size across a full day.
 * Used for online booking widget.
 */
export declare function getAvailableSlots(restaurantId: string, date: Date, partySize: number, intervalMinutes: number, openTime: string, lastSeating: string, durationMinutes: number, bufferMinutes: number): Promise<string[]>;
export declare function parseTimeOnDate(date: Date, timeStr: string): Date;
export declare function formatTime(date: Date): string;
export declare function minutesBetween(a: Date, b: Date): number;
//# sourceMappingURL=availability.d.ts.map