#!/usr/bin/env python3
"""Read only permitted Docker fields; reduce untrusted startup logs to safe markers.

Invoked by the reviewed, root-owned deploy procedure before removing a failed
LAB container. Never print a raw log line, Docker error or host mount source.
"""
import json
import os
import re
import stat
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
    binaries = {"deno", "/deno", "/usr/bin/deno", "/usr/local/bin/deno", "/bin/deno",
                "tini", "/tini", "/usr/bin/tini", "--", "run", "serve", "task"}
    safe_basenames = {"deno", "tini", "sh", "bash", "docker-entrypoint.sh", "entrypoint.sh"}
    scripts = {"sana-lab/start.ts", "sana-lab/bridge.ts",
               "/app/sana-lab/start.ts", "/app/sana-lab/bridge.ts"}
    allowed_paths = {"/app/santana-authority", "/app/santana-conversation-domain",
                     "/app/conformidade", "/lab-state", "/run/secrets/sana_lab_token"}
    allowed_env = {"SANA_LAB_STATE_DIR", "SANA_LAB_BIND_HOST", "SANA_LAB_PORT",
                   "SANA_LAB_TOKEN_FILE", "SANTANA_CATALOGO_OFICIAL",
                   "SANTANA_REPO_ROOT", "SANTANA_PERFIL_EXUMACAO"}
    output = []
    for item in items[:12]:
        if not isinstance(item, str):
            output.append("ARG_REDACTED")
        elif item in binaries:
            output.append(item)
        elif item.rsplit("/", 1)[-1] in safe_basenames:
            output.append(item.rsplit("/", 1)[-1])
        elif item in scripts:
            output.append("APP_SCRIPT=" + item.split("/")[-2] + "/" + item.split("/")[-1])
        elif item.startswith("--allow-read=") or item.startswith("--allow-write="):
            capability, grants = item.split("=", 1)
            safe = [safe_resource(path) if path in allowed_paths else "OTHER_REDACTED"
                    for path in grants.split(",")]
            output.append(capability.removeprefix("--allow-").upper() + "=" + ",".join(safe))
        elif item.startswith("--allow-net="):
            target = item.split("=", 1)[1]
            output.append("NET=" + (target if target in {"0.0.0.0:8765", "127.0.0.1:8765"} else "TARGET_REDACTED"))
        elif item.startswith("--allow-env="):
            grants = item.split("=", 1)[1].split(",")
            safe = [name if name in allowed_env else "ENV_NAME_REDACTED" for name in grants]
            output.append("ENV=" + ",".join(safe))
        else:
            output.append("ARG_REDACTED")
    return ",".join(output)


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


def user_1000_access(metadata, required):
    try:
        mode = stat.S_IMODE(metadata.st_mode)
        if metadata.st_uid == 1000:
            bits = (mode >> 6) & 0b111
        elif metadata.st_gid == 1000:
            bits = (mode >> 3) & 0b111
        else:
            bits = mode & 0b111
        return (bits & required) == required
    except (AttributeError, OSError):
        return False


def mount_metadata():
    """Stat only the two configured mount roots/files; never read their content or print host paths."""
    try:
        raw = docker("inspect", name, "--format", "{{json .Mounts}}")
        entries = json.loads(raw)
        destinations = {item.get("Destination"): item.get("Source")
                        for item in entries if isinstance(item, dict)}
    except (subprocess.SubprocessError, OSError, ValueError, TypeError):
        return "LAB_STATE_UID_GID=UNKNOWN LAB_STATE_MODE=UNKNOWN LAB_STATE_USER_1000_WRITE_EXECUTE=UNKNOWN TOKEN_UID_GID=UNKNOWN TOKEN_MODE=UNKNOWN TOKEN_USER_1000_READ=UNKNOWN"

    result = []
    for destination, label, required in (
        ("/lab-state", "LAB_STATE", 0b011),
        ("/run/secrets/sana_lab_token", "TOKEN", 0b100),
    ):
        host_source = destinations.get(destination)
        try:
            metadata = os.stat(host_source) if isinstance(host_source, str) else None
            if metadata is None:
                raise OSError("mount missing")
            uid_gid = f"{metadata.st_uid}:{metadata.st_gid}"
            mode = f"{stat.S_IMODE(metadata.st_mode):04o}"
            access_ok = user_1000_access(metadata, required)
            result.extend((f"{label}_UID_GID={uid_gid}", f"{label}_MODE={mode}",
                           f"{label}_USER_1000_{'WRITE_EXECUTE' if label == 'LAB_STATE' else 'READ'}={'YES' if access_ok else 'NO'}"))
        except OSError:
            result.extend((f"{label}_UID_GID=UNAVAILABLE", f"{label}_MODE=UNAVAILABLE",
                           f"{label}_USER_1000_{'WRITE_EXECUTE' if label == 'LAB_STATE' else 'READ'}=NO"))
    return " ".join(result)


