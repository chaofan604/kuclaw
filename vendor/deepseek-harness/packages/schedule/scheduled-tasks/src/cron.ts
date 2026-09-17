interface CronField { readonly wildcard: boolean; readonly values: ReadonlySet<number> }
interface CronSchedule {
  readonly minute: CronField
  readonly hour: CronField
  readonly dayOfMonth: CronField
  readonly month: CronField
  readonly dayOfWeek: CronField
}

const LIMITS = [
  { name: 'minute', minimum: 0, maximum: 59 },
  { name: 'hour', minimum: 0, maximum: 23 },
  { name: 'day-of-month', minimum: 1, maximum: 31 },
  { name: 'month', minimum: 1, maximum: 12 },
  { name: 'day-of-week', minimum: 0, maximum: 7 },
] as const

function numeric(value: string, name: string): number {
  if (!/^\d+$/u.test(value)) throw new Error(`${name} contains an invalid value`)
  return Number(value)
}

function range(values: Set<number>, start: number, end: number, step: number, minimum: number, maximum: number, name: string): void {
  if (step < 1 || start < minimum || end > maximum || start > end) throw new Error(`${name} is outside its supported range`)
  for (let value = start; value <= end; value += step) values.add(maximum === 7 && value === 7 ? 0 : value)
}

function field(source: string, index: number): CronField {
  const limit = LIMITS[index]!
  const values = new Set<number>()
  for (const item of source.split(',')) {
    const segments = item.split('/')
    if (segments.length > 2) throw new Error(`${limit.name} has an invalid step`)
    const selector = segments[0]!
    const step = segments[1] === undefined ? 1 : numeric(segments[1], limit.name)
    if (selector === '*') {
      range(values, limit.minimum, limit.maximum, step, limit.minimum, limit.maximum, limit.name)
      continue
    }
    const bounds = selector.split('-')
    if (bounds.length === 1) {
      const value = numeric(bounds[0]!, limit.name)
      range(values, value, value, step, limit.minimum, limit.maximum, limit.name)
      continue
    }
    if (bounds.length !== 2) throw new Error(`${limit.name} has an invalid range`)
    range(values, numeric(bounds[0]!, limit.name), numeric(bounds[1]!, limit.name), step, limit.minimum, limit.maximum, limit.name)
  }
  return { wildcard: source === '*', values }
}

function parse(expression: string): CronSchedule {
  const values = expression.trim().split(/\s+/u)
  if (values.length !== 5) throw new Error('cron must contain five fields: minute hour day month weekday')
  return {
    minute: field(values[0]!, 0), hour: field(values[1]!, 1), dayOfMonth: field(values[2]!, 2),
    month: field(values[3]!, 3), dayOfWeek: field(values[4]!, 4),
  }
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })
  } catch {
    throw new Error('timeZone must be a valid IANA time-zone name')
  }
}

function parts(value: number, format: Intl.DateTimeFormat) {
  const mapped = Object.fromEntries(format.formatToParts(new Date(value))
    .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)])) as Record<string, number>
  const year = mapped['year']!
  const month = mapped['month']!
  const day = mapped['day']!
  return {
    minute: mapped['minute']!, hour: mapped['hour']!, day, month,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  }
}

function matches(schedule: CronSchedule, value: ReturnType<typeof parts>): boolean {
  if (!schedule.minute.values.has(value.minute) || !schedule.hour.values.has(value.hour) || !schedule.month.values.has(value.month)) return false
  const day = schedule.dayOfMonth.values.has(value.day)
  const weekday = schedule.dayOfWeek.values.has(value.weekday)
  return schedule.dayOfMonth.wildcard ? weekday : schedule.dayOfWeek.wildcard ? day : day || weekday
}

/**
 * Validate one five-field Cron rule and its explicit IANA time zone.
 * @param expression - `minute hour day month weekday` rule.
 * @param timeZone - IANA zone name the rule is interpreted in.
 */
export function validateCron(expression: string, timeZone: string): void {
  parse(expression)
  formatter(timeZone)
}

/**
 * Return the first matching UTC minute strictly after the supplied epoch.
 * @param expression - `minute hour day month weekday` rule.
 * @param timeZone - IANA zone name the rule is interpreted in.
 * @param after - epoch milliseconds the search starts strictly after.
 * @returns epoch milliseconds of the next matching minute.
 */
export function nextCronAt(expression: string, timeZone: string, after: number): number {
  const schedule = parse(expression)
  const format = formatter(timeZone)
  let candidate = Math.floor(after / 60_000) * 60_000 + 60_000
  const limit = candidate + 2 * 366 * 24 * 60 * 60_000
  while (candidate <= limit) {
    if (matches(schedule, parts(candidate, format))) return candidate
    candidate += 60_000
  }
  throw new Error('cron has no occurrence in the next two years')
}
