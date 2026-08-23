/**
 * Write a key that came from untrusted JSON onto a plain object.
 *
 * `target[key] = value` is correct for every key name except one. Assigning to `__proto__`
 * invokes the setter inherited from `Object.prototype`, which changes the object's prototype
 * instead of creating a property — so the key disappears with no error, and if the value is an
 * object it becomes the prototype instead.
 *
 * `__proto__` is a perfectly legal JSON key, and a mock corpus is more likely than most to
 * contain one: any stub whose response body is arbitrary JSON, and every stub written to
 * reproduce a prototype-pollution bug. Dropping it silently is the failure mode CLAUDE.md
 * invariant 4 exists to prevent, and in `canonical.ts` it was worse than lossy — `contentHash`
 * feeds `client_key`, so two different stubs could land on one identity.
 *
 * Found by the property test in `canonical.test.ts`, on CI, after passing locally many times.
 *
 * Browser-safe: no `node:` imports.
 */
export function setKey<T>(target: Record<string, T>, key: string, value: T): void {
  // Fast path: the check is a string compare, and `__proto__` is the only name that misbehaves.
  if (key === '__proto__') {
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    })
    return
  }
  target[key] = value
}
