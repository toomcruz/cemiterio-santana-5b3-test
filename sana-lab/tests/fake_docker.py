#!/usr/bin/env python3
"""Minimal Docker state double for LAB deploy/rollback transition tests."""
import json
import os
import sys

path = os.environ["SANA_DEPLOY_TEST_STATE"]
with open(path, encoding="utf-8") as file:
    state = json.load(file)
args = sys.argv[1:]


def result(output=""):
    with open(path, "w", encoding="utf-8") as file:
        json.dump(state, file)
    if output:
        print(output)
    sys.exit(0)


def fail():
    sys.exit(1)


if args[:2] == ["network", "inspect"]:
    result("test-network-id")
if args[:2] == ["container", "inspect"]:
    result() if args[2] in state["containers"] else fail()
if args[:2] == ["image", "inspect"]:
    image = state["images"].get(args[2])
    if image is None:
        fail()
    fmt = args[args.index("--format") + 1]
    result(image["id"] if fmt == "{{.Id}}" else image["commit"])
if args[0] == "build":
    image = args[args.index("-t") + 1]
    commit = args[args.index("--label") + 1].split("=", 1)[1]
    state["images"][image] = {"id": "sha256:new-" + commit[:12], "commit": commit}
    result()
if args[0] == "inspect":
    container = state["containers"].get(args[1])
    if not container:
        fail()
    fmt = args[args.index("--format") + 1]
    fields = {
        "{{.State.Running}}": str(container["running"]).lower(),
        "{{.Image}}": container["id"],
        "{{.Config.Image}}": container.get("inspect_image", container["image"]),
        "{{len .NetworkSettings.Networks}}": str(container.get("network_count", 1)),
        "{{range .NetworkSettings.Networks}}{{.NetworkID}}{{end}}": container.get("network_id", "test-network-id"),
        "{{json .HostConfig.PortBindings}}": container.get("port_bindings", "null"),
        "{{.HostConfig.ReadonlyRootfs}}": str(container.get("readonly", True)).lower(),
        "{{.State.Status}}": "restarting" if container.get("restarting") else ("running" if container["running"] else "exited"),
        "{{.State.ExitCode}}": "1" if container.get("restarting") else "0",
        "{{.RestartCount}}": "3" if container.get("restarting") else "0",
        "{{.State.OOMKilled}}": "false",
        "{{.State.Error}}": "Permission denied Authorization: Bearer synthetic-secret-value" if container.get("restarting") else "",
        "{{.State.FinishedAt}}": "2026-09-24T00:00:03Z",
        "{{.State.StartedAt}}": "2026-09-24T00:00:02Z",
        "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}": "none",
        "{{json .Config.Cmd}}": '["run","--allow-read=/app/santana-authority,/app/santana-conversation-domain,/app/conformidade,/lab-state,/run/secrets/sana_lab_token","--allow-write=/lab-state","--allow-net=0.0.0.0:8765","--allow-env=SANA_LAB_TOKEN_FILE,SANTANA_REPO_ROOT","sana-lab/start.ts","Bearer synthetic-secret-value"]',
        "{{json .Config.Entrypoint}}": '["/tini","--","docker-entrypoint.sh"]',
        "{{.Config.User}}": "1000:1000",
        "{{.Config.WorkingDir}}": "/app",
        "{{range .Mounts}}{{.Destination}}:{{.Type}}:{{.RW}};{{end}}": "/lab-state:bind:true;/run/secrets/sana_lab_token:bind:false;",
        "{{range $k,$v := .NetworkSettings.Networks}}{{$k}};{{end}}": "n8n-ntga_default;",
        "{{.HostConfig.NetworkMode}}": "n8n-ntga_default",
        "{{.AppArmorProfile}}": "docker-default",
        "{{json .HostConfig.SecurityOpt}}": '["no-new-privileges:true"]',
        "{{json .HostConfig.CapDrop}}": "[]",
        "{{json .HostConfig.CapAdd}}": "[]",
    }
    if fmt in fields:
        result(fields[fmt])
    if ".Config.Labels" in fmt:
        result(container.get("commit", "<no value>"))
    if ".Config.Env" in fmt:
        result("yes")
    if fmt == "{{json .Mounts}}":
        result(json.dumps([
            {"Destination": "/lab-state", "Source": container.get("state_mount", state["state_mount"])},
            {"Destination": "/run/secrets/sana_lab_token", "Source": container.get("secret_mount", state["secret_mount"])},
        ]))
    if ".Mounts" in fmt:
        if "/lab-state" in fmt:
            result("true" if ".RW" in fmt else container.get("state_mount", state["state_mount"]))
        if "/run/secrets/sana_lab_token" in fmt:
            result("false" if ".RW" in fmt else container.get("secret_mount", state["secret_mount"]))
    fail()
