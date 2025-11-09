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

/**
 * Functional array utilities that work with Result type
 */
export const mapArray = <A, B>(fn: (a: A) => B) => (arr: readonly A[]): readonly B[] =>
  arr.map(fn);

export const filterArray = <A>(predicate: (a: A) => boolean) => (arr: readonly A[]): readonly A[] =>
  arr.filter(predicate);

export const reduceArray = <A, B>(reducer: (acc: B, val: A) => B, initial: B) => (arr: readonly A[]): B =>
  arr.reduce(reducer, initial);

export const flatMapArray = <A, B>(fn: (a: A) => readonly B[]) => (arr: readonly A[]): readonly B[] =>
  arr.flatMap(fn);

export const takeArray = (count: number) => <T>(arr: readonly T[]): readonly T[] =>
  arr.slice(0, count);

export const dropArray = (count: number) => <T>(arr: readonly T[]): readonly T[] =>
  arr.slice(count);

export const zipArray = <A, B>(arrA: readonly A[], arrB: readonly B[]): readonly (readonly [A, B])[] =>
  arrA.slice(0, Math.min(arrA.length, arrB.length)).map((a, i) => [a, arrB[i]] as const);

/**
 * Traverse implementation using `all` function
 * Applies a function that returns Result to each element and collects all Results
 */
export const traverse = <A, B, E>(fn: (a: A) => Result<B, E>) => (arr: readonly A[]): Result<readonly B[], E> =>
  all(arr.map(fn));

/**
 * Composition helper for working with Results in pipe
 */
export const mapWith = <A, B, E>(fn: (a: A) => B) => (result: Result<A, E>): Result<B, E> =>
  map(result, fn);

export const andThenWith = <A, B, E>(fn: (a: A) => Result<B, E>) => (result: Result<A, E>): Result<B, E> =>
  andThen(result, fn);