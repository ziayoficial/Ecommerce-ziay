// Unit tests for src/lib/middleware/sanitize.ts
// SPRINT-DOCS-TESTS-FINAL-001 · §3.
//
// Coverage:
//   - sanitizeString: trim, null-byte strip, length cap, non-string coercion,
//     preservation of i18n / special characters.
//   - sanitizeObject: recursive string sanitization, nested object traversal,
//     array handling, prototype-pollution defense (drops __proto__ /
//     constructor / prototype keys), array length cap (MAX_ARRAY_LENGTH=100),
//     depth cutoff (depth > 10 returns obj unchanged to prevent stack
//     overflow on adversarial nesting).
//   - sanitizeParsed: thin wrapper around sanitizeObject for Zod-parsed
//     bodies.

import { describe, it, expect } from 'vitest'
import { sanitizeString, sanitizeObject, sanitizeParsed } from '@/lib/middleware/sanitize'

describe('sanitizeString', () => {
  it('trims whitespace', () => {
    expect(sanitizeString('  hello  ')).toBe('hello')
  })

  it('strips null bytes', () => {
    expect(sanitizeString('hello\0world')).toBe('helloworld')
  })

  it('truncates to max length', () => {
    expect(sanitizeString('a'.repeat(100), 10)).toBe('a'.repeat(10))
  })

  it('handles non-string input', () => {
    expect(sanitizeString(null as any)).toBe('')
    expect(sanitizeString(undefined as any)).toBe('')
    expect(sanitizeString(123 as any)).toBe('')
  })

  it('preserves special characters', () => {
    expect(sanitizeString('café Bogotá @123')).toBe('café Bogotá @123')
  })

  it('handles empty strings', () => {
    expect(sanitizeString('')).toBe('')
    expect(sanitizeString('   ')).toBe('')
  })

  it('strips multiple consecutive null bytes', () => {
    expect(sanitizeString('a\0\0\0b')).toBe('ab')
    expect(sanitizeString('\0\0\0')).toBe('')
  })
})

describe('sanitizeObject', () => {
  it('sanitizes all string values in an object', () => {
    const input = { name: '  John  ', email: 'john@test.com\0' }
    const result = sanitizeObject(input)
    expect(result.name).toBe('John')
    expect(result.email).toBe('john@test.com')
  })

  it('handles nested objects', () => {
    const input = { user: { name: '  John  ' }, meta: { note: '\0test' } }
    const result = sanitizeObject(input)
    expect(result.user.name).toBe('John')
    expect(result.meta.note).toBe('test')
  })

  it('handles arrays', () => {
    const input = { items: ['  a  ', '  b  ', '  c  '] }
    const result = sanitizeObject(input)
    expect(result.items).toEqual(['a', 'b', 'c'])
  })

  it('prevents prototype pollution', () => {
    // JSON.parse creates __proto__ as an OWN data property (not via the
    // Object.prototype.__proto__ setter), so the parsed object's actual
    // prototype remains Object.prototype. The sanitizer must drop the
    // __proto__ key so it can't be re-read downstream as an own property.
    const input = JSON.parse('{"__proto__": {"isAdmin": true}, "name": "test"}')
    const result = sanitizeObject(input)
    // The __proto__ own-property key was filtered out by the sanitizer.
    expect(Object.getOwnPropertyDescriptor(result, '__proto__')).toBeUndefined()
    expect(Object.keys(result)).not.toContain('__proto__')
    // The global Object.prototype is NOT polluted — fresh objects do not
    // inherit an `isAdmin` field from the parsed payload.
    expect(({} as any).isAdmin).toBeUndefined()
  })

  it('blocks constructor and prototype keys', () => {
    // `constructor` is an own property here (overriding Object.prototype's
    // `constructor` which points to `Object`). The sanitizer must drop it
    // so an attacker can't smuggle `constructor.prototype` mutations
    // through the sanitization layer.
    const input = { constructor: { prototype: { evil: true } }, name: 'test' }
    const result = sanitizeObject(input)
    // The constructor own-property key was filtered out. Note: reading
    // `result.constructor` directly would still resolve via the prototype
    // chain to `Object` (the global Object constructor), so the correct
    // assertion is on the own-property descriptor.
    expect(Object.getOwnPropertyDescriptor(result, 'constructor')).toBeUndefined()
    expect(Object.keys(result)).not.toContain('constructor')
    expect(result.name).toBe('test')
  })

  it('handles null and undefined', () => {
    expect(sanitizeObject(null)).toBeNull()
    expect(sanitizeObject(undefined)).toBeUndefined()
  })

  it('handles non-object types', () => {
    expect(sanitizeObject(42)).toBe(42)
    expect(sanitizeObject(true)).toBe(true)
  })

  it('limits array length', () => {
    const input = { items: new Array(200).fill('item') }
    const result = sanitizeObject(input)
    expect(result.items.length).toBeLessThanOrEqual(100)
  })

  it('prevents deep recursion', () => {
    // Create a 21-level-deep nested object. The sanitizer's `depth > 10`
    // cutoff returns the obj unchanged at depth 11, preventing stack
    // overflow on adversarial nesting. The result is still defined (the
    // outer object is recursed into up to depth 10; deeper levels are
    // passed through as-is).
    let obj: any = { value: 'deep' }
    for (let i = 0; i < 20; i++) {
      obj = { nested: obj }
    }
    // Should not stack overflow
    const result = sanitizeObject(obj)
    expect(result).toBeDefined()
  })
})

describe('sanitizeParsed', () => {
  it('sanitizes Zod-parsed data', () => {
    const data = { name: '  John  ', email: '  john@test.com  ' }
    const result = sanitizeParsed(data)
    expect(result.name).toBe('John')
    expect(result.email).toBe('john@test.com')
  })
})
