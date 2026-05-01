import { useState } from 'react';
import type { Reservation, Table } from '../types';
import { api } from '../api';
import { T } from '../strings';

type Mode = 'reservation' | 'walkin';

interface GapHint {
  tableId: string;
  tableName: string;
  startTime: string;
  endTime: string;
  durationMins: number;
  minCovers: number;
  maxCovers: number;
}

interface Props {
  initialMode: Mode;
  defaultDate: string;
  defaultTime: string;
  tables: Table[];
  preselectedTableId?: string;
  initialData?: { guestName?: string; partySize?: number; guestPhone?: string };
  gapHint?: GapHint;
  onClose: () => void;
  onCreated: (r: Reservation) => void;
}

// ─── Shared field components ──────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-iron-muted text-[10px] font-semibold uppercase tracking-widest mb-1">
      {children}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full bg-iron-bg border border-iron-border rounded-lg px-3 py-2 text-iron-text text-sm placeholder-iron-muted focus:outline-none focus:border-iron-green transition-colors ${props.className ?? ''}`}
    />
  );
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={2}
      {...props}
      className={`w-full bg-iron-bg border border-iron-border rounded-lg px-3 py-2 text-iron-text text-sm placeholder-iron-muted focus:outline-none focus:border-iron-green transition-colors resize-none ${props.className ?? ''}`}
    />
  );
}

// ─── Table picker grid ────────────────────────────────────────────────────────

interface TablePickerProps {
  tables: Table[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}

function TableGrid({ tables, value, onChange, label }: TablePickerProps) {
  const active = tables.filter(t => t.isActive);
  return (
    <div>
      <Label>{label}</Label>
      <div className="grid grid-cols-4 gap-1.5 max-h-36 overflow-y-auto pr-0.5">
        <button
          type="button"
          onClick={() => onChange('')}
          className={`text-xs p-2 rounded-lg border transition-colors text-center ${
            value === ''
              ? 'border-iron-green bg-iron-green/15 text-iron-green-light'
              : 'border-iron-border text-iron-muted hover:border-iron-green hover:text-iron-text'
          }`}
        >
          <div className="font-medium">{T.createDrawer.tableNone}</div>
        </button>
        {active.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={`text-xs p-2 rounded-lg border transition-colors text-center ${
              value === t.id
                ? 'border-iron-green bg-iron-green/15 text-iron-green-light'
                : 'border-iron-border text-iron-text hover:border-iron-green'
            }`}
          >
            <div className="font-semibold">{t.name}</div>
            <div className="text-[10px] text-iron-muted">{t.minCovers}–{t.maxCovers}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Time slot constants ──────────────────────────────────────────────────────

const TIME_SLOTS: string[] = Array.from({ length: 28 }, (_, i) => {
  const h = Math.floor(i / 2) + 10;
  const m = i % 2 === 0 ? '00' : '30';
  return `${String(h).padStart(2, '0')}:${m}`;
});

function snapToSlot(time: string): string {
  if (TIME_SLOTS.includes(time)) return time;
  const [hStr, mStr] = time.split(':');
  const total = parseInt(hStr, 10) * 60 + parseInt(mStr ?? '0', 10);
  return TIME_SLOTS.reduce((best, slot) => {
    const [sh, sm] = slot.split(':');
    const slotTotal = parseInt(sh, 10) * 60 + parseInt(sm, 10);
    const [bh, bm] = best.split(':');
    const bestTotal = parseInt(bh, 10) * 60 + parseInt(bm, 10);
    return Math.abs(total - slotTotal) < Math.abs(total - bestTotal) ? slot : best;
  }, TIME_SLOTS[0]);
}

// ─── Main drawer ──────────────────────────────────────────────────────────────

export default function CreateDrawer({
  initialMode, defaultDate, defaultTime, tables, preselectedTableId, initialData, gapHint, onClose, onCreated,
}: Props) {
  const [mode, setMode] = useState<Mode>(gapHint ? 'reservation' : (preselectedTableId || initialData) ? 'walkin' : initialMode);

  // Reservation fields — pre-filled from gapHint when present
  const [resName,      setResName]      = useState('');
  const [resPhone,     setResPhone]     = useState('');
  const [resParty,     setResParty]     = useState(2);
  const [resDate,      setResDate]      = useState(defaultDate);
  const [resTime,      setResTime]      = useState(snapToSlot(gapHint?.startTime ?? defaultTime));
  const [resDuration,  setResDuration]  = useState(gapHint ? String(gapHint.durationMins) : '');
  const [resGuestNote, setResGuestNote] = useState('');
  const [resHostNote,  setResHostNote]  = useState('');
  const [resSource,    setResSource]    = useState<'PHONE' | 'INTERNAL'>('PHONE');
  const [resTable,     setResTable]     = useState(gapHint?.tableId ?? '');

  // Walk-in fields
  const [wiName,  setWiName]  = useState(initialData?.guestName  ?? '');
  const [wiParty, setWiParty] = useState(initialData?.partySize  ?? 2);
  const [wiNotes, setWiNotes] = useState('');
  const [wiTable, setWiTable] = useState(preselectedTableId ?? '');

  const [error, setError] = useState<string | null>(null);
  const [busy,  setBusy]  = useState(false);

  function nowStr() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  async function submitReservation(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      let r = await api.reservations.create({
        guestName:  resName.trim(),
        guestPhone: resPhone.trim() || undefined,
        partySize:  resParty,
        date:       resDate,
        time:       resTime,
        duration:   resDuration ? parseInt(resDuration, 10) : undefined,
        guestNotes: resGuestNote.trim() || undefined,
        hostNotes:  resHostNote.trim() || undefined,
        tableId:    resTable || undefined,
        source:     resSource,
      });
      // Auto-confirm so the host doesn't need an extra click
      if (r.status === 'PENDING') {
        r = await api.reservations.confirm(r.id);
      }
      onCreated(r);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create reservation');
    } finally {
      setBusy(false);
    }
  }

  async function submitWalkIn(seatNow: boolean) {
    setError(null);
    setBusy(true);
    try {
      let r = await api.reservations.create({
        guestName: wiName.trim() || 'Walk-in Guest',
        partySize: wiParty,
        date:      todayStr(),
        time:      nowStr(),
        guestNotes: wiNotes.trim() || undefined,
        source:    'WALK_IN',
      });

      if (seatNow && wiTable) {
        // seat() auto-confirms and assigns the table
        r = await api.reservations.seat(r.id, wiTable);
      } else if (r.status === 'PENDING') {
        r = await api.reservations.confirm(r.id);
      }

      onCreated(r);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create walk-in');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />

      {/* Drawer */}
      <aside className="fixed right-0 top-0 h-full w-[420px] bg-iron-card border-l border-iron-border z-50 flex flex-col shadow-2xl">

        {/* Header */}
        <div className="p-4 border-b border-iron-border shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-iron-text font-semibold text-base">
              {mode === 'reservation' ? T.createDrawer.titleReservation : T.createDrawer.titleWalkIn}
            </h2>
            <button
              onClick={onClose}
              className="text-iron-muted hover:text-iron-text text-2xl leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {/* Mode tabs */}
          <div className="flex gap-1 bg-iron-bg rounded-lg p-1">
            <button
              type="button"
              onClick={() => { setMode('reservation'); setError(null); }}
              className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors ${
                mode === 'reservation'
                  ? 'bg-iron-green text-white'
                  : 'text-iron-muted hover:text-iron-text'
              }`}
            >
              {T.createDrawer.tabReservation}
            </button>
            <button
              type="button"
              onClick={() => { setMode('walkin'); setError(null); }}
              className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors ${
                mode === 'walkin'
                  ? 'bg-iron-green text-white'
                  : 'text-iron-muted hover:text-iron-text'
              }`}
            >
              {T.createDrawer.tabWalkIn}
            </button>
          </div>
        </div>

        {/* ── Reservation form ── */}
        {mode === 'reservation' && (
          <form onSubmit={submitReservation} className="flex-1 overflow-y-auto p-4 space-y-4">

            {/* Gap suggestion banner */}
            {gapHint && (
              <div className="flex items-start gap-2.5 bg-indigo-950/40 border border-indigo-500/30 rounded-lg px-3 py-2.5">
                <span className="text-indigo-400 mt-0.5 shrink-0" style={{ fontSize: 13 }}>◈</span>
                <div className="min-w-0">
                  <p className="text-indigo-300 text-xs font-semibold">
                    Available slot: {gapHint.startTime}–{gapHint.endTime}
                  </p>
                  <p className="text-indigo-400/70 text-[10px] mt-0.5">
                    {gapHint.tableName} · seats {gapHint.minCovers}–{gapHint.maxCovers} · {gapHint.durationMins}m window
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>{T.createDrawer.fieldGuestName}</Label>
                <Input
                  type="text"
                  value={resName}
                  onChange={e => setResName(e.target.value)}
                  placeholder={T.createDrawer.placeholderName}
                  required
                  autoFocus
                />
              </div>

              <div>
                <Label>{T.createDrawer.fieldPhone}</Label>
                <Input
                  type="tel"
                  value={resPhone}
                  onChange={e => setResPhone(e.target.value)}
                  placeholder={T.createDrawer.placeholderPhone}
                />
              </div>

              <div>
                <Label>{T.createDrawer.fieldPartySize}</Label>
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={resParty}
                  onChange={e => setResParty(parseInt(e.target.value, 10) || 1)}
                  required
                />
                {gapHint && (
                  <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                    {Array.from(
                      { length: Math.min(gapHint.maxCovers, 20) - gapHint.minCovers + 1 },
                      (_, i) => gapHint.minCovers + i,
                    ).map(n => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setResParty(n)}
                        className={`text-[10px] w-6 h-6 rounded border font-semibold transition-colors ${
                          resParty === n
                            ? 'bg-indigo-500/25 border-indigo-400/60 text-indigo-300'
                            : 'border-iron-border text-iron-muted hover:border-indigo-400/50 hover:text-indigo-300'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                    <span className="text-[10px] text-iron-muted/60 ml-0.5">fits {gapHint.minCovers}–{gapHint.maxCovers}</span>
                  </div>
                )}
              </div>

              <div>
                <Label>{T.createDrawer.fieldDate}</Label>
                <Input
                  type="date"
                  value={resDate}
                  onChange={e => setResDate(e.target.value)}
                  required
                />
              </div>

              <div>
                <Label>{T.createDrawer.fieldTime}</Label>
                <select
                  value={resTime}
                  onChange={e => setResTime(e.target.value)}
                  required
                  className="w-full bg-iron-bg border border-iron-border rounded-lg px-3 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green transition-colors"
                >
                  {TIME_SLOTS.map(slot => (
                    <option key={slot} value={slot}>{slot}</option>
                  ))}
                </select>
              </div>

              <div>
                <Label>{T.createDrawer.fieldDuration}</Label>
                <Input
                  type="number"
                  min={30}
                  max={480}
                  step={15}
                  value={resDuration}
                  onChange={e => setResDuration(e.target.value)}
                  placeholder={T.createDrawer.placeholderDuration}
                />
              </div>

              <div>
                <Label>{T.createDrawer.fieldSource}</Label>
                <div className="flex gap-1 mt-0.5">
                  {(['PHONE', 'INTERNAL'] as const).map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setResSource(s)}
                      className={`flex-1 text-xs py-2 rounded-lg border font-medium transition-colors ${
                        resSource === s
                          ? 'bg-iron-green/20 border-iron-green/50 text-iron-green-light'
                          : 'border-iron-border text-iron-muted hover:text-iron-text'
                      }`}
                    >
                      {s === 'PHONE' ? T.createDrawer.sourcePhone : T.createDrawer.sourceInternal}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <Label>{T.createDrawer.fieldGuestNotes}</Label>
              <TextArea
                value={resGuestNote}
                onChange={e => setResGuestNote(e.target.value)}
                placeholder={T.createDrawer.placeholderGuestNotes}
              />
            </div>

            <div>
              <Label>{T.createDrawer.fieldHostNotes}</Label>
              <TextArea
                value={resHostNote}
                onChange={e => setResHostNote(e.target.value)}
                placeholder={T.createDrawer.placeholderHostNotes}
              />
            </div>

            <TableGrid
              tables={tables}
              value={resTable}
              onChange={setResTable}
              label={T.createDrawer.fieldTable}
            />

            {error && (
              <p className="text-red-400 text-xs bg-red-900/10 border border-red-900/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full bg-iron-green hover:bg-iron-green-light disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
            >
              {busy ? T.createDrawer.submitCreateBusy : T.createDrawer.submitCreate}
            </button>
          </form>
        )}

        {/* ── Walk-in form ── */}
        {mode === 'walkin' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>{T.createDrawer.fieldWalkInName}</Label>
                <Input
                  type="text"
                  value={wiName}
                  onChange={e => setWiName(e.target.value)}
                  placeholder={T.createDrawer.placeholderWalkInName}
                  autoFocus
                />
              </div>

              <div className="col-span-2">
                <Label>{T.createDrawer.fieldWalkInParty}</Label>
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={wiParty}
                  onChange={e => setWiParty(parseInt(e.target.value, 10) || 1)}
                />
              </div>
            </div>

            <div>
              <Label>{T.createDrawer.fieldWalkInNotes}</Label>
              <TextArea
                value={wiNotes}
                onChange={e => setWiNotes(e.target.value)}
                placeholder={T.createDrawer.placeholderWalkInNotes}
              />
            </div>

            <TableGrid
              tables={tables}
              value={wiTable}
              onChange={setWiTable}
              label={T.createDrawer.fieldWalkInTable}
            />

            {/* Walk-in tip */}
            <p className="text-iron-muted text-xs border border-iron-border rounded-lg px-3 py-2">
              {wiTable
                ? T.createDrawer.walkInTableSelected(tables.find(t => t.id === wiTable)?.name ?? '')
                : T.createDrawer.walkInNoTable}
            </p>

            {error && (
              <p className="text-red-400 text-xs bg-red-900/10 border border-red-900/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <div className="space-y-2">
              {wiTable ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => submitWalkIn(true)}
                  className="w-full bg-iron-green hover:bg-iron-green-light disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
                >
                  {busy ? T.createDrawer.submitSeatNowBusy : T.createDrawer.submitSeatNow}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => submitWalkIn(false)}
                  className="w-full bg-iron-green hover:bg-iron-green-light disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
                >
                  {busy ? T.createDrawer.submitAddToListBusy : T.createDrawer.submitAddToList}
                </button>
              )}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
