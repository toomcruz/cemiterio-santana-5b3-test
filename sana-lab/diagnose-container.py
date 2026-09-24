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
source_frame = re.compile(
    r"(?:at\s+(?:[^\s(]+\s+\()?)(file://)?(/[^\s():]+(?:/[^\s():]+)*\.tsx?)(?::([0-9]{1,6}))?(?::([0-9]{1,6}))?"
)
access = re.compile(
    r"Requires\s+(read|write|env|net)\s+access\s+to\s+(.+?)(?:,\s*run again|$)",
    re.IGNORECASE,
)
syscall = re.compile(
    r"\b(open|read|readfile|write|writefile|mkdir|rename|remove|connect|fetch|resolve)\b",
    re.IGNORECASE,
)
os_denial = re.compile(r"permission denied(?:\s+\(os error\s+([0-9]+)\))?", re.IGNORECASE)


def safe_resource(value):
    value = value.strip().strip("'\"").rstrip(".,;")
    value = re.sub(r"(?i)^file://", "", value)
    if not value:
        return "UNKNOWN"
    if re.search(r"(?i)(token|secret|credential|password|api[_-]?key|\.env)", value):
        if value.startswith("/run/secrets/"):
            return "/run/secrets/<redacted>"
        return "<sensitive-resource>"
    if value.startswith("/lab-state/"):
        return "/lab-state/<file>"
    # Preserve safe absolute paths, including files outside the Docker allowlist.
    # Long opaque path components are treated as identifiers and masked.
    parts = value.split("/")
    safe_parts = [part if len(part) <= 80 and not re.fullmatch(r"[A-Za-z0-9_-]{32,}", part)
                  else "<redacted>" for part in parts]
    return "/".join(safe_parts)[:512]


def sanitized_error_fields(line):
    fields = []
    found_type = error_types.search(line)
    if found_type:
        fields.append(f"ERROR_TYPE={found_type.group(1)}")

    access_match = access.search(line)
    operation = access_match.group(1).lower() if access_match else None
    resource = access_match.group(2) if access_match else None
    call = syscall.search(line)
    if not operation and call:
        name = call.group(1).lower()
        operation = ("read" if name in {"read", "readfile"} else
                     "write" if name in {"write", "writefile", "mkdir", "rename", "remove"} else
                     "net" if name in {"connect", "fetch", "resolve"} else name)
    if operation:
        fields.append(f"DENIED_OPERATION={operation}")
    if resource:
        resource = safe_resource(resource)
        label = "DENIED_PATH" if resource.startswith("/") else "DENIED_RESOURCE"
        fields.append(f"{label}={resource}")

    if denial := os_denial.search(line):
        message = "Permission denied"
        if denial.group(1):
            message += f" (os error {denial.group(1)})"
        fields.append(f"DENO_MESSAGE={message}")
    elif access_match and resource:
        fields.append(f"DENO_MESSAGE=Requires {operation} access to {resource}")

    frame = source_frame.search(line)
    if frame:
        file_path = safe_resource(frame.group(2))
        location = ":".join(part for part in (frame.group(3), frame.group(4)) if part)
        fields.append(f"STACK_FRAME={file_path}{':' + location if location else ''}")
    return fields


def sanitize_log(line):
    """Preserve safe Deno diagnostics while masking secrets and file contents."""
    markers = []
    markers.extend(sanitized_error_fields(line))
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
