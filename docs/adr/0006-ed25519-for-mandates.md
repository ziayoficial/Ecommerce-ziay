# ADR-0006: ed25519 for AP2 Mandate Signing

**Status:** Accepted
**Date:** 2026-07-13

## Context
AP2 mandates require cryptographic signing for non-repudiation. Options: RSA, ECDSA, ed25519. Need to choose one.

## Decision
Use ed25519 for all AP2 mandate signing. Keys generated per-tenant, stored as PEM in Setting table (dev) or KMS (prod). Signatures use `Ed25519Signature2020` proof type per W3C VC spec.

## Consequences
- **Positive:** ed25519 is fast (sign/verify ~50μs), small keys (32 bytes), and deterministic
- **Positive:** `Ed25519Signature2020` is a W3C standard proof type
- **Negative:** Not all KMS providers support ed25519 (AWS KMS does, GCP KMS doesn't)
- **Negative:** Node's `crypto.sign(null, ...)` API is not obvious (null algorithm for ed25519)
