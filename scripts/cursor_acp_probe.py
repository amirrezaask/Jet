#!/usr/bin/env python3
"""Opt-in Cursor ACP capability probe (stdio JSON-RPC).

Usage:
  python3 scripts/cursor_acp_probe.py [--cwd PATH] [--prompt TEXT]

Requires `cursor-agent` or `agent` on PATH and an authenticated Cursor CLI login.
Exit 0 on successful initialize + session/new (+ optional prompt). Writes JSON summary to stdout.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any


def find_cursor_bin() -> str:
    for name in ("cursor-agent", "agent"):
        path = shutil.which(name)
        if path:
            return path
    raise SystemExit("cursor-agent/agent not found on PATH")


class AcpClient:
    def __init__(self, proc: subprocess.Popen[str]) -> None:
        self.proc = proc
        self._next_id = 1
        self._pending: dict[int, dict[str, Any]] = {}
        self._lock = threading.Lock()
        self.notifications: list[dict[str, Any]] = []
        self.capabilities: dict[str, Any] | None = None
        assert proc.stdout is not None
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()

    def _read_loop(self) -> None:
        assert self.proc.stdout is not None
        for line in self.proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if "id" in msg and ("result" in msg or "error" in msg):
                with self._lock:
                    self._pending[int(msg["id"])] = msg
            else:
                self.notifications.append(msg)
                # Auto-respond to permission / ask_question with cancel-ish defaults if needed later.

    def request(self, method: str, params: dict[str, Any] | None = None, timeout: float = 120.0) -> Any:
        req_id = self._next_id
        self._next_id += 1
        payload = {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params or {}}
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(payload) + "\n")
        self.proc.stdin.flush()
        deadline = time.time() + timeout
        while time.time() < deadline:
            with self._lock:
                if req_id in self._pending:
                    msg = self._pending.pop(req_id)
                    if "error" in msg:
                        raise RuntimeError(f"{method} error: {msg['error']}")
                    return msg.get("result")
            time.sleep(0.05)
        raise TimeoutError(f"{method} timed out after {timeout}s")

    def notify(self, method: str, params: dict[str, Any] | None = None) -> None:
        payload = {"jsonrpc": "2.0", "method": method, "params": params or {}}
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(payload) + "\n")
        self.proc.stdin.flush()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cwd", default=str(Path.cwd()))
    parser.add_argument("--prompt", default="")
    parser.add_argument("--bin", default="")
    args = parser.parse_args()

    binary = args.bin or find_cursor_bin()
    cwd = str(Path(args.cwd).resolve())

    proc = subprocess.Popen(
        [binary, "acp"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=cwd,
        env=os.environ.copy(),
    )
    client = AcpClient(proc)
    summary: dict[str, Any] = {"binary": binary, "cwd": cwd}

    try:
        init = client.request(
            "initialize",
            {
                "protocolVersion": 1,
                "clientCapabilities": {
                    "_meta": {"parameterizedModelPicker": True},
                    "fs": {"readTextFile": True, "writeTextFile": True},
                    "terminal": True,
                },
                "clientInfo": {"name": "gharargah-probe", "version": "0.0.0"},
            },
        )
        summary["initialize"] = {
            "protocolVersion": init.get("protocolVersion"),
            "agentCapabilities": init.get("agentCapabilities"),
            "authMethods": init.get("authMethods"),
            "agentInfo": init.get("agentInfo"),
        }
        client.capabilities = init.get("agentCapabilities")

        session = client.request("session/new", {"cwd": cwd, "mcpServers": []})
        summary["session"] = {
            "sessionId": session.get("sessionId"),
            "modes": session.get("modes"),
            "configOptions": session.get("configOptions"),
        }

        if args.prompt:
            prompt_result = client.request(
                "session/prompt",
                {
                    "sessionId": session["sessionId"],
                    "prompt": [{"type": "text", "text": args.prompt}],
                },
                timeout=180.0,
            )
            summary["prompt"] = prompt_result

        # Best-effort Cursor extension
        try:
            models = client.request("cursor/list_available_models", {})
            summary["cursorModels"] = models
        except Exception as exc:  # noqa: BLE001
            summary["cursorModelsError"] = str(exc)

        print(json.dumps(summary, indent=2))
        return 0
    except Exception as exc:  # noqa: BLE001
        stderr = ""
        if proc.stderr is not None:
            try:
                stderr = proc.stderr.read()
            except Exception:  # noqa: BLE001
                pass
        print(json.dumps({"error": str(exc), "stderr": stderr[-4000:], "partial": summary}, indent=2))
        return 1
    finally:
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:  # noqa: BLE001
            proc.kill()


if __name__ == "__main__":
    raise SystemExit(main())
