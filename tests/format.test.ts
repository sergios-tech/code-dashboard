import { expect, test } from 'claude-code/testing'

import { describeInput, redact } from '../hooks/format/redact'
import {
  fmtClock,
  fmtDuration,
  fmtResetIn,
  fmtSpeed,
  fmtTimer,
  fmtUsd,
  gauge,
  kTokens,
  limitLabel,
  parseIso,
  plural,
  prettyModel,
  shorten,
  wrapText,
} from '../hooks/format/text'
import { dsn, fake } from './fixture'

test('model ids read as people say them', () => {
  expect(prettyModel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(prettyModel('claude-opus-5-5[1m]')).toBe('Opus 5.5 1M')
  expect(prettyModel('claude-sonnet-4-5@20250929')).toBe('Sonnet 4.5')
  expect(prettyModel('claude-3-5-haiku-20241022')).toBe('Haiku 3.5')
  expect(prettyModel('')).toBe('—')
})
test('shorten keeps one row whatever the input', () => {
  expect(shorten('a\n\tb   c', 10)).toBe('a b c')
  expect(shorten('x'.repeat(300), 12)).toHaveLength(12)
  expect(shorten('x'.repeat(300), 12).endsWith('…')).toBe(true)
  expect(shorten('🚀 deploy the thing now', 8).includes('\n')).toBe(false)
  expect(shorten('abc', 0)).toBe('')
})
test('numbers, money, durations and clocks', () => {
  expect(kTokens(950)).toBe('950'); expect(kTokens(102_400)).toBe('102k'); expect(kTokens(1_250_000)).toBe('1.3M')
  expect(fmtUsd(3.123)).toBe('$3.12'); expect(fmtUsd(123.4)).toBe('$123')
  expect(fmtDuration(42_000)).toBe('42s'); expect(fmtDuration(102_000)).toBe('1m42s'); expect(fmtDuration(3_900_000)).toBe('1h05m')
  expect(fmtTimer(102_000)).toBe('1:42'); expect(fmtClock(0)).toBe('--:--:--')
  // A duration counts whole seconds, as the running clock does, so a row and its log line agree.
  expect([fmtDuration(21_782), fmtTimer(21_782)]).toEqual(['21s', '0:21']); expect(fmtDuration(59_900)).toBe('59s')
  expect(plural(1, 'edit')).toBe('1 edit'); expect(plural(2, 'edit')).toBe('2 edits')
  expect(fmtSpeed({ ttftMs: 800, tokPerS: 60.4 })).toBe('ttft 0.8s · 60 tok/s'); expect(fmtSpeed({ ttftMs: 800, tokPerS: null })).toBe('ttft 0.8s · — tok/s')
})
test('an ISO 8601 time is read as milliseconds since the epoch, by arithmetic', () => {
  expect(parseIso('1970-01-01T00:00:00Z')).toBe(0); expect(parseIso('1969-12-31T23:59:59Z')).toBe(-1000)
  expect(parseIso('2000-01-01T00:00:00Z')).toBe(946_684_800_000); expect(parseIso('2000-02-29T00:00:00Z')).toBe(951_782_400_000)
  expect(parseIso('1900-03-01T00:00:00Z')).toBe(-2_203_891_200_000); expect(parseIso('2100-03-01T00:00:00Z')).toBe(4_107_542_400_000)
  expect(parseIso('2024-02-29T12:00:00Z')).toBe(1_709_208_000_000); expect(parseIso('2026-10-23T12:00:00Z')).toBe(1_792_756_800_000)
  // Fractional seconds count to the millisecond; an offset moves the instant by its sign.
  expect(parseIso('1970-01-01T03:10:00.000Z')).toBe(11_400_000); expect(parseIso('2026-10-23T12:00:00.123456Z')).toBe(1_792_756_800_123)
  expect(parseIso('2026-10-23T12:00:00.5+02:00')).toBe(1_792_749_600_500); expect(parseIso('2026-10-23T12:00:00.123-05:30')).toBe(1_792_776_600_123)
  for (const bad of ['', 'soon', '2026-10-23', '2026-10-23T12:00:00', '2026-10-23 12:00:00Z', '2026-13-01T00:00:00Z', '2026-02-29T00:00:00Z', '2026-04-31T00:00:00Z', '2026-10-23T24:00:00Z', '2026-10-23T12:60:00Z', '2026-10-23T12:00:60Z', '2026-10-23T12:00:00+0200', '2026-10-23T12:00:00+24:00', '2026-10-23T12:00:00z'])
    expect(parseIso(bad), bad).toBeNaN()
  expect(parseIso(undefined)).toBeNaN(); expect(parseIso(1_792_756_800_000)).toBeNaN()
})
test('rate-limit labels and reset countdowns', () => {
  expect(limitLabel('five_hour')).toBe('5h'); expect(limitLabel('seven_day_opus')).toBe('7d opus')
  const now = 1_000_000_000
  expect(fmtResetIn(now + 25 * 60_000, now)).toBe('25m'); expect(fmtResetIn(now + 190 * 60_000, now)).toBe('3h10m')
  expect(fmtResetIn(now + (4 * 1440 + 120) * 60_000, now)).toBe('4d2h'); expect(fmtResetIn(now - 1, now)).toBe(''); expect(fmtResetIn(null, now)).toBe('')
})
test('gauges', () => {
  expect(gauge(51, 10)).toEqual({ on: '▰▰▰▰▰', off: '▱▱▱▱▱' }); expect(gauge(150, 4).on).toBe('▰▰▰▰')
})
test('wrapText splits at word boundaries within the row budget', () => {
  expect(wrapText('one two three four', 9, 3)).toEqual(['one two', 'three', 'four'])
  expect(wrapText('one two three four', 9, 2)).toEqual(['one two', 'three…'])
})
test('redaction masks credentials before anything is stored', () => {
  expect(redact(`curl -H "Authorization: Bearer ${fake()}" x`)).not.toContain(fake())
  expect(redact(`curl -H "X-Auth: Bearer ${fake()}" x`)).not.toContain(fake())
  expect(redact(`export OPENAI_API_KEY=${fake('sk-proj-')}`)).not.toContain(fake())
  expect(redact(`gh auth --token ${fake('ghp_')}`)).not.toContain(fake())
  expect(redact(`gh auth --token ${fake()}`)).not.toContain(fake())
  expect(redact(`deploy DB_KEY=${fake()}`)).not.toContain(fake())
  expect(redact(`psql ${dsn('bob')}`)).not.toContain(fake())
  expect(redact(`password=${fake()} ls`)).not.toContain(fake())
  expect(redact('ls -la src/')).toBe('ls -la src/')
  expect(describeInput('Read', { file_path: 'C:\\Users\\me\\proj\\src\\main.ts' })).toBe('Read → src/main.ts')
  expect(describeInput('Bash', { command: `TOKEN=${fake()} make` })).not.toContain(fake())
})
