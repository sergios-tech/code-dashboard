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
  plural,
  prettyModel,
  shorten,
  sparkline,
  wrapText,
} from '../hooks/format/text'

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
  expect(plural(1, 'edit')).toBe('1 edit'); expect(plural(2, 'edit')).toBe('2 edits')
  expect(fmtSpeed({ ttftMs: 800, tokPerS: 60.4 })).toBe('ttft 0.8s · 60 tok/s'); expect(fmtSpeed({ ttftMs: 800, tokPerS: null })).toBe('ttft 0.8s')
})
test('rate-limit labels and reset countdowns', () => {
  expect(limitLabel('five_hour')).toBe('5h'); expect(limitLabel('seven_day_opus')).toBe('7d opus')
  const now = 1_000_000_000
  expect(fmtResetIn(now + 25 * 60_000, now)).toBe('25m'); expect(fmtResetIn(now + 190 * 60_000, now)).toBe('3h10m')
  expect(fmtResetIn(now + (4 * 1440 + 120) * 60_000, now)).toBe('4d2h'); expect(fmtResetIn(now - 1, now)).toBe(''); expect(fmtResetIn(null, now)).toBe('')
})
test('gauges and sparklines', () => {
  expect(gauge(51, 10)).toEqual({ on: '▰▰▰▰▰', off: '▱▱▱▱▱' }); expect(gauge(150, 4).on).toBe('▰▰▰▰')
  expect(sparkline([0, 50, 100], 3, { min: 0, max: 100 })).toBe('▁▅█')
  expect(sparkline([10, null, 30], 3, { min: 0, max: 100 })[1]).toBe(' ')
  expect(sparkline([1, 2, 3, 4, 5, 6], 3)).toHaveLength(3)   // resampled to width: each cell takes the last value that falls in it
  expect(sparkline([7], 5)).toHaveLength(5)                  // one value fills from the right; leading cells are spaces
  expect(sparkline([], 4)).toBe('    ')
})
test('wrapText splits at word boundaries within the row budget', () => {
  expect(wrapText('one two three four', 9, 3)).toEqual(['one two', 'three', 'four'])
  expect(wrapText('one two three four', 9, 2)).toEqual(['one two', 'three…'])
})
test('redaction masks credentials before anything is stored', () => {
  expect(redact('curl -H "Authorization: Bearer abc.def.ghi123" x')).not.toContain('abc.def')
  expect(redact('export OPENAI_API_KEY=sk-proj-1234567890abcdef')).not.toContain('1234567890')
  expect(redact('gh auth --token ghp_abcdefghijklmnop')).not.toContain('abcdefghijklmnop')
  expect(redact('psql postgres://bob:hunter2@db/x')).not.toContain('hunter2')
  expect(redact('password=hunter2 ls')).not.toContain('hunter2')
  expect(redact('ls -la src/')).toBe('ls -la src/')
  expect(describeInput('Read', { file_path: 'C:\\Users\\me\\proj\\src\\main.ts' })).toBe('Read → src/main.ts')
  expect(describeInput('Bash', { command: 'TOKEN=abc12345678 make' })).not.toContain('abc12345678')
})
