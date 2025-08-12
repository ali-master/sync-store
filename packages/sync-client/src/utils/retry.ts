/**
 * Advanced retry utilities with exponential backoff and jitter
 */

export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoffStrategy: "linear" | "exponential";
  jitter?: boolean;
  retryCondition?: (error: any) => boolean;
  onRetry?: (attempt: number, error: any) => void;
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: any;
  attempts: number;
  totalTime: number;
}

/**
 * Retry a function with configurable strategy
 */
export async function retry<T>(fn: () => Promise<T>, config: RetryConfig): Promise<RetryResult<T>> {
  const startTime = Date.now();
  let lastError: any;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      const result = await fn();
      return {
        success: true,
        result,
        attempts: attempt,
        totalTime: Date.now() - startTime,
      };
    } catch (error) {
      lastError = error;

      // Check if we should retry this error
      if (config.retryCondition && !config.retryCondition(error)) {
        break;
      }

      // Don't wait after the last attempt
      if (attempt === config.maxAttempts) {
        break;
      }

      // Calculate delay
      const delay = calculateDelay(attempt, config);

      // Call retry callback if provided
      if (config.onRetry) {
        config.onRetry(attempt, error);
      }

      // Wait before next attempt
      await sleep(delay);
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: config.maxAttempts,
    totalTime: Date.now() - startTime,
  };
}

/**
 * Create a retryable version of a function
 */
export function retryable<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  config: RetryConfig,
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    const result = await retry(() => fn(...args), config);

    if (result.success) {
      return result.result!;
    } else {
      throw result.error;
    }
  };
}

/**
 * Calculate delay based on strategy
 */
function calculateDelay(attempt: number, config: RetryConfig): number {
  let delay: number;

  switch (config.backoffStrategy) {
    case "linear":
      delay = config.baseDelay * attempt;
      break;
    case "exponential":
      delay = config.baseDelay * Math.pow(2, attempt - 1);
      break;
    default:
      delay = config.baseDelay;
  }

  // Apply max delay cap
  delay = Math.min(delay, config.maxDelay);

  // Apply jitter to prevent thundering herd
  if (config.jitter) {
    delay = delay * (0.5 + Math.random() * 0.5);
  }

  return Math.round(delay);
}

/**
 * Sleep utility
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Common retry conditions
 */
export const retryConditions = {
  // Retry on network errors
  networkErrors: (error: any): boolean => {
    if (error?.code) {
      const networkCodes = [
        "ECONNRESET",
        "ECONNREFUSED",
        "ETIMEDOUT",
        "ENOTFOUND",
        "ENETDOWN",
        "ENETUNREACH",
      ];
      return networkCodes.includes(error.code);
    }
    return false;
  },

  // Retry on HTTP 5xx errors
  serverErrors: (error: any): boolean => {
    const status = error?.response?.status || error?.status;
    return status >= 500 && status < 600;
  },

  // Retry on rate limiting (429)
  rateLimitErrors: (error: any): boolean => {
    const status = error?.response?.status || error?.status;
    return status === 429;
  },

  // Retry on transient errors
  transientErrors: (error: any): boolean => {
    return (
      retryConditions.networkErrors(error) ||
      retryConditions.serverErrors(error) ||
      retryConditions.rateLimitErrors(error)
    );
  },

  // Never retry
  never: (): boolean => false,

  // Always retry
  always: (): boolean => true,
};

/**
 * Default retry configurations
 */
export const retryConfigs = {
  // Quick retry for UI operations
  quick: {
    maxAttempts: 3,
    baseDelay: 100,
    maxDelay: 1000,
    backoffStrategy: "exponential" as const,
    jitter: true,
    retryCondition: retryConditions.transientErrors,
  },

  // Standard retry for API calls
  standard: {
    maxAttempts: 5,
    baseDelay: 1000,
    maxDelay: 10000,
    backoffStrategy: "exponential" as const,
    jitter: true,
    retryCondition: retryConditions.transientErrors,
  },

  // Aggressive retry for critical operations
  aggressive: {
    maxAttempts: 10,
    baseDelay: 500,
    maxDelay: 30000,
    backoffStrategy: "exponential" as const,
    jitter: true,
    retryCondition: retryConditions.transientErrors,
  },

  // Conservative retry with linear backoff
  conservative: {
    maxAttempts: 3,
    baseDelay: 2000,
    maxDelay: 10000,
    backoffStrategy: "linear" as const,
    jitter: false,
    retryCondition: retryConditions.serverErrors,
  },
};

/**
 * Circuit breaker pattern implementation
 */
export class CircuitBreaker<T extends any[], R> {
  private failures = 0;
  private lastFailureTime = 0;
  private state: "closed" | "open" | "half-open" = "closed";

  constructor(
    private fn: (...args: T) => Promise<R>,
    private config: {
      failureThreshold: number;
      recoveryTimeout: number;
      monitoringWindow: number;
    },
  ) {}

  async execute(...args: T): Promise<R> {
    if (this.state === "open") {
      if (Date.now() - this.lastFailureTime >= this.config.recoveryTimeout) {
        this.state = "half-open";
      } else {
        throw new Error("Circuit breaker is open");
      }
    }

    try {
      const result = await this.fn(...args);

      if (this.state === "half-open") {
        this.reset();
      }

      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  private recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.config.failureThreshold) {
      this.state = "open";
    }
  }

  private reset(): void {
    this.failures = 0;
    this.state = "closed";
    this.lastFailureTime = 0;
  }

  getState(): "closed" | "open" | "half-open" {
    return this.state;
  }

  getFailures(): number {
    return this.failures;
  }
}

/**
 * Create a circuit breaker wrapped function
 */
export function circuitBreaker<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  config: {
    failureThreshold?: number;
    recoveryTimeout?: number;
    monitoringWindow?: number;
  } = {},
): {
  execute: (...args: T) => Promise<R>;
  getState: () => "closed" | "open" | "half-open";
  getFailures: () => number;
} {
  const breaker = new CircuitBreaker(fn, {
    failureThreshold: 5,
    recoveryTimeout: 60000, // 1 minute
    monitoringWindow: 300000, // 5 minutes
    ...config,
  });

  return {
    execute: breaker.execute.bind(breaker),
    getState: breaker.getState.bind(breaker),
    getFailures: breaker.getFailures.bind(breaker),
  };
}

/**
 * Timeout wrapper for promises
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage = "Operation timed out",
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    }),
  ]);
}

/**
 * Debounce function calls
 */
export function debounce<T extends any[]>(
  fn: (...args: T) => void,
  delay: number,
): (...args: T) => void {
  let timeoutId: NodeJS.Timeout;

  return (...args: T) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Throttle function calls
 */
export function throttle<T extends any[]>(
  fn: (...args: T) => void,
  delay: number,
): (...args: T) => void {
  let lastCall = 0;

  return (...args: T) => {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      fn(...args);
    }
  };
}
