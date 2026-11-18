const LOCAL_ORIGIN_PATTERNS = [
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
  /^http:\/\/0\.0\.0\.0:\d+$/,
];

export function isAllowedCorsOrigin(
  origin: string | undefined,
  configuredOrigins: readonly string[],
  allowLocalOrigins: boolean,
): boolean {
  if (!origin) return true;

  return (
    configuredOrigins.includes(origin) ||
    (allowLocalOrigins && LOCAL_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin)))
  );
}
