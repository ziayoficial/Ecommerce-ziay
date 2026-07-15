#!/usr/bin/env python3
"""SPRINT-ADAPTERS-DOCS-FINAL-001 §4 — Add 4XX responses to all OpenAPI operations.

For each operation (get/post/put/patch/delete) under `paths:` that has a
`responses:` block, ensure '400', '401', '403' are present. Missing ones are
added as `$ref: '#/components/responses/BadRequest'` (etc.) to match the
existing convention used in the spec.

Public endpoints (security: []) get only '400' (no 401/403 — they don't auth).
Auth-protected endpoints get all three.

Webhook endpoints (already authed via HMAC signature, not bearer session) get
only '400' to avoid suggesting they accept standard auth headers.

Preserves comments + formatting via ruamel.yaml round-trip.
"""
from __future__ import annotations
import sys
from pathlib import Path
from ruamel.yaml import YAML

OPENAPI_PATH = Path('/home/z/my-project/docs/openapi.yaml')

yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 120  # keep long lines on one line (matches existing style)

doc = yaml.load(OPENAPI_PATH.read_text(encoding='utf-8'))

paths = doc.get('paths')
if not paths:
    print('ERROR: no paths in openapi.yaml', file=sys.stderr)
    sys.exit(1)

HTTP_METHODS = ('get', 'post', 'put', 'patch', 'delete')

# Operations whose responses should NOT get 401/403 — they're either:
# - public (security: []) — no auth, so 401/403 don't apply
# - webhook receivers — auth is HMAC signature in headers, not bearer/session
PUBLIC_PATH_PREFIXES = (
    '/api/health',           # public health probes
    '/api/webhooks/',        # webhook receivers (HMAC auth)
    '/api/public/',          # public catalog/tenant lookups
    '/api/monitoring/alertmanager-webhook',  # bearer secret, not sessionAuth
    '/api/compliance/retention/cron',  # cronAuth (bearer secret)
    '/api/auth/',            # NextAuth callback endpoints
    '/api/docs',             # public OpenAPI YAML route
    '/api/ucp/v1/checkout',  # public UCP checkout (uses paymentToken)
    '/api/ucp/v1/identity-linking',  # public identity linking
    '/api/acp/v1/checkout',  # public ACP checkout
)

ORDER = ['200', '201', '202', '204', '400', '401', '403', '404', '409', '422', '429', '500', '503']


def reorder_responses(responses):
    """Reorder response keys numerically. ruamel's CommentedMap preserves
    insertion order, so we rebuild it.
    """
    existing = list(responses.keys())
    known = [k for k in ORDER if k in existing]
    unknown = [k for k in existing if k not in ORDER]
    items = [(k, responses[k]) for k in (known + unknown)]
    for k in list(responses.keys()):
        del responses[k]
    for k, v in items:
        responses[k] = v


stats = {
    'operations_total': 0,
    'operations_modified': 0,
    'responses_added': {'400': 0, '401': 0, '403': 0},
    'public_skipped': 0,
}

for path, path_item in paths.items():
    if not isinstance(path_item, dict):
        continue
    for method in HTTP_METHODS:
        op = path_item.get(method)
        if not isinstance(op, dict):
            continue
        if 'responses' not in op:
            continue  # malformed op — skip
        stats['operations_total'] += 1

        # Determine if this is a public/webhook endpoint (only 400, no 401/403)
        is_public = any(path.startswith(p) for p in PUBLIC_PATH_PREFIXES)
        # Even if path matches public prefix, check op-level security: []
        if op.get('security') == []:
            is_public = True

        responses = op['responses']
        modified = False

        # 400 — applies to all operations (validation can fail anywhere)
        if '400' not in responses and '400' not in responses:
            responses['400'] = {'$ref': '#/components/responses/BadRequest'}
            stats['responses_added']['400'] += 1
            modified = True

        if not is_public:
            if '401' not in responses and '401' not in responses:
                responses['401'] = {'$ref': '#/components/responses/Unauthorized'}
                stats['responses_added']['401'] += 1
                modified = True
            if '403' not in responses and '403' not in responses:
                responses['403'] = {'$ref': '#/components/responses/Forbidden'}
                stats['responses_added']['403'] += 1
                modified = True
        else:
            stats['public_skipped'] += 1

        if modified:
            stats['operations_modified'] += 1

        # Reorder this op's responses to keep numeric ordering
        reorder_responses(responses)

# Write back
yaml.dump(doc, OPENAPI_PATH)

# Post-pass: remove blank lines between consecutive response entries
# (ruamel preserves original blank lines that sat AFTER the last pre-existing
# response code; when we append a new response key after it, the blank ends up
# BETWEEN two response entries instead of before the next path/operation).
import re
text = OPENAPI_PATH.read_text(encoding='utf-8')
lines = text.split('\n')
out = []
removed = 0
i = 0
RESP_KEY_RE = re.compile(r"^        '\d{3}':")
while i < len(lines):
    out.append(lines[i])
    if RESP_KEY_RE.match(lines[i]):
        # Consume value lines (10+ spaces, non-blank) — append them all.
        j = i + 1
        while j < len(lines) and lines[j].startswith('          ') and lines[j].strip() != '':
            out.append(lines[j])
            j += 1
        # Consume any blank lines.
        blanks_start = j
        while j < len(lines) and lines[j].strip() == '':
            j += 1
        blanks_end = j
        # If the next non-blank line is another response key, drop the blanks.
        if j < len(lines) and RESP_KEY_RE.match(lines[j]):
            removed += (blanks_end - blanks_start)
            i = j
            continue
        # Otherwise the blanks separated this entry from the next path/op —
        # preserve them.
        for k in range(blanks_start, blanks_end):
            out.append(lines[k])
        i = blanks_end
        continue
    i += 1
OPENAPI_PATH.write_text('\n'.join(out), encoding='utf-8')

print(f"OK {stats['operations_total']} operations scanned")
print(f"OK {stats['operations_modified']} operations modified")
print(f"OK Responses added: 400={stats['responses_added']['400']}, "
      f"401={stats['responses_added']['401']}, 403={stats['responses_added']['403']}")
print(f"OK {stats['public_skipped']} public/webhook ops skipped 401/403")
print(f"OK Cleaned {removed} blank lines between consecutive response entries")
