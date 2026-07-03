import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { ManagementContext, ManagementCapability } from '../types';

type State =
  | { status: 'loading' }
  | { status: 'ready'; context: ManagementContext }
  | { status: 'forbidden' }
  | { status: 'error'; message: string };

// Fetches the Management Workspace boot context. Fail-closed: on 401/403 the caller
// is treated as having no access. `enabled` guards the fetch so it never fires
// before auth is loaded (or when the user isn't authenticated).
export function useManagementContext(enabled: boolean) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setState({ status: 'loading' });
    api.management
      .context()
      .then(context => {
        if (alive) setState({ status: 'ready', context });
      })
      .catch(err => {
        if (!alive) return;
        if (err instanceof ApiError && (err.status === 403 || err.status === 401)) {
          setState({ status: 'forbidden' });
        } else {
          setState({ status: 'error', message: err instanceof Error ? err.message : 'Failed to load' });
        }
      });
    return () => {
      alive = false;
    };
  }, [enabled]);

  const has = (cap: ManagementCapability): boolean =>
    state.status === 'ready' && state.context.capabilities.includes(cap);

  return { state, has };
}