def in_container_access():
    """Check the LAB mount in an isolated probe using the configured user; never read contents."""
    script = (
        "printf 'RUNTIME_UID=%s RUNTIME_GID=%s\\n' \"$(id -u)\" \"$(id -g)\"; "
        "for p in /lab-state /run/secrets/sana_lab_token /deno-dir; do "
        "if [ -e \"$p\" ]; then "
        "stat -c 'ACCESS_PATH=%n ACCESS_UID=%u ACCESS_GID=%g ACCESS_MODE=%a' \"$p\"; "
        "for op in read write exec; do "
        "if [ \"$op\" = read ]; then test -r \"$p\"; "
        "elif [ \"$op\" = write ]; then test -w \"$p\"; else test -x \"$p\"; fi; "
        "rc=$?; printf 'ACCESS_CHECK_PATH=%s ACCESS_OP=%s ACCESS_RESULT=%s\\n' \"$p\" \"$op\" \"$( [ \"$rc\" -eq 0 ] && echo YES || echo NO )\"; "
        "done; else printf 'ACCESS_PATH=%s ACCESS_RESULT=MISSING\\n' \"$p\"; fi; done"
    )
    try:
        raw = docker("inspect", name, "--format", "{{json .Mounts}}")
        entries = json.loads(raw)
        sources = {item.get("Destination"): item.get("Source") for item in entries if isinstance(item, dict)}
        state_source = sources.get("/lab-state")
        token_source = sources.get("/run/secrets/sana_lab_token")
        safe_host_path = lambda path: isinstance(path, str) and bool(re.fullmatch(r"/[A-Za-z0-9._/-]{1,240}", path))
        if not safe_host_path(state_source) or not os.path.isdir(state_source):
            return "CONTAINER_ACCESS_CHECK=UNAVAILABLE"
        if not safe_host_path(token_source) or not os.path.isfile(token_source):
            return "CONTAINER_ACCESS_CHECK=UNAVAILABLE"
        result = subprocess.run(
            ["docker", "run", "--rm", "--network", "none", "--read-only", "--user", "1000:1000",
             "--mount", f"type=bind,src={state_source},dst=/lab-state",
             "--mount", f"type=bind,src={token_source},dst=/run/secrets/sana_lab_token,readonly",
             "--entrypoint", "/bin/sh",
             expected_image, "-c", script],
            capture_output=True, text=True, timeout=8, check=False,
        )
    except (subprocess.SubprocessError, OSError, ValueError, TypeError):
        return "CONTAINER_ACCESS_CHECK=UNAVAILABLE"
    if result.returncode:
        return "CONTAINER_ACCESS_CHECK=UNAVAILABLE"
    output = []
    patterns = (
        r"RUNTIME_UID=[0-9]{1,10} RUNTIME_GID=[0-9]{1,10}",
        r"ACCESS_PATH=(?:/lab-state|/run/secrets/sana_lab_token|/deno-dir) ACCESS_UID=[0-9]{1,10} ACCESS_GID=[0-9]{1,10} ACCESS_MODE=[0-7]{3,4}",
        r"ACCESS_CHECK_PATH=(?:/lab-state|/run/secrets/sana_lab_token|/deno-dir) ACCESS_OP=(?:read|write|exec) ACCESS_RESULT=(?:YES|NO)",
        r"ACCESS_PATH=(?:/lab-state|/run/secrets/sana_lab_token|/deno-dir) ACCESS_RESULT=MISSING",
    )
    for line in result.stdout.splitlines():
        if any(re.fullmatch(pattern, line) for pattern in patterns):
            output.append(line)
    return " ".join(output) if output else "CONTAINER_ACCESS_CHECK=UNAVAILABLE"


