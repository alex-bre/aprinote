const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.35],
  ['month', 12],
]

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export function relativeTime(iso: string, now = Date.now()): string {
  const at = new Date(iso).getTime()
  if (Number.isNaN(at)) return ''

  let value = (at - now) / 1000
  for (const [unit, span] of UNITS) {
    if (Math.abs(value) < span) return rtf.format(Math.round(value), unit)
    value /= span
  }
  return rtf.format(Math.round(value), 'year')
}
