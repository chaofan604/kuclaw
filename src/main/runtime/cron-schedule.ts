interface CronField {
  wildcard: boolean
  values: Set<number>
}

interface CronSchedule {
  minute: CronField
  hour: CronField
  dayOfMonth: CronField
  month: CronField
  dayOfWeek: CronField
}

const FIELD_LIMITS = [
  { name: '分钟', minimum: 0, maximum: 59 },
  { name: '小时', minimum: 0, maximum: 23 },
  { name: '日期', minimum: 1, maximum: 31 },
  { name: '月份', minimum: 1, maximum: 12 },
  { name: '星期', minimum: 0, maximum: 7 },
] as const

function integer(value: string, name: string): number {
  if (!/^\d+$/u.test(value)) throw new Error(`${name}字段包含无效值`)
  return Number(value)
}

function addRange(values: Set<number>, start: number, end: number, step: number, minimum: number, maximum: number, name: string): void {
  if (step < 1) throw new Error(`${name}字段的步长必须大于 0`)
  if (start < minimum || end > maximum || start > end) throw new Error(`${name}字段超出允许范围`)
  for (let value = start; value <= end; value += step) values.add(value === 7 && maximum === 7 ? 0 : value)
}

function parseField(source: string, index: number): CronField {
  const limits = FIELD_LIMITS[index]!
  const values = new Set<number>()
  const wildcard = source === '*'
  for (const part of source.split(',')) {
    const [rangeSource, stepSource] = part.split('/')
    if (rangeSource === undefined || part.split('/').length > 2) throw new Error(`${limits.name}字段格式无效`)
    const step = stepSource === undefined ? 1 : integer(stepSource, limits.name)
    if (rangeSource === '*') {
      addRange(values, limits.minimum, limits.maximum, step, limits.minimum, limits.maximum, limits.name)
      continue
    }
    const range = rangeSource.split('-')
    if (range.length === 1) {
      const value = integer(range[0]!, limits.name)
      addRange(values, value, value, step, limits.minimum, limits.maximum, limits.name)
      continue
    }
    if (range.length !== 2) throw new Error(`${limits.name}字段格式无效`)
    addRange(
      values,
      integer(range[0]!, limits.name),
      integer(range[1]!, limits.name),
      step,
      limits.minimum,
      limits.maximum,
      limits.name,
    )
  }
  return { wildcard, values }
}

function parseCron(expression: string): CronSchedule {
  const fields = expression.trim().split(/\s+/u)
  if (fields.length !== 5) throw new Error('Cron 表达式必须包含 5 个字段：分 时 日 月 周')
  return {
    minute: parseField(fields[0]!, 0),
    hour: parseField(fields[1]!, 1),
    dayOfMonth: parseField(fields[2]!, 2),
    month: parseField(fields[3]!, 3),
    dayOfWeek: parseField(fields[4]!, 4),
  }
}

function zonedParts(timestamp: number, timeZone: string): { minute: number; hour: number; day: number; month: number; year: number; weekday: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp))
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, Number(part.value)])) as Record<string, number>
  const year = parts.year!
  const month = parts.month!
  const day = parts.day!
  return {
    year,
    month,
    day,
    hour: parts.hour!,
    minute: parts.minute!,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  }
}

function matches(schedule: CronSchedule, parts: ReturnType<typeof zonedParts>): boolean {
  if (!schedule.minute.values.has(parts.minute) || !schedule.hour.values.has(parts.hour) || !schedule.month.values.has(parts.month)) return false
  const dayMatches = schedule.dayOfMonth.values.has(parts.day)
  const weekdayMatches = schedule.dayOfWeek.values.has(parts.weekday)
  const calendarMatches = schedule.dayOfMonth.wildcard
    ? weekdayMatches
    : schedule.dayOfWeek.wildcard
      ? dayMatches
      : dayMatches || weekdayMatches
  return calendarMatches
}

export function validateCronSchedule(expression: string, timeZone: string): void {
  parseCron(expression)
  try {
    zonedParts(Date.now(), timeZone)
  } catch {
    throw new Error('时区无效，请使用 IANA 时区名称，例如 Asia/Shanghai')
  }
}

export function nextCronOccurrence(expression: string, timeZone: string, after: number): number {
  const schedule = parseCron(expression)
  try {
    zonedParts(after, timeZone)
  } catch {
    throw new Error('时区无效，请使用 IANA 时区名称，例如 Asia/Shanghai')
  }
  let candidate = Math.floor(after / 60_000) * 60_000 + 60_000
  const limit = candidate + 2 * 366 * 24 * 60 * 60_000
  while (candidate <= limit) {
    if (matches(schedule, zonedParts(candidate, timeZone))) return candidate
    candidate += 60_000
  }
  throw new Error('无法在未来两年内计算下一次运行时间')
}
