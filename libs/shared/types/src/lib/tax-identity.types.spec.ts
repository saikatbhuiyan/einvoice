import { binProblem, localDateTime, signatoryProblem, timeZoneProblem } from './tax-identity.types';

describe('binProblem', () => {
  it('accepts 13 digits', () => {
    expect(binProblem('0012345670101')).toBeNull();
  });

  it.each([
    ['12 digits', '001234567010'],
    ['14 digits', '00123456701011'],
    ['separators', '001234567-0101'],
    ['letters', '00123456701AB'],
    ['a number (leading zeros lost)', 1234567010100],
    ['nothing', undefined],
  ])('refuses %s', (_label, bin) => {
    expect(binProblem(bin)).toBe('bin must be exactly 13 digits.');
  });
});

describe('timeZoneProblem', () => {
  it.each(['Asia/Dhaka', 'UTC', 'Europe/London', 'America/New_York'])('accepts %s', (zone) => {
    expect(timeZoneProblem(zone)).toBeNull();
  });

  it.each([
    ['an unknown zone', 'Asia/Atlantis', /not a known IANA/],
    ['an offset (no DST or legal changes)', '+06:00', /IANA time zone/],
    ['empty', '', /IANA time zone/],
    ['not a string', 6, /IANA time zone/],
  ])('refuses %s', (_label, zone, message) => {
    expect(timeZoneProblem(zone)).toMatch(message);
  });
});

describe('signatoryProblem', () => {
  it('accepts a name and a designation', () => {
    expect(signatoryProblem({ name: 'Rahim Uddin', designation: 'Accounts Manager' })).toBeNull();
  });

  it.each([
    ['nothing', undefined],
    ['no designation', { name: 'Rahim Uddin' }],
    ['a blank name', { name: '  ', designation: 'Manager' }],
    ['a string', 'Rahim Uddin'],
  ])('refuses %s', (_label, signatory) => {
    expect(signatoryProblem(signatory)).toMatch(/authorizedSignatory needs/);
  });
});

describe('localDateTime', () => {
  // 21:30 UTC on New Year's Eve is 03:30 on 1 January in Dhaka (UTC+6, no DST).
  const instant = new Date('2026-12-31T21:30:00.000Z');

  it('gives the wall-clock date and time in the zone', () => {
    expect(localDateTime(instant, 'Asia/Dhaka')).toEqual({
      year: 2027,
      month: 1,
      day: 1,
      hour: 3,
      minute: 30,
      date: '2027-01-01',
      time: '03:30',
    });
    expect(localDateTime(instant, 'UTC')).toMatchObject({ year: 2026, date: '2026-12-31', time: '21:30' });
  });

  it('writes midnight as 00, not 24', () => {
    expect(localDateTime(new Date('2026-10-21T18:00:00.000Z'), 'Asia/Dhaka').time).toBe('00:00');
  });
});
