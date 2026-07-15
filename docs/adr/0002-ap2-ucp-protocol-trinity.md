# ADR-0002: AP2/UCP/ACP Protocol Trinity

**Status:** Accepted
**Date:** 2026-07-13

## Context
The "Comercio Agéntico" study identifies 3 protocol families (AP2, UCP, ACP) as the foundation of agentic commerce. Without protocol support, ZIAY can't interoperate with external AI agents (Gemini, ChatGPT, Copilot).

## Decision
Implement all 3 protocols + MCP + A2A for full interoperability:
- **AP2:** 3 mandates (Intent, Cart, Payment) as W3C Verifiable Credentials signed with ed25519
- **UCP:** `/.well-known/ucp` manifest + 4 capabilities + checkout state machine
- **ACP:** `/.well-known/acp` manifest + checkout/order/refund endpoints
- **MCP:** JSON-RPC 2.0 endpoint exposing 4 tools
- **A2A:** `/.well-known/agent-card` for agent discovery

## Consequences
- **Positive:** Full interoperability with any AP2/UCP/ACP/MCP-compatible agent
- **Positive:** Cryptographic non-repudiation via ed25519 signatures
- **Negative:** Complex to maintain 5 protocol surfaces
- **Negative:** ed25519 key management adds operational complexity
- **Mitigation:** Keys stored in Setting table (dev) / KMS (prod), with automatic rotation planned
