import type { BackendTableSuggestion, ScoredReason, Table, TablePickerStatus } from '../types';
import { useT } from '../i18n/useT';

// ── Status badge style map ────────────────────────────────────────────────────

const BADGE_CLS: Record<TablePickerStatus, string> = {
  recommended: 'bg-iron-green/20 border-iron-green/40 text-iron-green-light',
  possible:    'bg-blue-500/15 border-blue-500/30 text-blue-400',
  tight:       'bg-amber-500/15 border-amber-500/30 text-amber-400',
  blocked:     'bg-red-900/15 border-red-900/25 text-red-400',
};

const BORDER_CLS: Record<TablePickerStatus, string> = {
  recommended: 'border-iron-green/30 hover:border-iron-green/60 hover:bg-iron-green/[0.10]',
  possible:    'border-blue-500/25 hover:border-blue-500/50 hover:bg-blue-500/[0.06]',
  tight:       'border-amber-500/25 hover:border-amber-500/40 hover:bg-amber-500/[0.06]',
  blocked:     'border-iron-border/30 opacity-50 cursor-not-allowed',
};

const REASON_CLS: Record<TablePickerStatus, string> = {
  recommended: 'text-iron-muted',
  possible:    'text-blue-400/80',
  tight:       'text-amber-400',
  blocked:     'text-red-400',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveReason(r: ScoredReason, reasonText: (r: ScoredReason) => string): string {
  return reasonText(r);
}

interface CellProps {
  suggestion: BackendTableSuggestion;
  selected: boolean;
  multiMode: boolean;
  onPick: (id: string) => void;
  walkInMode?: boolean;
}

function SuggestionCell({ suggestion, selected, multiMode, onPick, walkInMode }: CellProps) {
  const T = useT();
  const { tableId, tableName, minCovers, maxCovers, status, reasons } = suggestion;
  if (!tableId) return null;

  const isTooSmall    = reasons.some(r => r.code === 'TOO_SMALL');
  const isTableBlocked = reasons.some(r => r.code === 'TABLE_BLOCKED');
  // In walk-in mode, time-based CONFLICT is overridable — only TABLE_BLOCKED is hard.
  const isDisabled = walkInMode
    ? isTableBlocked
    : reasons.some(r => r.code === 'CONFLICT' || r.code === 'TABLE_BLOCKED');

  // TOO_SMALL → amber advisory. Walk-in CONFLICT → amber overridable hint.
  const isWalkInConflict = walkInMode && reasons.some(r => r.code === 'CONFLICT') && !isTableBlocked;
  const displayStatus: TablePickerStatus =
    (isTooSmall || isWalkInConflict) && !selected ? 'tight' : status;

  const primaryReason = reasons[0] ? resolveReason(reasons[0], T.tablePicker.reasonText) : '';

  return (
    <button
      type="button"
      disabled={isDisabled}
      onClick={() => !isDisabled && onPick(tableId)}
      className={`text-xs py-2 px-1.5 rounded-lg border transition-all text-center ${
        selected
          ? 'bg-iron-green/25 border-iron-green/60 text-iron-green-light ring-1 ring-iron-green/25'
          : BORDER_CLS[displayStatus]
      }`}
    >
      <div className="font-bold text-iron-text text-[11px] truncate">{tableName}</div>
      <div className="text-iron-muted text-[10px] mt-px">{minCovers}–{maxCovers}</div>
      {selected && multiMode ? (
        <div className="text-[10px] mt-0.5 font-bold text-iron-green-light">✓</div>
      ) : !selected ? (
        <>
          <span className={`inline-block mt-1 text-[8px] font-bold px-1 py-px rounded border ${BADGE_CLS[displayStatus]}`}>
            {T.tablePicker.statusBadge[displayStatus]}
          </span>
          {primaryReason && !isTooSmall && (
            <div className={`text-[9px] mt-0.5 leading-tight ${REASON_CLS[displayStatus]}`}>
              {primaryReason}
            </div>
          )}
        </>
      ) : null}
    </button>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

interface Props {
  tables: Table[];
  suggestions: BackendTableSuggestion[];
  suggestBusy: boolean;
  // Single-select mode (existing — used by GuestDrawer and single-pick flows)
  selectedId?: string | null | '';
  onPick?: (id: string) => void;
  // Multi-select mode (used by CreateDrawer override picker)
  // When both selectedIds and onMultiPick are provided, multi mode is active.
  selectedIds?: string[];
  onMultiPick?: (ids: string[]) => void;
  noTableLabel?: string;
  showNoTable?: boolean;
  walkInMode?: boolean;
}

/**
 * Unified smart table picker grid.
 *
 * Single-select mode (default): pass selectedId + onPick. Clicking a table
 * immediately calls onPick with that table's ID.
 *
 * Multi-select mode: pass selectedIds + onMultiPick. Clicking a non-blocked
 * table toggles it in the selection set and calls onMultiPick with the new
 * full array. Blocked tables are always disabled.
 *
 * When suggestions are loaded, all tables are shown sorted by status
 * (recommended → possible → tight → blocked). Blocked tables are visible
 * but disabled (never selectable in either mode).
 */
export default function SmartTablePicker({
  tables, suggestions, suggestBusy,
  selectedId, onPick,
  selectedIds, onMultiPick,
  noTableLabel, showNoTable = false,
  walkInMode = false,
}: Props) {
  const T = useT();

  const multiMode = !!(selectedIds && onMultiPick);

  function handleCellPick(id: string) {
    if (multiMode) {
      const next = selectedIds!.includes(id)
        ? selectedIds!.filter(x => x !== id)
        : [...selectedIds!, id];
      onMultiPick!(next);
    } else {
      onPick?.(id);
    }
  }

  function isCellSelected(id: string): boolean {
    return multiMode ? selectedIds!.includes(id) : selectedId === id;
  }

  if (suggestBusy) {
    return (
      <div className="flex items-center gap-2 py-2 text-iron-muted">
        <div className="w-3 h-3 border-2 border-iron-green border-t-transparent rounded-full animate-spin shrink-0" />
        <span className="text-xs">{T.common.processing}</span>
      </div>
    );
  }

  // Smart mode: suggestions loaded
  if (suggestions.length > 0) {
    const single = suggestions.filter(s => s.tableId);
    return (
      <div className="grid grid-cols-3 gap-1.5 max-h-52 overflow-y-auto pr-1">
        {showNoTable && !multiMode && (
          <button
            type="button"
            onClick={() => onPick?.('')}
            className={`text-xs py-2 px-1.5 rounded-lg border transition-all text-center ${
              selectedId === '' || selectedId === null
                ? 'border-iron-green bg-iron-green/15 text-iron-green-light'
                : 'border-iron-border/60 text-iron-muted hover:border-iron-green hover:text-iron-text'
            }`}
          >
            <div className="font-medium">{noTableLabel ?? T.common.none}</div>
          </button>
        )}
        {single.map(s => (
          <SuggestionCell
            key={s.tableId}
            suggestion={s}
            selected={isCellSelected(s.tableId!)}
            multiMode={multiMode}
            onPick={handleCellPick}
            walkInMode={walkInMode}
          />
        ))}
      </div>
    );
  }

  // Fallback: plain grid (no suggestions yet)
  const active = tables.filter(t => t.isActive);
  return (
    <div className="grid grid-cols-3 gap-1.5 max-h-52 overflow-y-auto pr-1">
      {showNoTable && !multiMode && (
        <button
          type="button"
          onClick={() => onPick?.('')}
          className={`text-xs p-2 rounded-lg border transition-colors text-center ${
            selectedId === '' || selectedId === null
              ? 'border-iron-green bg-iron-green/15 text-iron-green-light'
              : 'border-iron-border text-iron-muted hover:border-iron-green hover:text-iron-text'
          }`}
        >
          <div className="font-medium">{noTableLabel ?? T.common.none}</div>
        </button>
      )}
      {active.map(t => (
        <button
          key={t.id}
          type="button"
          onClick={() => handleCellPick(t.id)}
          className={`text-xs p-2 rounded-lg border transition-colors text-center ${
            isCellSelected(t.id)
              ? 'bg-iron-green/25 border-iron-green/60 text-iron-green-light ring-1 ring-iron-green/25'
              : 'border-iron-border/60 text-iron-text hover:border-iron-green'
          }`}
        >
          <div className="font-semibold">{t.name}</div>
          <div className="text-[10px] text-iron-muted">{t.minCovers}–{t.maxCovers}</div>
          {multiMode && isCellSelected(t.id) && (
            <div className="text-[10px] mt-0.5 font-bold text-iron-green-light">✓</div>
          )}
        </button>
      ))}
    </div>
  );
}
