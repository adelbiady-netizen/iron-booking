export interface TableSuggestion {
    type: 'single' | 'combination';
    tableId?: string;
    combinationId?: string;
    tableName: string;
    sectionName: string;
    minCovers: number;
    maxCovers: number;
    score: number;
    reasons: string[];
    warnings: string[];
}
interface MatchContext {
    restaurantId: string;
    date: Date;
    time: string;
    partySize: number;
    durationMinutes: number;
    bufferMinutes: number;
    occasion?: string;
    preferenceNotes?: string;
    guestIsVip?: boolean;
}
/**
 * Returns ranked table suggestions for a given reservation context.
 * Scoring factors:
 *   - Capacity fit (prefer tables closest to party size without excess)
 *   - Availability (no conflicts)
 *   - VIP preference (better positioned tables score higher for VIPs)
 *   - Occasion bonuses (booths for birthdays, window seats for anniversaries)
 *   - Turn utilization (prefer tables that won't leave awkward gaps)
 */
export declare function suggestTables(ctx: MatchContext): Promise<TableSuggestion[]>;
export {};
//# sourceMappingURL=tableMatcher.d.ts.map