import { containsPattern, escapeLikePattern, escapeRegExp } from './search-pattern.util';

describe('escapeLikePattern', () => {
  it.each([
    ['plain', 'plain'],
    ['100%', '100\\%'],
    ['under_score', 'under\\_score'],
    ['back\\slash', 'back\\\\slash'],
    ['%_\\', '\\%\\_\\\\'],
  ])('escapes %p as %p', (input, expected) => {
    expect(escapeLikePattern(input)).toBe(expected);
  });

  it('wraps an escaped term for a "contains" search', () => {
    expect(containsPattern('a_b')).toBe('%a\\_b%');
  });
});

describe('escapeRegExp', () => {
  it('makes every regex metacharacter literal', () => {
    const input = 'INV.1 (a+)+$ [x] {2} ^|?*\\';

    expect(new RegExp(`^${escapeRegExp(input)}$`).test(input)).toBe(true);
    expect(new RegExp(escapeRegExp('INV.1')).test('INVX1')).toBe(false);
  });
});
