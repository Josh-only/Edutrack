import { validateEnvironment } from './validate-environment.js';

const validEnvironment = {
  DB_HOST: 'localhost',
  DB_USERNAME: 'test-user',
  DB_PASSWORD: 'test-password',
  DB_DATABASE: 'edutrack-test',
  JWT_SECRET: 'test-secret',
};

describe('validateEnvironment', () => {
  it('accepts required database and JWT settings and optional valid ports', () => {
    const environment = {
      ...validEnvironment,
      DB_PORT: '5432',
      PORT: '3000',
    };

    expect(validateEnvironment(environment)).toBe(environment);
  });

  it('reports missing settings by name without including values', () => {
    expect(() => validateEnvironment({ ...validEnvironment, JWT_SECRET: ' ' })).toThrow(
      'Missing required environment variables: JWT_SECRET',
    );
  });

  it.each(['0', '65536', 'not-a-port'])('rejects invalid DB port %s', (port) => {
    expect(() => validateEnvironment({ ...validEnvironment, DB_PORT: port })).toThrow(
      'DB_PORT must be an integer between 1 and 65535.',
    );
  });

  it('rejects an invalid application port', () => {
    expect(() => validateEnvironment({ ...validEnvironment, PORT: 'invalid' })).toThrow(
      'PORT must be an integer between 1 and 65535.',
    );
  });

  it('allows local invitation links only when explicitly enabled in development', () => {
    const environment = {
      ...validEnvironment,
      NODE_ENV: 'development',
      LOCAL_INVITATION_LINKS: 'true',
    };

    expect(validateEnvironment(environment)).toBe(environment);
    expect(() => validateEnvironment({
      ...validEnvironment,
      NODE_ENV: 'production',
      LOCAL_INVITATION_LINKS: 'true',
    })).toThrow('LOCAL_INVITATION_LINKS can only be enabled when NODE_ENV is development.');
  });

  it('rejects invalid local invitation link setting values', () => {
    expect(() => validateEnvironment({
      ...validEnvironment,
      NODE_ENV: 'development',
      LOCAL_INVITATION_LINKS: 'yes',
    })).toThrow('LOCAL_INVITATION_LINKS must be true or false.');
  });
});
