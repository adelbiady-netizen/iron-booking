import { createHash } from 'crypto';
import { LockTimeoutError } from '../../utils/errors';

export class LockManager {
  private static computeLockKey(
    restaurantId: string,
    slotStartUTC: Date,
    slotIntervalMin: number,
  ): number {
    const input = `${restaurantId}:${slotStartUTC.toISOString()}:${slotIntervalMin}`;
    const hex = createHash('sha256').update(input).digest('hex').slice(0, 15);
    return parseInt(hex, 16);
  }

  static async acquireBookingLock(
    tx: any,
    restaurantId: string,
    slotStartUTC: Date,
    slotIntervalMin: number,
  ): Promise<void> {
    const key = this.computeLockKey(restaurantId, slotStartUTC, slotIntervalMin);
    const timeoutMs = 3000;

    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${timeoutMs}ms'`);

    try {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${Number(key)})`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);

      if (
        msg.includes('canceling statement') ||
        msg.includes('statement timeout')
      ) {
        throw new LockTimeoutError();
      }

      throw err;
    } finally {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = DEFAULT`);
    }
  }
}