if args[0] == "logs":
    state.setdefault("events", []).append("logs-before-remove")
    result('error: Uncaught (in promise) NotCapable: Requires read access to "/app/santana-authority/catalogo/exumacao.v1.json", run again with --allow-read\n'
           '    at async Object.carregar (file:///app/santana-authority-gateway/catalogo/carregar.ts:128:19)\n'
           'PermissionDenied: Requires env access to "SANA_LAB_TOKEN=synthetic-secret-value"\n'
           'PermissionDenied: Requires read access to "/run/secrets/sana_lab_token"\n'
           "PermissionDenied: Permission denied (os error 13): rename '/lab-state/private-case.json.tmp' -> '/lab-state/private-case.json'\\n"
           '    at async Object.commit (file:///app/sana-lab/file_store.ts:22:17)\n'
           'SANA_LAB_STARTUP_DIAGNOSTIC ERROR_TYPE=PermissionDenied DENIED_OPERATION=read DENIED_RESOURCE=/app/santana-authority/catalogo/exumacao.v1.json STACK_FRAME=/app/santana-authority-gateway/catalogo/carregar.ts:128:19 DENO_MESSAGE=Requires read access\n'
           'PermissionDenied: Permission denied (os error 13)\n'
           '    at async listen (ext:deno_net/01_net.js:900:4)\n'
           'Authorization: Bearer synthetic-secret-value\n'
           'secret source: /unsafe/private/secret token=synthetic-secret-value')
if args[0] == "exec":
    container = state["containers"].get(args[1])
    if not container:
        fail()
    if args[2:4] == ["/bin/sh", "-c"]:
        result("RUNTIME_UID=1000 RUNTIME_GID=1000\n"
               "ACCESS_PATH=/lab-state ACCESS_UID=1000 ACCESS_GID=1000 ACCESS_MODE=700\n"
               "ACCESS_CHECK_PATH=/lab-state ACCESS_OP=read ACCESS_RESULT=YES\n"
               "ACCESS_CHECK_PATH=/lab-state ACCESS_OP=write ACCESS_RESULT=YES\n"
               "ACCESS_CHECK_PATH=/lab-state ACCESS_OP=exec ACCESS_RESULT=YES\n"
               "ACCESS_PATH=/lab-state/.deno ACCESS_UID=1000 ACCESS_GID=1000 ACCESS_MODE=700\n"
               "ACCESS_CHECK_PATH=/lab-state/.deno ACCESS_OP=read ACCESS_RESULT=YES\n"
               "ACCESS_CHECK_PATH=/lab-state/.deno ACCESS_OP=write ACCESS_RESULT=YES\n"
               "ACCESS_CHECK_PATH=/lab-state/.deno ACCESS_OP=exec ACCESS_RESULT=YES\n"
               "ACCESS_PATH=/run/secrets/sana_lab_token ACCESS_UID=1000 ACCESS_GID=1000 ACCESS_MODE=400\n"
               "ACCESS_CHECK_PATH=/run/secrets/sana_lab_token ACCESS_OP=read ACCESS_RESULT=YES\n"
               "ACCESS_CHECK_PATH=/run/secrets/sana_lab_token ACCESS_OP=write ACCESS_RESULT=NO\n"
               "ACCESS_CHECK_PATH=/run/secrets/sana_lab_token ACCESS_OP=exec ACCESS_RESULT=NO\n"
               "ACCESS_PATH=/deno-dir ACCESS_UID=1000 ACCESS_GID=1000 ACCESS_MODE=700\n"
               "ACCESS_CHECK_PATH=/deno-dir ACCESS_OP=read ACCESS_RESULT=YES\n"
               "ACCESS_CHECK_PATH=/deno-dir ACCESS_OP=write ACCESS_RESULT=NO\n"
               "ACCESS_CHECK_PATH=/deno-dir ACCESS_OP=exec ACCESS_RESULT=YES")
    if not container["running"] or container.get("restarting"):
        fail()
    if args[2] == "sha256sum":
        key = "engine" if args[3].endswith("engine.ts") else "recadastro"
        result(f"{container[key]}  {args[3]}")
    if args[2:4] == ["deno", "eval"]:
        fail() if ((os.getenv("SANA_DEPLOY_TEST_401_FAIL") == "1" and container["id"].startswith("sha256:new")) or
                   (container.get("preflight") and os.getenv("SANA_DEPLOY_TEST_PREFLIGHT_FAIL") == "1")) else result()
    if args[2:4] == ["deno", "run"]:
        fail() if ((os.getenv("SANA_DEPLOY_TEST_AUTH_FAIL") == "1" and not container.get("preflight")) or
                   (container.get("preflight") and os.getenv("SANA_DEPLOY_TEST_PREFLIGHT_AUTH_FAIL") == "1")) else result("LAB_PROBE_OK HTTP=200")
    fail()
if args[0] == "stop":
    container = state["containers"].get(args[1])
    if not container:
        fail()
    container["running"] = False
    state.setdefault("events", []).append("service-stop" if args[1] == "sana-lab-bridge" else "preflight-stop")
    result()
if args[0] == "rename":
    if args[1] not in state["containers"] or args[2] in state["containers"]:
        fail()
    state["containers"][args[2]] = state["containers"].pop(args[1])
    result()
