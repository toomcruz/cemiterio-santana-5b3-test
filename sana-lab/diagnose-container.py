#!/usr/bin/env python3
"""Read only permitted Docker fields; reduce untrusted startup logs to safe markers.

Invoked by the reviewed, root-owned deploy procedure before removing a failed
LAB container. Never print a raw log line, Docker error or host mount source.
"""
import json
import re
import subprocess
import sys

name, expected_sha, expected_image, stage = sys.argv[1:]
if not re.fullmatch(r"[0-9a-f]{40}", expected_sha) or name != "sana-lab-bridge":
    raise SystemExit(2)


def docker(*args):
    return subprocess.run(["docker", *args], capture_output=True, text=True,
                          timeout=8, check=True).stdout.strip()


fields = {
    "image": "{{.Config.Image}}",
    "commit": '{{index .Config.Labels "org.opencontainers.image.revision"}}',
}
try:
    identity = {key: docker("inspect", name, "--format", fmt)
                for key, fmt in fields.items()}
except (subprocess.SubprocessError, OSError):
    print(f"DIAGNOSTIC_SHA={expected_sha}")
    print(f"FAILED_IMAGE={expected_image}")
    print("CONTAINER_STATE=NOT_CREATED")
    raise SystemExit(0)

# Never interrogate another image (including the old backup renamed on failure).
if identity != {"image": expected_image, "commit": expected_sha}:
    print(f"DIAGNOSTIC_SHA={expected_sha}")
    print("CONTAINER_IDENTITY_MISMATCH")
    raise SystemExit(2)

formats = {
    "CONTAINER_STATUS": "{{.State.Status}}",
    "CONTAINER_EXIT_CODE": "{{.State.ExitCode}}",
    "CONTAINER_RESTART_COUNT": "{{.RestartCount}}",
    "CONTAINER_OOM_KILLED": "{{.State.OOMKilled}}",
    "CONTAINER_STATE_ERROR": "{{.State.Error}}",
    "CONTAINER_FINISHED_AT": "{{.State.FinishedAt}}",
    "CONTAINER_STARTED_AT": "{{.State.StartedAt}}",
    "CONTAINER_HEALTH": "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}",
    "CMD": "{{json .Config.Cmd}}",
    "ENTRYPOINT": "{{json .Config.Entrypoint}}",
    "USER": "{{.Config.User}}",
    "READ_ONLY": "{{.HostConfig.ReadonlyRootfs}}",
    "MOUNTS": "{{range .Mounts}}{{.Destination}}:{{.Type}}:{{.RW}};{{end}}",
    "NETWORK": "{{range $k,$v := .NetworkSettings.Networks}}{{$k}};{{end}}",
    "PORT_BINDINGS": "{{json .HostConfig.PortBindings}}",
}


def enum(value, choices):
    return value if value in choices else "UNEXPECTED"


def number(value):
    return value if re.fullmatch(r"[0-9]{1,10}", value) else "UNEXPECTED"


def classify_error(value):
    if not value:
        return "NONE"
    for word in ("permission denied", "read-only file system", "no such file",
                 "not a directory", "invalid mount", "out of memory"):
        if word in value.lower():
            return word.upper().replace(" ", "_").replace("-", "_")
    return "PRESENT_REDACTED"


def timestamp(value):
    return value if re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z", value) else "UNEXPECTED"


def executable(value):
    try:
        items = json.loads(value)
    except (TypeError, ValueError):
        return "INVALID"
    if not isinstance(items, list):
        return "NONE" if items is None else "REDACTED"
    allowed = {"deno", "run", "serve", "task", "/app/sana-lab/bridge.ts",
               "/app/sana-lab/start.ts"}
    return ",".join(item if isinstance(item, str) and item in allowed else "ARG_REDACTED"
                    for item in items[:12])


def mounts(value):
    allowed = {"/lab-state", "/run/secrets/sana_lab_token"}
    entries = []
    for entry in value.split(";"):
        if not entry:
            continue
        parts = entry.rsplit(":", 2)
        if len(parts) != 3:
            entries.append("UNEXPECTED")
            continue
        target, kind, rw = parts
        target = target if target in allowed else "OTHER_REDACTED"
        entries.append(f"{target}:{enum(kind, {'bind', 'volume', 'tmpfs'})}:{enum(rw, {'true', 'false'})}")
    return ",".join(entries) if entries else "NONE"


error_types = re.compile(
    r"\b(NotCapable|PermissionDenied|TypeError|SyntaxError|ReferenceError|"
    r"ModuleNotFound|InvalidData|NotFound|EACCES|ENOENT|OOM|Error)\b"
)
paths = re.compile(r"/app/(?:[A-Za-z0-9_./-]+)\.tsx?(?::[0-9]{1,6}){0,2}")


