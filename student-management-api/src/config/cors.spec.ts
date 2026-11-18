import { isAllowedCorsOrigin } from './cors.js';

describe('isAllowedCorsOrigin', () => {
  it('allows only configured origins in production', () => {
    expect(isAllowedCorsOrigin('https://school.example', ['https://school.example'], false)).toBe(true);
    expect(isAllowedCorsOrigin('http://localhost:5173', ['https://school.example'], false)).toBe(false);
    expect(isAllowedCorsOrigin('https://other.example', ['https://school.example'], false)).toBe(false);
  });

  it('allows localhost origins outside production', () => {
    expect(isAllowedCorsOrigin('http://localhost:5173', [], true)).toBe(true);
    expect(isAllowedCorsOrigin('https://school.example', [], true)).toBe(false);
  });

  it('allows requests without an Origin header', () => {
    expect(isAllowedCorsOrigin(undefined, [], false)).toBe(true);
  });
});
