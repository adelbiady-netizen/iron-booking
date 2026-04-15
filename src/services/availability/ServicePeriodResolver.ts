/**
 * Resolves which service periods are active for a given local date,
 * accounting for SpecialDay overrides (closures, holiday hours).
 */

import type { Restaurant, ServicePeriodConfig, SpecialDay } from '@prisma/client';
import type { ServicePeriod } from '@prisma/client';
import { localTimeToUTC, parseTimeStr, addMinutes } from '../../utils/datetime';

export interface ResolvedPeriod {
  period: ServicePeriod;
  openTimeUTC: Date;
  closeTimeUTC: Date;
  lastSeatingUTC: Date;
  durationMin: number;
  slotIntervalMin: number;
}

export class ServicePeriodResolver {
  /**
   * Returns active service periods for a given local date string ("YYYY-MM-DD").
   * Returns an empty array if the restaurant is closed on that date.
   */
  static resolve(
    localDate: string,
    restaurant: Restaurant,
    configs: ServicePeriodConfig[],
    specialDay: SpecialDay | null,
  ): ResolvedPeriod[] {
    // Hard closed — SpecialDay overrides everything
    if (specialDay?.isClosed) return [];

    // Calculate day of week in restaurant's timezone
    // localDate is "YYYY-MM-DD" so we can compute it directly
    const [year, month, day] = localDate.split('-').map(Number);
    const jsDate = new Date(Date.UTC(year, month - 1, day, 12)); // noon UTC avoids DST edge
    const localDow = this.getLocalDayOfWeek(jsDate, restaurant.timezone);

    const activeConfigs = configs.filter(
      (c) => c.isActive && c.dayOfWeek === localDow,
    );

    return activeConfigs.map((config) => {
      // SpecialDay can override open/close times for the whole day
      const openStr = specialDay?.openTime ?? config.openTime;
      const closeStr = specialDay?.closeTime ?? config.closeTime;

      const openTimeUTC = localTimeToUTC(localDate, openStr, restaurant.timezone);
      const closeTimeUTC = localTimeToUTC(localDate, closeStr, restaurant.timezone);

      // Last seating = explicit config or derived from restaurant policy
      let lastSeatingUTC: Date;
      if (config.lastSeatingTime) {
        lastSeatingUTC = localTimeToUTC(localDate, config.lastSeatingTime, restaurant.timezone);
      } else {
        const durationMin = config.defaultDuration ?? restaurant.defaultDuration;
        lastSeatingUTC = addMinutes(closeTimeUTC, -(restaurant.lastSeatingMin + durationMin));
      }

      return {
        period: config.period,
        openTimeUTC,
        closeTimeUTC,
        lastSeatingUTC,
        durationMin: config.defaultDuration ?? restaurant.defaultDuration,
        slotIntervalMin: config.slotIntervalMin ?? restaurant.slotIntervalMin,
      };
    });
  }

  /**
   * Find the single service period that contains a given UTC datetime.
   * Returns null if the time falls outside all service windows.
   */
  static findPeriodForTime(
    utcTime: Date,
    localDate: string,
    restaurant: Restaurant,
    configs: ServicePeriodConfig[],
    specialDay: SpecialDay | null,
  ): ResolvedPeriod | null {
    const periods = this.resolve(localDate, restaurant, configs, specialDay);
    return (
      periods.find((p) => utcTime >= p.openTimeUTC && utcTime <= p.closeTimeUTC) ?? null
    );
  }

  private static getLocalDayOfWeek(utcDate: Date, timezone: string): number {
    // Get the local day of week using Intl (no Luxon dependency in this module)
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
    });
    const dayStr = formatter.format(utcDate);
    const dayMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    return dayMap[dayStr] ?? 0;
  }
}
