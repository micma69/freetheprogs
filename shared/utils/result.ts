/**
 * Result monad 
 */

export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/**
 * Pure functions for Result monad
 */
export const Ok = <T>(value: T): Result<T, never> => ({
  ok: true,
  value,
});

export const Err = <E>(error: E): Result<never, E> => ({
  ok: false,
  error,
});

/**
 * Map over the value if Result is Ok
 */
export const map = <T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U
): Result<U, E> => {
  if (result.ok) {
    return Ok(fn(result.value));
  }
  return result;
};

/**
 * Map over the error if Result is Err
 */
export const mapErr = <T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F
): Result<T, F> => {
  if (!result.ok) {
    return Err(fn(result.error));
  }
  return result;
};

/**
 * flatMap - monadic bind
 */
export const andThen = <T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> => {
  if (result.ok) {
    return fn(result.value);
  }
  return result;
};

/**
 * Unwrap value or throw
 */
export const unwrap = <T, E>(result: Result<T, E>): T => {
  if (result.ok) {
    return result.value;
  }
  throw result.error;
};

/**
 * Unwrap value or return default
 */
export const unwrapOr = <T, E>(
  result: Result<T, E>,
  defaultValue: T
): T => {
  if (result.ok) {
    return result.value;
  }
  return defaultValue;
};

/**
 * Unwrap value or compute default from error
 */
export const unwrapOrElse = <T, E>(
  result: Result<T, E>,
  fn: (error: E) => T
): T => {
  if (result.ok) {
    return result.value;
  }
  return fn(result.error);
};

/**
 * Check if Result is Ok
 */
export const isOk = <T, E>(result: Result<T, E>): result is { ok: true; value: T } => {
  return result.ok;
};

/**
 * Check if Result is Err
 */
export const isErr = <T, E>(result: Result<T, E>): result is { ok: false; error: E } => {
  return !result.ok;
};

export const flatMap = andThen; 

export const all = <T, E>(results: Result<T, E>[]): Result<T[], E> => {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return Ok(values);
};


export const pipe = <T>(
  value: T,
  ...fns: Array<(arg: any) => any>
): any => {
  return fns.reduce((acc, fn) => fn(acc), value);
};
