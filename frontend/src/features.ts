// Feature flags (Product Architecture v1).
//
// Kill-switch for the Management Workspace. Flip to false to instantly hide the
// Management Center entry in the Host Workspace and block the /{slug}/manage route
// — no other change required. Safe default while P0 is in progress.
export const MANAGEMENT_WORKSPACE_ENABLED = true;
