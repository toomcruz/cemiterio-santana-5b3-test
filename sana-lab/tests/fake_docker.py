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
        "{{.Config.Image}}": container["image"],
        "{{len .NetworkSettings.Networks}}": "1",
        "{{range .NetworkSettings.Networks}}{{.NetworkID}}{{end}}": "test-network-id",
        "{{json .HostConfig.PortBindings}}": "null",
        "{{.HostConfig.ReadonlyRootfs}}": "true",
    }
    if fmt in fields:
        result(fields[fmt])
    if ".Config.Labels" in fmt:
        result(container.get("commit", "<no value>"))
    if ".Config.Env" in fmt:
        result("yes")
    if ".Mounts" in fmt:
        if "/lab-state" in fmt:
            result("true" if ".RW" in fmt else state["state_mount"])
        if "/run/secrets/sana_lab_token" in fmt:
            result("false" if ".RW" in fmt else state["secret_mount"])
    fail()
if args[0] == "exec":
    container = state["containers"].get(args[1])
    if not container or not container["running"]:
        fail()
    if args[2] == "sha256sum":
        key = "engine" if args[3].endswith("engine.ts") else "recadastro"
        result(f"{container[key]}  {args[3]}")
    if args[2:4] == ["deno", "eval"]:
        fail() if os.getenv("SANA_DEPLOY_TEST_401_FAIL") == "1" and container["id"].startswith("sha256:new") else result()
    if args[2:4] == ["deno", "run"]:
        fail() if os.getenv("SANA_DEPLOY_TEST_AUTH_FAIL") == "1" else result("LAB_PROBE_OK HTTP=200")
    fail()
if args[0] == "stop":
    container = state["containers"].get(args[1])
    if not container:
        fail()
    container["running"] = False
    result()
if args[0] == "rename":
    if args[1] not in state["containers"] or args[2] in state["containers"]:
        fail()
    state["containers"][args[2]] = state["containers"].pop(args[1])
    result()
if args[0] == "run":
    name = args[args.index("--name") + 1]
    if name in state["containers"]:
        fail()
    image_name = args[-1]
    image = state["images"][image_name]
    state["containers"][name] = {
        "running": True, "image": image_name, "id": image["id"], "commit": image["commit"],
        "engine": os.environ["SANA_DEPLOY_TEST_ENGINE_HASH"],
        "recadastro": os.environ["SANA_DEPLOY_TEST_RECADASTRO_HASH"],
    }
    result("test-container-id")
if args[0] == "rm":
    if args[1] not in state["containers"]:
        fail()
    del state["containers"][args[1]]
    result()
if args[0] == "start":
    container = state["containers"].get(args[1])
    if not container:
        fail()
    container["running"] = True
    result()
fail()
