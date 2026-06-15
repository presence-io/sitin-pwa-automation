import type { TestAction } from './types';

export function resolveVariables(value: string, vars: Record<string, string>): string {
  return value.replace(/\{\{(.+?)\}\}/g, (_, expr: string) => {
    if (expr.startsWith('random:')) {
      return expr.slice(7) + Math.random().toString(36).slice(2, 8);
    }
    if (expr === 'timestamp') return String(Date.now());
    if (expr.startsWith('date:')) {
      const d = new Date();
      return expr.slice(5)
        .replace('YYYY', String(d.getFullYear()))
        .replace('MM', String(d.getMonth() + 1).padStart(2, '0'))
        .replace('DD', String(d.getDate()).padStart(2, '0'));
    }
    return vars[expr] ?? `{{${expr}}}`;
  });
}

export function resolveActionVariables(action: TestAction, vars: Record<string, string>): TestAction {
  const r = { ...action };
  if (r.value) r.value = resolveVariables(r.value, vars);
  if (r.url) r.url = resolveVariables(r.url, vars);
  if (r.expected) r.expected = resolveVariables(r.expected, vars);
  if (r.event) r.event = resolveVariables(r.event, vars);
  if (r.key) r.key = resolveVariables(r.key, vars);
  return r;
}
