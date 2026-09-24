"""Exercise actual Bash deploy and rollback control flow with a stateful Docker double."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
DEPLOY = ROOT / "sana-lab/deploy-functional-gate.sh"
FAKE_DOCKER = ROOT / "sana-lab/tests/fake_docker.py"
DISPATCH = ROOT / "sana-lab/ssh-dispatch.sh"
COMMIT = "1" * 40
OLD_ID = "sha256:old-lab-image"


class DeployTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="sana-lab-deploy-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        bindir = self.root / "bin"
        bindir.mkdir()
        (bindir / "docker").symlink_to(FAKE_DOCKER)
        install = bindir / "install"
        install.write_text(
            '#!/usr/bin/env bash\n'
            'if [[ $# == 8 && $1 == -d && $2 == -o && $3 == 1000 && $4 == -g && $5 == 1000 && $6 == -m ]]; then\n'
            '  mkdir -p "$8"; chmod "$7" "$8"; exit 0\n'
            'fi\n'
            'exec /usr/bin/install "$@"\n', encoding="utf-8",
        )
        install.chmod(0o700)
        git = bindir / "git"
        git.write_text(
            '#!/usr/bin/env bash\n'
            'case "$1 $2" in\n'
            '  "rev-parse HEAD"|"rev-parse FETCH_HEAD") echo "$SANA_DEPLOY_TEST_SHA";;\n'
            '  "status --porcelain") :;;\n'
            '  "ls-remote origin") printf "%s\\trefs/heads/sana-lab-exumacao-f0-f2\\n" "$SANA_DEPLOY_TEST_SHA";;\n'
            '  fetch*|switch*|merge*) :;;\n'
            '  *) exit 1;;\n'
            'esac\n', encoding="utf-8",
        )
        git.chmod(0o700)
        state_dir = self.root / "lab-state"
        state_dir.mkdir()
        state_dir.chmod(0o777)
        secret = self.root / "token-placeholder"
        secret.touch()
        secret.chmod(0o644)
        self.state_path = self.root / "state.json"
        self.old_state = {
            "images": {}, "state_mount": str(state_dir), "secret_mount": str(secret),
            "containers": {"sana-lab-bridge": {
                "running": True, "image": "sana-lab-bridge:previous", "id": OLD_ID,
                "engine": "a" * 64, "recadastro": "b" * 64,
            }},
        }
        self.state_path.write_text(json.dumps(self.old_state), encoding="utf-8")
        self.env = dict(os.environ,
            PATH=f"{bindir}:{os.environ['PATH']}",
            SANA_DEPLOY_TEST_STATE=str(self.state_path),
            SANA_DEPLOY_TEST_SHA=COMMIT,
            SANA_DEPLOY_TEST_ENGINE_HASH=hashlib.sha256((ROOT / "sana-lab/engine.ts").read_bytes()).hexdigest(),
            SANA_DEPLOY_TEST_RECADASTRO_HASH=hashlib.sha256((ROOT / "sana-lab/recadastro.ts").read_bytes()).hexdigest(),
            SANA_LAB_DEPLOY_RECORD_DIR=str(self.root / "records"),
        )

    def test_deno_cache_uses_writable_lab_mount(self):
        dockerfile = (ROOT / "sana-lab/Dockerfile").read_text(encoding="utf-8")
        compose = (ROOT / "sana-lab/compose.lab.yaml").read_text(encoding="utf-8")
        workflow = (ROOT / ".github/workflows/sana-lab-bridge-deploy.yml").read_text(encoding="utf-8")
        self.assertIn("DENO_DIR=/lab-state/.deno", dockerfile)
        self.assertIn("DENO_DIR: /lab-state/.deno", compose)
        self.assertIn('DENO_DIR=/lab-state/.deno', workflow)
        self.assertIn('sudo chown 1000:1000 "$state"', workflow)
        self.assertIn('sudo chown 1000:1000 "$token_file"', workflow)
        self.assertIn('chmod 0400 "$token_file"', workflow)
        self.assertIn("diagnose-container.py sana-lab-smoke", workflow)
        deploy = (ROOT / "sana-lab/deploy-functional-gate.sh").read_text(encoding="utf-8")
        self.assertIn("src=$preflight_state,dst=/lab-state", deploy)
        self.assertIn("STATE=ISOLATED", deploy)
        self.assertLess(deploy.index('echo "PREFLIGHT_OK'), deploy.index("stage=STOP_OLD"))

    def run_deploy(self, mode="deploy", **env):
        return subprocess.run(["bash", str(DEPLOY), COMMIT, mode], cwd=ROOT,
                              env={**self.env, **env}, capture_output=True, text=True, check=False)

    def state(self):
        return json.loads(self.state_path.read_text(encoding="utf-8"))

    def test_normal_deploy_confirms_commit_image_and_retains_previous(self):
        result = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f"DEPLOY_OK COMMIT={COMMIT}", result.stdout)
        containers = self.state()["containers"]
        self.assertEqual(containers["sana-lab-bridge"]["commit"], COMMIT)
        self.assertEqual(len(containers), 2)
        self.assertFalse(next(v for k, v in containers.items() if k != "sana-lab-bridge")["running"])
        self.assertIn("status=ACTIVE", (self.root / "records/active.txt").read_text())
        events = self.state()["events"]
        self.assertLess(events.index("preflight-start"), events.index("preflight-remove"))
        self.assertLess(events.index("preflight-remove"), events.index("service-stop"))
        self.assertIn("PREFLIGHT_OK", result.stdout)

    def test_preflight_failure_leaves_the_working_bridge_untouched(self):
        result = self.run_deploy(SANA_DEPLOY_TEST_PREFLIGHT_FAIL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("PREFLIGHT_FAILED_STAGE=VERIFY", result.stderr)
        containers = self.state()["containers"]
        self.assertEqual(set(containers), {"sana-lab-bridge"})
        self.assertTrue(containers["sana-lab-bridge"]["running"])
        self.assertEqual(containers["sana-lab-bridge"]["id"], OLD_ID)
        self.assertIn("preflight-start", self.state()["events"])
        self.assertIn("preflight-remove", self.state()["events"])

    def test_preflight_authenticated_probe_failure_leaves_the_working_bridge_untouched(self):
        result = self.run_deploy(SANA_DEPLOY_TEST_PREFLIGHT_AUTH_FAIL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("PREFLIGHT_FAILED_STAGE=AUTHENTICATED_PROBE", result.stderr)
        containers = self.state()["containers"]
        self.assertEqual(set(containers), {"sana-lab-bridge"})
        self.assertTrue(containers["sana-lab-bridge"]["running"])
        self.assertNotIn("service-stop", self.state()["events"])
        report = self.root / "records/diagnostics" / f"{COMMIT}.txt"
        self.assertTrue(report.is_file())
        self.assertIn("DEPLOY_FAILED_STAGE=PREFLIGHT_PROBE", report.read_text(encoding="utf-8"))

    def test_controlled_failure_restores_original_container(self):
        result = self.run_deploy("rollback-test")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("SYNTHETIC_LAB_FAILURE_AFTER_HEALTH_PROBE", result.stderr)
        self.assertIn("ROLLBACK_CONFIRMED=YES", result.stdout)
        self.assertEqual(self.state()["containers"]["sana-lab-bridge"]["id"], OLD_ID)
        self.assertTrue(self.state()["containers"]["sana-lab-bridge"]["running"])
        self.assertIn("status=ROLLED_BACK", (self.root / "records/active.txt").read_text())

    def test_authenticated_probe_failure_rolls_back_and_fails(self):
        result = self.run_deploy(SANA_DEPLOY_TEST_AUTH_FAIL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ROLLBACK_CONFIRMED=YES", result.stdout)
        self.assertEqual(self.state()["containers"]["sana-lab-bridge"]["id"], OLD_ID)

    def test_restarting_new_container_is_diagnosed_before_rollback_without_secrets(self):
        result = self.run_deploy(SANA_DEPLOY_TEST_RESTART="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ROLLBACK_CONFIRMED=YES", result.stdout)
        self.assertEqual(self.state()["containers"]["sana-lab-bridge"]["id"], OLD_ID)
        events = self.state()["events"]
        self.assertLess(events.index("preflight-remove"), events.index("service-stop"))
        self.assertIn("logs-before-remove", events)
        self.assertIn("remove-new", events)
        report = self.root / "records/diagnostics" / f"{COMMIT}.txt"
        self.assertTrue(report.is_file())
        self.assertEqual(report.stat().st_mode & 0o777, 0o600)
        self.assertIn("CONTAINER_STATUS=restarting", result.stdout)
        self.assertIn("CONTAINER_EXIT_CODE=1", result.stdout)
        self.assertIn("CONTAINER_RESTART_COUNT=3", result.stdout)
        self.assertIn("CONTAINER_OOM_KILLED=false", result.stdout)
        self.assertIn("PUBLIC_PORTS=NO", result.stdout)
        self.assertIn("NETWORK_MODE=n8n-ntga_default", result.stdout)
        self.assertIn("APPARMOR_PROFILE=docker-default", result.stdout)
        self.assertIn("SECURITY_OPTIONS=no-new-privileges:true", result.stdout)
        self.assertIn("CAP_DROP=NONE", result.stdout)
        self.assertIn("CAP_ADD=NONE", result.stdout)
        self.assertIn("LAB_STATE_USER_1000_WRITE_EXECUTE=YES", result.stdout)
        self.assertIn("TOKEN_USER_1000_READ=YES", result.stdout)
        self.assertIn("RUNTIME_UID=1000 RUNTIME_GID=1000", result.stdout)
        self.assertIn("WORKDIR=/app", result.stdout)
        self.assertIn("DENO_DIR_CONFIGURED=yes", result.stdout)
        self.assertIn("ACCESS_PATH=/lab-state ACCESS_UID=1000 ACCESS_GID=1000 ACCESS_MODE=700", result.stdout)
        self.assertIn("ACCESS_CHECK_PATH=/lab-state ACCESS_OP=write ACCESS_RESULT=YES", result.stdout)
        self.assertIn("ACCESS_PATH=/lab-state/.deno ACCESS_UID=1000 ACCESS_GID=1000 ACCESS_MODE=700", result.stdout)
        self.assertIn("ACCESS_CHECK_PATH=/lab-state/.deno ACCESS_OP=write ACCESS_RESULT=YES", result.stdout)
        self.assertIn("ACCESS_PATH=/run/secrets/sana_lab_token ACCESS_UID=1000 ACCESS_GID=1000 ACCESS_MODE=400", result.stdout)
        self.assertIn("ACCESS_CHECK_PATH=/run/secrets/sana_lab_token ACCESS_OP=read ACCESS_RESULT=YES", result.stdout)
        self.assertIn("ACCESS_PATH=/deno-dir ACCESS_UID=1000 ACCESS_GID=1000 ACCESS_MODE=700", result.stdout)
        self.assertIn("ENTRYPOINT=/tini,--,docker-entrypoint.sh", result.stdout)
        self.assertIn("CMD=run,READ=/app/santana-authority,/app/santana-conversation-domain,/app/conformidade,/lab-state,/run/secrets/<redacted>,WRITE=/lab-state,NET=0.0.0.0:8765,ENV=SANA_LAB_TOKEN_FILE,SANTANA_REPO_ROOT,APP_SCRIPT=sana-lab/start.ts,ARG_REDACTED", result.stdout)
        self.assertIn("ERROR_TYPE=NotCapable", result.stdout)
        self.assertIn("DENIED_OPERATION=read", result.stdout)
        self.assertIn("DENIED_PATH=/app/santana-authority/catalogo/exumacao.v1.json", result.stdout)
        self.assertIn("DENO_MESSAGE=Requires read access to /app/santana-authority/catalogo/exumacao.v1.json", result.stdout)
        self.assertIn("STACK_FRAME=/app/santana-authority-gateway/catalogo/carregar.ts:128:19", result.stdout)
        self.assertIn("DENIED_OPERATION=net STACK_FRAME=ext:deno_net/01_net.js:900:4", result.stdout)
        self.assertIn("DENIED_OPERATION=env", result.stdout)
        self.assertIn("DENIED_RESOURCE=<sensitive-resource>", result.stdout)
        self.assertIn("DENIED_PATH=/run/secrets/<redacted>", result.stdout)
        self.assertIn("DENIED_OPERATION=write", result.stdout)
        self.assertIn("DENIED_PATH=/lab-state/<file>", result.stdout)
        self.assertIn("STACK_FRAME=/app/sana-lab/file_store.ts:22:17", result.stdout)
        self.assertIn("STARTUP_DIAGNOSTIC ERROR_TYPE=PermissionDenied DENIED_OPERATION=read DENIED_PATH=/app/santana-authority/catalogo/exumacao.v1.json STACK_FRAME=/app/santana-authority-gateway/catalogo/carregar.ts:128:19 DENO_MESSAGE=Requires read access", result.stdout)
        for forbidden in ("synthetic-secret-value", "Authorization", "/unsafe/private/",
                          "token=", "Bearer"):
            self.assertNotIn(forbidden, result.stdout + result.stderr + report.read_text())
        diagnosis = self.run_deploy("diagnose")
        self.assertEqual(diagnosis.returncode, 0, diagnosis.stderr)
        self.assertEqual(diagnosis.stdout, report.read_text())
        events = self.state()["events"]
        self.assertLess(events.index("logs-before-remove"), events.index("remove-new"))

    def test_diagnose_unknown_sha_fails_closed(self):
        result = self.run_deploy("diagnose")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("LAB_DIAGNOSTIC_UNAVAILABLE", result.stderr)
        self.assertEqual(self.state()["containers"], self.old_state["containers"])

    def test_stale_commit_does_not_touch_bridge(self):
        result = self.run_deploy(SANA_DEPLOY_TEST_SHA="2" * 40)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("COMMIT_MISMATCH", result.stderr)
        self.assertEqual(self.state()["containers"], self.old_state["containers"])

    def test_ssh_forced_command_rejects_shell_and_accepts_only_commit(self):
        sudo = self.root / "bin/sudo"
        sudo.write_text('#!/usr/bin/env bash\nprintf "%s\\n" "$*"\n', encoding="utf-8")
        sudo.chmod(0o700)
        for attempt in ["", "deploy HEAD", f"deploy {COMMIT}; id",
                        f"rollback-test {COMMIT} extra", f"diagnose {COMMIT}; cat /etc/shadow",
                        f"diagnose {COMMIT} extra"]:
            rejected = subprocess.run(["bash", str(DISPATCH)], cwd=ROOT,
                                      env={**self.env, "SSH_ORIGINAL_COMMAND": attempt},
                                      capture_output=True, text=True, check=False)
            self.assertNotEqual(rejected.returncode, 0, attempt)
        accepted = subprocess.run(["bash", str(DISPATCH)], cwd=ROOT,
                                  env={**self.env, "SSH_ORIGINAL_COMMAND": f"deploy {COMMIT}"},
                                  capture_output=True, text=True, check=False)
        self.assertEqual(accepted.returncode, 0, accepted.stderr)
        self.assertEqual(accepted.stdout.strip(), f"-n /usr/local/sbin/sana-lab-deploy-entry deploy {COMMIT}")
        diagnostic = subprocess.run(["bash", str(DISPATCH)], cwd=ROOT,
                                    env={**self.env, "SSH_ORIGINAL_COMMAND": f"diagnose {COMMIT}"},
                                    capture_output=True, text=True, check=False)
        self.assertEqual(diagnostic.returncode, 0, diagnostic.stderr)
        self.assertEqual(diagnostic.stdout.strip(), f"-n /usr/local/sbin/sana-lab-deploy-entry diagnose {COMMIT}")


if __name__ == "__main__":
    unittest.main()
