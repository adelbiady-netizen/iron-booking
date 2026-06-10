// Per-restaurant SMS template composition.
//
// Each templated message type can have, in restaurant.settings.smsTemplates[type]:
//   - main:  an editable template with {variables} that OVERRIDES the built-in default
//   - addon: a free-text note appended on a new line (no variable substitution)
//
// finalMessage = (custom main rendered, else built-in default) + ("\n" + addon, if addon)
//
// When neither is set the function returns the supplied default text verbatim, so
// existing SMS sending is unchanged unless a restaurant opts in.

export type TemplatedSmsType = 'RESERVATION_RECEIVED' | 'CONFIRMATION_REQUEST' | 'REMINDER';

export interface SmsTemplateVars {
  guestName?:        string;
  restaurantName?:   string;
  date?:             string;
  time?:             string;
  partySize?:        number | string;
  confirmationLink?: string;
}

// Variables offered for the main template (kept in sync with the portal editor).
export const SMS_TEMPLATE_VARIABLES = [
  '{guestName}', '{restaurantName}', '{date}', '{time}', '{partySize}', '{confirmationLink}',
] as const;

interface TemplatePair { main?: string | null; addon?: string | null }

export function renderSmsTemplate(template: string, vars: SmsTemplateVars): string {
  return template
    .replace(/\{guestName\}/g,        vars.guestName        ?? '')
    .replace(/\{restaurantName\}/g,   vars.restaurantName   ?? '')
    .replace(/\{date\}/g,             vars.date             ?? '')
    .replace(/\{time\}/g,             vars.time             ?? '')
    .replace(/\{partySize\}/g,        vars.partySize != null ? String(vars.partySize) : '')
    .replace(/\{confirmationLink\}/g, vars.confirmationLink ?? '');
}

export function composeSms(
  type: TemplatedSmsType,
  defaultText: string,
  vars: SmsTemplateVars,
  settings: Record<string, unknown>,
): string {
  const templates = (settings.smsTemplates ?? {}) as Record<string, TemplatePair | undefined>;
  const tpl = templates[type];

  const customMain = tpl?.main?.trim();
  const addon      = tpl?.addon?.trim();

  const main = customMain ? renderSmsTemplate(customMain, vars) : defaultText;
  return addon ? `${main}\n${addon}` : main;
}
