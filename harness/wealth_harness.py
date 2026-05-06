#!/usr/bin/env python3
"""
WealthGuard Agent Harness.

Runs specialised Claude Code agents (defined in .claude/agents/*.md) against the
user's live financial data, records every run to the `agent_runs` table, and
extracts a severity (green/amber/red) from the output so the dashboard can
surface urgent items.

Usage:
    python wealth_harness.py --agent <name> [--prompt "..."]     # run one agent
    python wealth_harness.py --all                               # run every agent in registry
    python wealth_harness.py --schedule daily|hourly|weekly      # run only agents matching a schedule

Agents are registered in harness/agents.yaml. Defaults to a brief invocation
prompt unless overridden.
"""
from __future__ import annotations
import argparse
import json
import os
import re
import shlex
import sqlite3
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

REPO = Path('/Users/christopherhowell/WealthGuard')
DB = REPO / 'wealthguard_source' / 'wealthguard.db'
HARNESS_DIR = REPO / 'harness'
LOG_DIR = HARNESS_DIR / 'logs'
AGENTS_YAML = HARNESS_DIR / 'agents.yaml'
CLAUDE_BIN = Path('/Users/christopherhowell/.local/bin/claude')


def load_registry() -> dict:
    """Load agents.yaml. Minimal YAML subset parser (no dependency)."""
    if not AGENTS_YAML.exists():
        return {'agents': []}
    import yaml  # ships with most pythons? fall back if not.
    with open(AGENTS_YAML) as f:
        return yaml.safe_load(f)


def _conn():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn


def _severity_from(output: str) -> str:
    """Extract severity hint from agent output."""
    first_lines = (output or '')[:500].upper()
    if 'RED' in first_lines or '🚨' in first_lines:
        return 'red'
    if 'AMBER' in first_lines:
        return 'amber'
    if 'GREEN' in first_lines or 'OK' in first_lines[:200]:
        return 'green'
    return 'info'


def run_agent(agent_name: str, prompt: str | None = None) -> dict:
    """Invoke a named Claude Code agent with a prompt, capture output, log to DB."""
    prompt = prompt or f"Invoke the {agent_name} agent and return its full output."

    conn = _conn()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO agent_runs (agent_name, prompt, status) VALUES (?, ?, 'running')",
        (agent_name, prompt),
    )
    run_id = cur.lastrowid
    conn.commit()
    conn.close()

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / f"{agent_name}-{int(time.time())}.log"

    # Use `claude -p` for non-interactive mode with the target agent.
    cmd = [
        str(CLAUDE_BIN),
        '-p', prompt,
        '--agent', agent_name,
        '--output-format', 'text',
        '--permission-mode', 'acceptEdits',
    ]

    start = time.time()
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(REPO),
            capture_output=True,
            text=True,
            timeout=600,  # 10-min max per agent
        )
        stdout = proc.stdout or ''
        stderr = proc.stderr or ''
        status = 'completed' if proc.returncode == 0 else 'failed'
    except subprocess.TimeoutExpired as e:
        stdout = getattr(e, 'stdout', '') or ''
        stderr = f"TIMEOUT after 600s\n{getattr(e, 'stderr', '') or ''}"
        status = 'failed'
    except Exception as e:
        stdout = ''
        stderr = f"Harness error: {e}"
        status = 'failed'

    duration = time.time() - start
    severity = _severity_from(stdout)

    # Write to log file for debugging.
    log_path.write_text(
        f"AGENT: {agent_name}\nPROMPT: {prompt}\nDURATION: {duration:.1f}s\n"
        f"STATUS: {status}\nSEVERITY: {severity}\n\n"
        f"=== STDOUT ===\n{stdout}\n\n=== STDERR ===\n{stderr}\n"
    )

    conn = _conn()
    conn.execute(
        """UPDATE agent_runs
           SET status=?, severity=?, output=?, stderr=?, duration_seconds=?, completed_at=CURRENT_TIMESTAMP
           WHERE id=?""",
        (status, severity, stdout, stderr, duration, run_id),
    )
    conn.commit()
    conn.close()

    return {
        'id': run_id,
        'agent': agent_name,
        'status': status,
        'severity': severity,
        'duration_seconds': round(duration, 1),
        'log_path': str(log_path),
        'output_excerpt': stdout[:500],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--agent', help='Single agent name to run')
    ap.add_argument('--prompt', help='Override the default invocation prompt')
    ap.add_argument('--all', action='store_true', help='Run every registered agent')
    ap.add_argument('--schedule', choices=('hourly', 'daily', 'weekly'),
                    help='Run only agents matching this schedule')
    args = ap.parse_args()

    registry = load_registry()
    agents = registry.get('agents', [])

    if args.agent:
        selected = [{'name': args.agent, 'prompt': args.prompt}]
    elif args.all:
        selected = agents
    elif args.schedule:
        selected = [a for a in agents if a.get('schedule') == args.schedule]
    else:
        ap.error('Specify --agent, --all, or --schedule')

    if not selected:
        print('No agents to run.')
        return 0

    print(f"[harness] running {len(selected)} agent(s)...")
    results = []
    for cfg in selected:
        name = cfg['name']
        prompt = cfg.get('prompt') or args.prompt
        print(f"  → {name}")
        res = run_agent(name, prompt)
        results.append(res)
        print(f"    {res['severity']} · {res['status']} · {res['duration_seconds']}s · run_id={res['id']}")

    print(json.dumps(results, indent=2, default=str))
    # Exit non-zero if any red — cron can email on non-zero
    return 1 if any(r['severity'] == 'red' for r in results) else 0


if __name__ == '__main__':
    sys.exit(main())
