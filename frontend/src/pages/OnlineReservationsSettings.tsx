import { useState, useEffect } from 'react';
import { api, ApiError } from '../api';
import { useT } from '../i18n/useT';

interface Props {
  onToast: (msg: string) => void;
}

// Operational online-reservation controls, shown as a tab inside the Settings hub.
// Any authenticated Host-app user may change these during service. Turning the
// switch OFF stops NEW online bookings only — walk-ins, phone reservations and
// existing bookings are unaffected (enforced server-side).
export default function OnlineReservationsSettings({ onToast }: Props) {
  const T = useT();
  const [enabled,   setEnabled]   = useState(true);
  const [maxParty,  setMaxParty]  = useState('5');
  const [savedMax,  setSavedMax]  = useState('5');
  const [loading,   setLoading]   = useState(true);
  const [busyToggle, setBusyToggle] = useState(false);
  const [busyMax,   setBusyMax]   = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  useEffect(() => {
    api.hostSettings.getOnlineReservations()
      .then(s => {
        setEnabled(s.onlineReservationsEnabled);
        setMaxParty(String(s.maxOnlinePartySize));
        setSavedMax(String(s.maxOnlinePartySize));
      })
      .catch(() => onToast(T.settingsHub.loadError))
      .finally(() => setLoading(false));
  }, []);

  async function persistEnabled(next: boolean) {
    setBusyToggle(true);
    const prev = enabled;
    setEnabled(next); // optimistic
    try {
      const s = await api.hostSettings.updateOnlineReservations({ onlineReservationsEnabled: next });
      setEnabled(s.onlineReservationsEnabled);
    } catch (err) {
      setEnabled(prev); // rollback
      onToast(err instanceof ApiError ? err.message : T.settingsHub.saveError);
    } finally {
      setBusyToggle(false);
    }
  }

  function handleToggle() {
    if (busyToggle) return;
    if (enabled) {
      // Turning OFF is high-impact — confirm first.
      setConfirmOff(true);
    } else {
      persistEnabled(true);
    }
  }

  async function handleSaveMax() {
    const n = Number(maxParty);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      onToast(T.settingsHub.saveError);
      return;
    }
    setBusyMax(true);
    try {
      const s = await api.hostSettings.updateOnlineReservations({ maxOnlinePartySize: n });
      setMaxParty(String(s.maxOnlinePartySize));
      setSavedMax(String(s.maxOnlinePartySize));
      onToast(T.settingsHub.savedToast);
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : T.settingsHub.saveError);
    } finally {
      setBusyMax(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-5 h-5 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const maxDirty = maxParty !== savedMax;

  return (
    <div className="p-4 space-y-4">
      {/* Online reservations on/off */}
      <div className="bg-iron-card border border-iron-border rounded-xl p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-iron-text text-sm font-semibold">{T.settingsHub.onlineToggleLabel}</p>
              <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                enabled
                  ? 'bg-iron-green/20 text-iron-green-light'
                  : 'bg-status-danger/15 text-status-danger'
              }`}>
                {enabled ? T.settingsHub.statusOn : T.settingsHub.statusOff}
              </span>
            </div>
            <p className="text-iron-muted text-xs mt-1">
              {enabled ? T.settingsHub.onlineOnHint : T.settingsHub.onlineOffHint}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            disabled={busyToggle}
            onClick={handleToggle}
            className={`relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
              enabled ? 'bg-iron-green' : 'bg-iron-border'
            }`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>
      </div>

      {/* Max online party size */}
      <div className="bg-iron-card border border-iron-border rounded-xl p-4">
        <label className="block text-iron-text text-sm font-semibold mb-1">
          {T.settingsHub.maxPartyLabel}
        </label>
        <p className="text-iron-muted text-xs mb-3">{T.settingsHub.maxPartyHint}</p>
        <div className="flex items-center gap-2">
          <input
            value={maxParty}
            onChange={e => setMaxParty(e.target.value.replace(/\D/g, '').slice(0, 3))}
            inputMode="numeric"
            className="w-20 bg-iron-bg border border-iron-border rounded-lg px-3 py-2 text-iron-text text-sm text-center focus:outline-none focus:border-iron-green"
          />
          <button
            type="button"
            onClick={handleSaveMax}
            disabled={busyMax || !maxDirty || maxParty === ''}
            className="bg-iron-green hover:bg-iron-green-light disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
          >
            {busyMax ? T.settingsHub.saving : T.settingsHub.save}
          </button>
        </div>
      </div>

      {/* Confirm turning OFF */}
      {confirmOff && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-iron-card border border-iron-border rounded-xl p-5 w-full max-w-sm">
            <h3 className="text-iron-text font-semibold text-sm mb-2">{T.settingsHub.offConfirmTitle}</h3>
            <p className="text-iron-muted text-xs mb-4">{T.settingsHub.offConfirmBody}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setConfirmOff(false); persistEnabled(false); }}
                className="flex-1 bg-status-danger hover:opacity-90 text-white font-semibold py-2 rounded-lg text-sm transition-opacity"
              >
                {T.settingsHub.offConfirmYes}
              </button>
              <button
                type="button"
                onClick={() => setConfirmOff(false)}
                className="flex-1 border border-iron-border text-iron-muted hover:text-iron-text py-2 rounded-lg text-sm transition-colors"
              >
                {T.settingsHub.offConfirmNo}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
