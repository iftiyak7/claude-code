import { TEMPLATES, type Template } from '@/domain/templates';
import { useData } from '@/store/data';

/** Has this template already been added (and not deleted)? */
export function isTemplateAdded(t: Template, s = useData.getState()): boolean {
  if (t.kind === 'amal') return !!s.amals[t.id] && !s.amals[t.id].deleted;
  if (t.kind === 'reminder') return !!s.reminders[t.id] && !s.reminders[t.id].deleted;
  if (t.kind === 'routine') return !!s.routines[t.id] && !s.routines[t.id].deleted;
  if (t.kind === 'water') return s.settings.waterReminder.mode !== 'none' && s.settings.waterGoalMl === t.water?.waterGoalMl;
  return false;
}

/** Add a template with its sensible defaults. Idempotent. */
export function applyTemplate(t: Template) {
  const s = useData.getState();
  if (isTemplateAdded(t, s)) return;
  if (t.amal) s.upsert('amals', { ...t.amal, id: t.id });
  if (t.reminder) s.upsert('reminders', { ...t.reminder, id: t.id });
  if (t.routine) s.upsert('routines', { ...t.routine, id: t.id });
  if (t.water) s.updateSettings(t.water);
}

export function templateRoute(t: Template): string {
  if (t.kind === 'amal') return `/amal/edit?id=${t.id}`;
  if (t.kind === 'reminder') return `/reminder/edit?id=${t.id}`;
  if (t.kind === 'routine') return `/routine/edit?id=${t.id}`;
  return '/health';
}

export { TEMPLATES };
