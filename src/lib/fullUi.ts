/**
 * This build is used for the canvas, so the chrome for the rest of the
 * product is put away: sharing, the "owned by me" / "shared with me" scopes,
 * the community, automations, integrations, webhooks, the plan line, the help
 * menu, the desktop-app and website links, and on the home page the agents
 * rail and the "ask me what to design" hero. Workspaces stay.
 *
 * Only the ways in are hidden. The pages still open by their URL and the
 * server is untouched, so nothing here is a permission.
 *
 * `localStorage['doop:full-ui'] = 'on'` (then reload) brings it all back.
 */
function readFullUi(): boolean {
  try {
    return localStorage.getItem('doop:full-ui') === 'on'
  } catch {
    return false
  }
}

export const FULL_UI = readFullUi()
