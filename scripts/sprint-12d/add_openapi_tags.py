#!/usr/bin/env python3
"""
Add ReDoc grouping tags to every operation in docs/openapi.yaml.

Strategy:
  1. Inject a top-level `tags:` block right before `servers:` (after `info:`).
  2. For each path operation (`get:`, `post:`, `patch:`, `put:`, `delete:`
     at 4-space indent directly under a path key at 2-space indent), insert
     `      tags: [TagName]` immediately after the operation keyword, unless
     the next non-blank line already starts with `      tags:`.
"""
import re
import sys
from pathlib import Path

SRC = Path("/home/z/my-project/docs/openapi.yaml")

TAGS_BLOCK = """tags:
  - name: Auth
    description: Authentication endpoints
  - name: Overview
    description: Dashboard overview + KPIs
  - name: Orders
    description: Order management
  - name: Conversations
    description: WhatsApp/Messenger conversations
  - name: Catalog
    description: Product catalog
  - name: Ads
    description: Ad attribution + management
  - name: Monetization
    description: Commission + invoicing
  - name: Wallet
    description: Trafficker wallet + withdrawals
  - name: Logistics
    description: Shipping + tracking
  - name: Novedades
    description: Post-sale incidents
  - name: Marketplace
    description: Cross-brand marketplace
  - name: Channels
    description: WhatsApp/Messenger/Instagram channels
  - name: Agents
    description: AI agent execution
  - name: Protocols
    description: AP2/UCP/ACP/MCP/A2A protocol endpoints
  - name: Compliance
    description: KYC + consent + retention + DIAN + retracto
  - name: Governance
    description: Mandates + escalations + decisions
  - name: Finance
    description: LLM costs + channel contribution
  - name: Monitoring
    description: Health + metrics + status
  - name: Webhooks
    description: Payment + messaging webhook receivers
  - name: Public
    description: Public endpoints (no auth)

"""

# Order matters: more specific prefixes must be checked before generic ones.
RULES = [
    (r"^/api/auth(?:/.*)?$", "Auth"),
    (r"^/api/overview$", "Overview"),
    (r"^/api/orders(?:/.*)?$", "Orders"),
    (r"^/api/conversations(?:/.*)?$", "Conversations"),
    (r"^/api/catalog(?:/.*)?$", "Catalog"),
    (r"^/api/product-enrichment$", "Catalog"),
    (r"^/api/ads(?:/.*)?$", "Ads"),
    (r"^/api/conversions$", "Ads"),
    (r"^/api/monetization(?:/.*)?$", "Monetization"),
    (r"^/api/payments(?:/.*)?$", "Monetization"),
    (r"^/api/wallet$", "Wallet"),
    (r"^/api/trafficker$", "Wallet"),
    (r"^/api/shipping(?:/.*)?$", "Logistics"),
    (r"^/api/guide-movements$", "Logistics"),
    (r"^/api/logistics-intelligence$", "Logistics"),
    (r"^/api/novedades(?:/.*)?$", "Novedades"),
    (r"^/api/redelivery$", "Novedades"),
    (r"^/api/marketplace$", "Marketplace"),
    (r"^/api/channels$", "Channels"),
    (r"^/api/integrations/credentials$", "Channels"),
    (r"^/api/agents(?:/.*)?$", "Agents"),
    (r"^/api/orchestrate$", "Agents"),
    (r"^/api/ai-reply$", "Agents"),
    (r"^/api/remarketing$", "Agents"),
    (r"^/api/buyer-behavior$", "Agents"),
    (r"^/api/ap2(?:/.*)?$", "Protocols"),
    (r"^/api/ucp(?:/.*)?$", "Protocols"),
    (r"^/api/acp(?:/.*)?$", "Protocols"),
    (r"^/api/mcp$", "Protocols"),
    (r"^/\.well-known(?:/.*)?$", "Protocols"),
    (r"^/api/compliance(?:/.*)?$", "Compliance"),
    (r"^/api/governance(?:/.*)?$", "Governance"),
    (r"^/api/audit(?:/.*)?$", "Governance"),
    (r"^/api/llm(?:/.*)?$", "Finance"),
    (r"^/api/finance(?:/.*)?$", "Finance"),
    (r"^/api/health(?:/.*)?$", "Monitoring"),
    (r"^/api/metrics$", "Monitoring"),
    (r"^/api/status(?:/.*)?$", "Monitoring"),
    (r"^/api/monitoring(?:/.*)?$", "Monitoring"),
    (r"^/api/analytics/web-vitals$", "Monitoring"),
    (r"^/api/notifications$", "Monitoring"),
    (r"^/api$", "Monitoring"),
    (r"^/api/webhooks(?:/.*)?$", "Webhooks"),
    (r"^/api/public(?:/.*)?$", "Public"),
    (r"^/api/tenants$", "Public"),
]

