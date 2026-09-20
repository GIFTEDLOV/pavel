import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def _run(script: str) -> str:
    result = subprocess.run([sys.executable, str(ROOT / "scripts" / script)], cwd=ROOT, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout


def test_core_vault_interface_parity_gate():
    assert "CORE_VAULT_INTERFACE_PARITY: passed" in _run("core-vault-interface-parity.py")


def test_undeployed_manifest_honesty_gate():
    assert "DEPLOYMENT_MANIFEST_HONESTY: passed" in _run("validate-deployment-manifest.py")
