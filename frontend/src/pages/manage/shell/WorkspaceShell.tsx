import { useState } from 'react';
import type { ManagementContext, ManagementProductRole } from '../../../types';
import { findModule } from './modules';
import { useViewport } from './useViewport';
import WorkspaceHeader from './WorkspaceHeader';
import WorkspaceRail from './WorkspaceRail';
import WorkspacePage from './WorkspacePage';
import DashboardModule from '../modules/dashboard/DashboardModule';

interface Props {
  context: ManagementContext;
  userFirstName: string;
  activeModule: string;
  onNavigate: (key: string) => void;
  onExitToHost: () => void;
}

const ROLE_LABEL_HE: Record<ManagementProductRole, string> = {
  IRON_ADMIN: 'Iron Booking',
  HQ_ADMIN:   'מטה',
  OWNER:      'בעלים',
  MANAGER:    'מנהל/ת',
  HOST:       'מארח/ת',
  STAFF:      'צוות',
};

const CANVAS_ENTER = `@keyframes mgmtCanvas{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){.mgmt-canvas-anim{animation:none!important}}`;

// P0.2 places a shared placeholder inside the canvas. When each business module
// ships (P0.3+) it replaces this body only — the header, rail, and page chrome
// stay exactly as designed here.
function ModuleCanvas({ moduleKey, context, userFirstName, onNavigate }: { moduleKey: string; context: ManagementContext; userFirstName: string; onNavigate: (k: string) => void }) {
  const mod = findModule(moduleKey);
  const allowed = context.capabilities.includes(mod.capability);
  const Icon = mod.Icon;

  // Dashboard is the first live module (P0.3). Others remain placeholders until
  // their phase; each replaces this body only, inside the same shell.
  if (moduleKey === 'dashboard' && allowed) {
    return (
      <div key={moduleKey} className="h-full mgmt-canvas-anim" style={{ animation: 'mgmtCanvas 200ms ease-out' }}>
        <DashboardModule context={context} userFirstName={userFirstName} onNavigate={onNavigate} />
      </div>
    );
  }

  return (
    <div key={moduleKey} className="h-full mgmt-canvas-anim" style={{ animation: 'mgmtCanvas 200ms ease-out' }}>
      <WorkspacePage
        title={mod.label}
        subtitle={mod.subtitle}
        breadcrumbs={[{ label: 'מרכז הניהול' }, { label: mod.label }]}
        state={allowed ? 'ready' : 'denied'}
      >
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-sm">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-iron-green/12 border border-iron-green/25 flex items-center justify-center text-iron-green-light mb-4">
              <Icon size={22} />
            </div>
            <p className="text-iron-text font-semibold text-sm mb-1">{mod.label}</p>
            <p className="text-iron-muted text-xs mb-4 leading-relaxed">{mod.subtitle} · נפתח בשלב {mod.phase}.</p>
            <span className="inline-flex items-center gap-2 text-[11px] text-iron-muted/70 bg-iron-card border border-iron-border rounded-lg px-3 py-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-status-warning/80" /> בפיתוח — המסך ייטען כאן כשהמודול יהיה מוכן.
            </span>
          </div>
        </div>
      </WorkspacePage>
    </div>
  );
}

export default function WorkspaceShell({ context, userFirstName, activeModule, onNavigate, onExitToHost }: Props) {
  const vp = useViewport();
  const [overlayOpen, setOverlayOpen] = useState(false);
  const { restaurant, productRole } = context;

  return (
    <div className="h-full flex flex-col bg-iron-bg overflow-hidden">
      <style>{CANVAS_ENTER}</style>

      <WorkspaceHeader
        restaurantName={restaurant.name}
        restaurantSlug={restaurant.slug}
        userFirstName={userFirstName}
        roleLabel={ROLE_LABEL_HE[productRole] ?? ''}
        onExitToHost={onExitToHost}
        onToggleRail={() => setOverlayOpen(true)}
        showRailToggle={vp.railMode === 'overlay'}
      />

      <div className="flex-1 flex min-h-0">
        <WorkspaceRail
          activeKey={activeModule}
          onNavigate={onNavigate}
          mode={vp.railMode}
          overlayOpen={overlayOpen}
          onCloseOverlay={() => setOverlayOpen(false)}
        />
        <main className="flex-1 min-w-0 min-h-0">
          <ModuleCanvas moduleKey={activeModule} context={context} userFirstName={userFirstName} onNavigate={onNavigate} />
        </main>
      </div>
    </div>
  );
}
