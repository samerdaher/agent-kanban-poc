// Minimal 5-field cron matcher: minute hour day-of-month month day-of-week.
// Supports "*", numbers, comma lists, and "*/n" steps. Local server time.
function fieldMatches(field: string, value: number): boolean {
  for (const part of field.split(',')) {
    if (part === '*') return true;
    const step = part.match(/^\*\/(\d+)$/);
    if (step) {
      if (value % Number(step[1]) === 0) return true;
      continue;
    }
    if (/^\d+$/.test(part) && Number(part) === value) return true;
  }
  return false;
}

export function cronMatches(expr: string, date = new Date()): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, dom, mon, dow] = parts;
  return (
    fieldMatches(min, date.getMinutes()) &&
    fieldMatches(hour, date.getHours()) &&
    fieldMatches(dom, date.getDate()) &&
    fieldMatches(mon, date.getMonth() + 1) &&
    fieldMatches(dow, date.getDay())
  );
}

export function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  return parts.length === 5 && parts.every((p) => /^(\*|\d+|\*\/\d+)(,(\*|\d+|\*\/\d+))*$/.test(p));
}
