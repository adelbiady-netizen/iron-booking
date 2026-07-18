// Pure decision logic for auto-return-to-Live after system-driven timeline moves.
// Used by HostDashboard; unit-tested in liveRestore.test.ts.

export interface BoardPos {
  date: string;     // YYYY-MM-DD
  time: string;     // HH:MM (30-min snapped)
  liveMode: boolean;
}

// Snapshot rule: only the FIRST system-driven move of a workflow records where
// the host was. Subsequent system moves inside the same workflow keep the
// original snapshot so the final restore goes back to the true pre-workflow state.
export function takeSnapshot(existing: BoardPos | null, current: BoardPos): BoardPos {
  return existing ?? { ...current };
}

// Restore rule, evaluated when a workflow ends:
//   - no snapshot (host navigated manually mid-workflow, or nothing system-moved)
//     → null: leave the board alone.
//   - snapshot was Live → return to Live at the CURRENT real time (not the
//     stale snapshot time — live means "now").
//   - snapshot was a planning position → restore that exact position, still
//     out of Live, preserving the host's intentional browsing context.
export function resolveWorkflowReturn(
  snapshot: BoardPos | null,
  liveNow: { date: string; time: string },
): BoardPos | null {
  if (!snapshot) return null;
  if (snapshot.liveMode) return { date: liveNow.date, time: liveNow.time, liveMode: true };
  return { date: snapshot.date, time: snapshot.time, liveMode: false };
}
