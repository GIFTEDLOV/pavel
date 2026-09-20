from pathlib import Path
import py_compile

ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT / "contracts" / "pavel_core.py", ROOT / "contracts" / "pavel_vault.py"):
    py_compile.compile(str(path), doraise=True)
    print(f"compiled {path.relative_to(ROOT)}")
