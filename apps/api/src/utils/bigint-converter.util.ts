/**
 * Recursively convert BigInt and Decimal values to numbers in an object
 * This handles both BigInt values and MariaDB/MySQL Decimal objects
 */
export function convertBigIntToNumber(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Handle BigInt values
  if (typeof obj === "bigint") {
    return Number(obj);
  }

  // Handle Decimal objects from MariaDB/MySQL (they have s, e, d properties)
  if (typeof obj === "object" && obj.constructor?.name === "Decimal") {
    return Number(obj.toString());
  }

  // Handle objects that look like Decimal structures
  if (
    typeof obj === "object" &&
    typeof obj.s === "number" &&
    typeof obj.e === "number" &&
    Array.isArray(obj.d)
  ) {
    // This is likely a Decimal object, convert to number
    const sign = obj.s === 1 ? 1 : -1;
    const digits = obj.d;
    const exponent = obj.e;

    // Reconstruct the number from the decimal representation
    let value = 0;
    for (let i = 0; i < digits.length; i++) {
      value = value * 10 + digits[i];
    }

    // Apply the exponent
    if (exponent >= 0) {
      value = value * Math.pow(10, exponent - digits.length + 1);
    } else {
      value = value / Math.pow(10, digits.length - exponent - 1);
    }

    return sign * value;
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