OP_RE = re.compile(r"^    (get|post|patch|put|delete):\s*$")
PATH_RE = re.compile(r"^  (/\S.*?):\s*$")


def tag_for_path(path: str) -> str:
    for pattern, tag in RULES:
        if re.match(pattern, path):
            return tag
    raise ValueError(f"No tag rule matches path: {path!r}")


def main() -> int:
    text = SRC.read_text()
    lines = text.splitlines(keepends=False)

    # 1. Strip any pre-existing top-level `tags:` block (the original file
    #    had a smaller, less-detailed one at the very end). We drop the
    #    `tags:` keyword and every consecutive line whose indentation is
    #    deeper than 0, until we hit a line at column 0 (or EOF).
    cleaned: list[str] = []
    i = 0
    while i < len(lines):
        ln = lines[i]
        if ln.strip() == "tags:" and not ln.startswith((" ", "\t")):
            # Skip the `tags:` line + all subsequent `  - ...` / `    ...`
            # entries that belong to it (any non-empty line starting with
            # whitespace).
            i += 1
            while i < len(lines):
                if lines[i].strip() == "":
                    # Tentatively skip; only commit if the next non-blank
                    # line is also indented (still part of the block).
                    j = i + 1
                    while j < len(lines) and lines[j].strip() == "":
                        j += 1
                    if j < len(lines) and lines[j].startswith((" ", "\t")):
                        i = j
                        continue
                    break
                if lines[i].startswith((" ", "\t")):
                    i += 1
                    continue
                break
            continue
        cleaned.append(ln)
        i += 1
    lines = cleaned

    # 2. Inject the new tags block right before `servers:`.
    servers_idx = next(
        i for i, ln in enumerate(lines) if ln.strip() == "servers:"
    )
    tags_lines = TAGS_BLOCK.rstrip("\n").split("\n")
    lines = lines[:servers_idx] + tags_lines + [""] + lines[servers_idx:]

    # 3. Walk paths + operations, inserting `tags: [Tag]` after each op.
    out: list[str] = []
    current_path: str | None = None
    current_tag: str | None = None
    op_seen_count = 0

    i = 0
    while i < len(lines):
        ln = lines[i]

        path_m = PATH_RE.match(ln)
        if path_m:
            current_path = path_m.group(1)
            try:
                current_tag = tag_for_path(current_path)
            except ValueError as e:
                print(f"[warn] {e}", file=sys.stderr)
                current_tag = None
            out.append(ln)
            i += 1
            continue

        op_m = OP_RE.match(ln)
        if op_m and current_tag is not None:
            out.append(ln)
            j = i + 1
            while j < len(lines) and lines[j].strip() == "":
                j += 1
            next_is_tags = (
                j < len(lines)
                and lines[j].lstrip().startswith("tags:")
            )
            if not next_is_tags:
                out.append(f"      tags: [{current_tag}]")
                op_seen_count += 1
            i += 1
            continue

        out.append(ln)
        i += 1

    SRC.write_text("\n".join(out) + "\n")
    print(f"[ok] Inserted tags: block + tagged {op_seen_count} operations.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