def sanitize_log(line):
    """Output only fixed markers and code paths, never a quoted/logged value."""
    markers = []
    error = error_types.search(line)
    if error:
        markers.append(f"ERROR={error.group(1)}")
    lower = line.lower()
    for key, needle in (
        ("READ_ACCESS", "requires read access"),
        ("WRITE_ACCESS", "requires write access"),
        ("ENV_ACCESS", "requires env access"),
        ("NET_ACCESS", "requires net access"),
        ("MODULE_NOT_FOUND", "module not found"),
        ("FILE_NOT_FOUND", "no such file"),
        ("READ_ONLY", "read-only file system"),
        ("PERMISSION_DENIED", "permission denied"),
        ("OUT_OF_MEMORY", "out of memory"),
        ("UNCAUGHT", "uncaught"),
    ):
        if needle in lower:
            markers.append(key)
    known_files = {"start.ts", "engine.ts", "bridge.ts", "recadastro.ts",
                   "concessao_titularidade.ts"}
    app_paths = []
    for match in paths.finditer(line):
        candidate = match.group()
        filename = candidate.split("/")[-1].split(":")[0]
        app_paths.append(candidate if filename in known_files else "OTHER_REDACTED")
    if app_paths:
        markers.append("APP_PATH=" + ",".join(app_paths[:2]))
    if "/lab-state" in line:
        markers.append("LAB_STATE_PATH")
    if "/run/secrets/sana_lab_token" in line:
        markers.append("LAB_SECRET_PATH")
    return " ".join(markers) if markers else "REDACTED"


print(f"DIAGNOSTIC_SHA={expected_sha}")
print(f"FAILED_IMAGE={expected_image}")
print(f"DEPLOY_FAILED_STAGE={enum(stage, {'START_NEW', 'VERIFY_NEW', 'SYNTHETIC_FAILURE', 'RECORD_ACTIVE'})}")
try:
    values = {key: docker("inspect", name, "--format", fmt)
              for key, fmt in formats.items()}
except (subprocess.SubprocessError, OSError):
    print("INSPECT_FAILED")
    raise SystemExit(2)

print(f"CONTAINER_STATUS={enum(values['CONTAINER_STATUS'], {'created', 'running', 'restarting', 'exited', 'dead', 'paused'})}")
print(f"CONTAINER_EXIT_CODE={number(values['CONTAINER_EXIT_CODE'])}")
print(f"CONTAINER_RESTART_COUNT={number(values['CONTAINER_RESTART_COUNT'])}")
print(f"CONTAINER_OOM_KILLED={enum(values['CONTAINER_OOM_KILLED'], {'true', 'false'})}")
print(f"CONTAINER_STATE_ERROR={classify_error(values['CONTAINER_STATE_ERROR'])}")
print(f"CONTAINER_FINISHED_AT={timestamp(values['CONTAINER_FINISHED_AT'])}")
print(f"CONTAINER_STARTED_AT={timestamp(values['CONTAINER_STARTED_AT'])}")
print(f"CONTAINER_HEALTH={enum(values['CONTAINER_HEALTH'], {'none', 'starting', 'healthy', 'unhealthy'})}")
print(f"CMD={executable(values['CMD'])}")
print(f"ENTRYPOINT={executable(values['ENTRYPOINT'])}")
print(f"USER={enum(values['USER'], {'1000:1000', '1000', 'deno'})}")
print(f"READ_ONLY={enum(values['READ_ONLY'], {'true', 'false'})}")
print(f"MOUNTS={mounts(values['MOUNTS'])}")
print(f"NETWORK={enum(values['NETWORK'].rstrip(';'), {'n8n-ntga_default'})}")
print(f"PUBLIC_PORTS={'NO' if values['PORT_BINDINGS'] in ('null', '{}') else 'YES'}")
print("STARTUP_LOG_TAIL_SANITIZED_BEGIN")
try:
    logs = subprocess.run(["docker", "logs", "--tail", "100", name],
                          capture_output=True, text=True, timeout=8, check=False)
    if logs.returncode:
        print("LOGS_UNAVAILABLE")
    else:
        for line in (logs.stdout + "\n" + logs.stderr).splitlines()[-100:]:
            print(sanitize_log(line[:8192]))
except (subprocess.SubprocessError, OSError):
    print("LOGS_UNAVAILABLE")
print("STARTUP_LOG_TAIL_SANITIZED_END")
