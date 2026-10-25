/**
 * Convert analytics BigInt counters to JSON-compatible numbers recursively.
 */
export function convertBigIntToNumber(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Handle BigInt values
  if (typeof obj === "bigint") {
    return Number(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(convertBigIntToNumber);
  }

  if (typeof obj === "object") {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = convertBigIntToNumber(value);
    }
    return result;
  }

  return obj;
}
