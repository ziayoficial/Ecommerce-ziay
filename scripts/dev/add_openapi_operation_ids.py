#!/usr/bin/env python3
"""Add operationId to each OpenAPI operation, preserving comments/formatting.

Used by Sprint 13B (SPRINT-OPENAPI-FINAL-001). Run once; idempotent.
"""
import re
import sys
from ruamel.yaml import YAML

PATH = '/home/z/my-project/docs/openapi.yaml'

# Method → prefix map (matches task spec)
METHOD_PREFIX = {
    'get': 'get',
    'post': 'create',
    'patch': 'update',
    'put': 'replace',
    'delete': 'delete',
}


def to_operation_id(method: str, path: str) -> str:
    """Generate operationId from method + path using the task pattern.

    Sanitizes special path characters so the result is a valid OpenAPI
    operationId (letters, digits, underscores only — must match
    `^[A-Za-z0-9_]+$` per Redocly / OAS Codegen tooling).
    """
    p = path.replace('/.well-known/', '/')
    p = p.replace('/api/', '/')
    p = p.lstrip('/')
    # {param} → ByParam (capitalize the captured param name so {id} → ById,
    # {agentName} → ByAgentName, etc.)
    p = re.sub(r'\{(\w+)\}', lambda m: 'By' + m.group(1)[:1].upper() + m.group(1)[1:], p)
    # Next.js catch-all [...slug] → Slug
    p = re.sub(r'\[\.\.\.(\w+)\]', lambda m: m.group(1), p)
    # Next.js dynamic [slug] → slug
    p = re.sub(r'\[(\w+)\]', lambda m: m.group(1), p)
    # Treat hyphens as path-segment separators (so "ai-reply" → "ai_reply")
    p = p.replace('-', '_')
    p = p.replace('/', '_')
    # Drop any remaining non-alphanumeric chars
    p = re.sub(r'[^A-Za-z0-9_]+', '', p)
    p = re.sub(r'_+', '_', p)
    p = p.strip('_')
    parts = p.split('_') if p else []
    # camelCase: first part lowercase, rest capitalized
    camel = parts[0] + ''.join(x[:1].upper() + x[1:] for x in parts[1:]) if parts else ''
    prefix = METHOD_PREFIX.get(method.lower(), method.lower())
    if not camel:
        return prefix
    return f"{prefix}{camel[0].upper()}{camel[1:]}"


def main():
    yaml = YAML()
    yaml.preserve_quotes = True
    yaml.width = 120
    yaml.indent(mapping=2, sequence=4, offset=2)

    with open(PATH, 'r') as f:
        spec = yaml.load(f)

    paths = spec.get('paths')
    if not paths:
        print('No paths found', file=sys.stderr)
        sys.exit(1)

    added = 0
    skipped = 0
    for path_key, path_item in paths.items():
        if not isinstance(path_item, dict):
            continue
        for method, operation in path_item.items():
            if method not in METHOD_PREFIX:
                continue
            if not isinstance(operation, dict):
                continue
            if 'operationId' in operation:
                skipped += 1
                continue
            op_id = to_operation_id(method, path_key)
            new_op = {}
            new_op['operationId'] = op_id
            for k, v in operation.items():
                new_op[k] = v
            path_item[method] = new_op
            added += 1

    with open(PATH, 'w') as f:
        yaml.dump(spec, f)

    print(f'Added operationId to {added} operations, skipped {skipped} (already had one)')


if __name__ == '__main__':
    main()
