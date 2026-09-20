#!/usr/bin/env python3
"""Print selected values from a JSON document on stdin.

Each argument is a dotted path, e.g. `audience.sendable` or `templates.0.body`.
A path crossing a list without an index collects that key from every element.

Exists as a file rather than an inline `python3 -c` because the verification scripts
pipe JSON on stdin: a heredoc would itself occupy stdin and shadow the piped body.
"""
import json
import sys


def resolve(data, path):
    current = data
    for part in path.split('.'):
        if isinstance(current, list):
            if part.isdigit():
                index = int(part)
                # Out-of-range is a legitimate outcome when a list is empty (e.g. a
                # campaign with no templates), so report it rather than crashing.
                current = current[index] if index < len(current) else None
            else:
                current = [
                    item.get(part) if isinstance(item, dict) else None for item in current
                ]
        elif isinstance(current, dict):
            current = current.get(part)
        else:
            return None
    return current


def main():
    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError:
        print('(no JSON body)')
        return 1

    paths = sys.argv[1:]
    if not paths:
        print(json.dumps(data))
        return 0

    parts = []
    for path in paths:
        value = resolve(data, path)
        parts.append(f"{path.split('.')[-1]}={value}")
    print('  '.join(parts))
    return 0


if __name__ == '__main__':
    sys.exit(main())