error_types = re.compile(
    r"\b(NotCapable|PermissionDenied|TypeError|SyntaxError|ReferenceError|"
    r"ModuleNotFound|InvalidData|NotFound|EACCES|ENOENT|OOM|Error)\b"
)
source_frame = re.compile(
    r"(?:at\s+.*?\()?(?:file://)?(?P<path>/[^\s():)]+\.(?:tsx?|mjs|js|json))(?::(?P<line>[0-9]{1,6}))(?::(?P<column>[0-9]{1,6}))?"
)
absolute_path = re.compile(r"(?:(?:file://)?/[A-Za-z0-9._~!$&()+,;=@%-]+(?:/[A-Za-z0-9._~!$&()+,;=@%-]+)*)")
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
    if os_denial.search(line) and not operation:
        operation = "unknown"
    if operation:
        fields.append(f"DENIED_OPERATION={operation}")
    if resource:
        resource = safe_resource(resource)
        label = "DENIED_PATH" if resource.startswith("/") else "DENIED_RESOURCE"
        fields.append(f"{label}={resource}")
    elif os_denial.search(line):
        path = absolute_path.search(line)
        if path:
            resource = safe_resource(path.group())
            fields.append(f"DENIED_PATH={resource}")

    if denial := os_denial.search(line):
        message = "Permission denied"
        if denial.group(1):
            message += f" (os error {denial.group(1)})"
        if operation:
            message += f"; operation={operation}"
        if resource:
            message += f"; resource={resource}"
        fields.append(f"DENO_MESSAGE={message}")
    elif access_match and resource:
        fields.append(f"DENO_MESSAGE=Requires {operation} access to {resource}")

    frame = source_frame.search(line)
    if frame:
        file_path = safe_resource(frame.group("path"))
        location = ":".join(part for part in (frame.group("line"), frame.group("column")) if part)
        fields.append(f"STACK_FRAME={file_path}{':' + location if location else ''}")
    return fields


def sanitize_log(line):
    """Preserve safe Deno diagnostics while masking secrets and file contents."""
    if "SANA_LAB_STARTUP_DIAGNOSTIC " in line:
        record = line.split("SANA_LAB_STARTUP_DIAGNOSTIC ", 1)[1]
        fields = {
            key: (re.search(r"\b" + key + r"=([^\s]+)", record).group(1)
                  if re.search(r"\b" + key + r"=([^\s]+)", record) else "")
            for key in ("ERROR_TYPE", "DENIED_OPERATION", "DENIED_RESOURCE", "STACK_FRAME")
        }
        message = re.search(r"\bDENO_MESSAGE=(.*)$", record)
        fields["DENO_MESSAGE"] = message.group(1).strip() if message else ""
        output = ["STARTUP_DIAGNOSTIC"]
        if fields.get("ERROR_TYPE") in {"NotCapable", "PermissionDenied", "NotFound", "TypeError", "SyntaxError", "ReferenceError", "Error"}:
            output.append("ERROR_TYPE=" + fields["ERROR_TYPE"])
        if fields.get("DENIED_OPERATION") in {"read", "write", "env", "net", "unknown"}:
            output.append("DENIED_OPERATION=" + fields["DENIED_OPERATION"])
        if fields.get("DENIED_RESOURCE"):
            resource = safe_resource(fields["DENIED_RESOURCE"])
            label = "DENIED_PATH" if resource.startswith("/") else "DENIED_RESOURCE"
            output.append(label + "=" + resource)
        if fields.get("STACK_FRAME"):
            frame = source_frame.search(fields["STACK_FRAME"])
            if frame:
                location = ":".join(part for part in (frame.group("line"), frame.group("column")) if part)
                output.append("STACK_FRAME=" + safe_resource(frame.group("path")) + (":" + location if location else ""))
        message = fields.get("DENO_MESSAGE", "")
        if re.fullmatch(r"Requires (read|write|env|net) access|Permission denied \(os error [0-9]{1,3}\)|NotCapable|PermissionDenied|NotFound|TypeError|SyntaxError|ReferenceError|Error", message):
            output.append("DENO_MESSAGE=" + message)
        return " ".join(output)
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
print(mount_metadata())
print(in_container_access())
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