if args[0] == "run" and "--entrypoint" in args:
    result("RUNTIME_UID=1000 RUNTIME_GID=1000\n"
           "ACCESS_PATH=/lab-state ACCESS_UID=1000 ACCESS_GID=1000 ACCESS_MODE=700\n"
           "ACCESS_CHECK_PATH=/lab-state ACCESS_OP=read ACCESS_RESULT=YES\n"
           "ACCESS_CHECK_PATH=/lab-state ACCESS_OP=write ACCESS_RESULT=YES\n"
           "ACCESS_CHECK_PATH=/lab-state ACCESS_OP=exec ACCESS_RESULT=YES\n"
           "ACCESS_PATH=/run/secrets/sana_lab_token ACCESS_UID=1000 ACCESS_GID=1000 ACCESS_MODE=400\n"
           "ACCESS_CHECK_PATH=/run/secrets/sana_lab_token ACCESS_OP=read ACCESS_RESULT=YES\n"
           "ACCESS_CHECK_PATH=/run/secrets/sana_lab_token ACCESS_OP=write ACCESS_RESULT=NO\n"
           "ACCESS_CHECK_PATH=/run/secrets/sana_lab_token ACCESS_OP=exec ACCESS_RESULT=NO\n"
           "ACCESS_PATH=/deno-dir ACCESS_UID=1000 ACCESS_GID=1000 ACCESS_MODE=700\n"
           "ACCESS_CHECK_PATH=/deno-dir ACCESS_OP=read ACCESS_RESULT=YES\n"
           "ACCESS_CHECK_PATH=/deno-dir ACCESS_OP=write ACCESS_RESULT=NO\n"
           "ACCESS_CHECK_PATH=/deno-dir ACCESS_OP=exec ACCESS_RESULT=YES")
if args[0] == "run":
    name = args[args.index("--name") + 1]
    if name in state["containers"]:
        fail()
    if name.startswith("sana-lab-preflight-") and os.getenv("SANA_DEPLOY_TEST_PREFLIGHT_START_FAIL") == "1":
        state.setdefault("events", []).append("preflight-start-failed")
        with open(path, "w", encoding="utf-8") as file:
            json.dump(state, file)
        fail()
    image_name = args[-1]
    image = state["images"][image_name]
    mounts = [part for part in args if part.startswith("type=bind,")]
    state_mount = next((part.split("src=", 1)[1].split(",", 1)[0] for part in mounts if "dst=/lab-state" in part), state["state_mount"])
    secret_mount = next((part.split("src=", 1)[1].split(",", 1)[0] for part in mounts if "dst=/run/secrets/sana_lab_token" in part), state["secret_mount"])
    is_preflight = name.startswith("sana-lab-preflight-")
    bad = lambda flag: is_preflight and os.getenv(flag) == "1"
    state["containers"][name] = {
        "running": True, "image": image_name, "id": image["id"], "commit": image["commit"],
        "engine": os.environ["SANA_DEPLOY_TEST_ENGINE_HASH"],
        "recadastro": os.environ["SANA_DEPLOY_TEST_RECADASTRO_HASH"],
        "restarting": os.getenv("SANA_DEPLOY_TEST_RESTART") == "1" and not is_preflight,
        "preflight": is_preflight,
        "state_mount": state_mount,
        "secret_mount": secret_mount,
        "inspect_image": "sana-lab-bridge:wrong" if bad("SANA_DEPLOY_TEST_PREFLIGHT_BAD_IMAGE") else image_name,
        "network_count": 2 if bad("SANA_DEPLOY_TEST_PREFLIGHT_BAD_NETWORK") else 1,
        "network_id": "wrong-network-id" if bad("SANA_DEPLOY_TEST_PREFLIGHT_BAD_NETWORK") else "test-network-id",
        "port_bindings": '{"8765/tcp":[{"HostPort":"8765"}]}' if bad("SANA_DEPLOY_TEST_PREFLIGHT_BAD_PORTS") else "null",
        "readonly": not bad("SANA_DEPLOY_TEST_PREFLIGHT_BAD_READONLY"),
    }
    if bad("SANA_DEPLOY_TEST_PREFLIGHT_BAD_ENGINE_HASH"):
        state["containers"][name]["engine"] = "0" * 64
    if bad("SANA_DEPLOY_TEST_PREFLIGHT_BAD_RECADASTRO_HASH"):
        state["containers"][name]["recadastro"] = "0" * 64
    if is_preflight:
        state.setdefault("events", []).append("preflight-start")
    result("test-container-id")
if args[0] == "rm":
    target = args[-1]
    container = state["containers"].get(target)
    if not container:
        fail()
    force = "-f" in args[1:-1] or "--force" in args[1:-1]
    if container.get("running") and not force:
        fail()
    if container.get("preflight") and os.getenv("SANA_DEPLOY_TEST_PREFLIGHT_CLEANUP_FAIL") == "1":
        fail()
    event = "preflight-remove" if container.get("preflight") else "remove-new"
    state.setdefault("events", []).append(event + ("-force" if force else ""))
    del state["containers"][target]
    result()
if args[0] == "start":
    container = state["containers"].get(args[1])
    if not container:
        fail()
    container["running"] = True
    result()
fail()
