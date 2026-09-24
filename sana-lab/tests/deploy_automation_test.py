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
        secret = self.root / "token-placeholder"
        secret.touch()
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
        self.assertEqual(self.state()["events"], ["logs-before-remove", "remove-new"])
        report = self.root / "records/diagnostics" / f"{COMMIT}.txt"
        self.assertTrue(report.is_file())
        self.assertEqual(report.stat().st_mode & 0o777, 0o600)
        self.assertIn("CONTAINER_STATUS=restarting", result.stdout)
        self.assertIn("CONTAINER_EXIT_CODE=1", result.stdout)
        self.assertIn("CONTAINER_RESTART_COUNT=3", result.stdout)
        self.assertIn("CONTAINER_OOM_KILLED=false", result.stdout)
        self.assertIn("PUBLIC_PORTS=NO", result.stdout)
        self.assertIn("APP_PATH=/app/sana-lab/start.ts:32", result.stdout)
        for forbidden in ("synthetic-secret-value", "Authorization", "/unsafe/private/",
                          "token=", "Bearer"):
            self.assertNotIn(forbidden, result.stdout + result.stderr + report.read_text())
        diagnosis = self.run_deploy("diagnose")
        self.assertEqual(diagnosis.returncode, 0, diagnosis.stderr)
        self.assertEqual(diagnosis.stdout, report.read_text())
        self.assertEqual(self.state()["events"], ["logs-before-remove", "remove-new"])

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
