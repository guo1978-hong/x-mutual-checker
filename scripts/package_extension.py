"""Create and inspect a private local candidate; never uploads or reads browser data."""
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "x-mutual-checker"
FILES = (
    "manifest.json", "background.js", "inject.js", "content.js", "content.css",
    "dashboard.css", "ui-controls.js", "relationship-guards.js",
    "icons/icon16.png", "icons/icon32.png", "icons/icon48.png", "icons/icon128.png",
)


def build():
    manifest = json.loads((RUNTIME / "manifest.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    if manifest["manifest_version"] != 3:
        raise ValueError("Expected Manifest V3")
    if manifest["permissions"] != ["storage"]:
        raise ValueError("Browser permission changed")
    if set(manifest["host_permissions"]) != {"https://x.com/*", "https://twitter.com/*"}:
        raise ValueError("Host permissions changed")
    if manifest["content_scripts"][1]["js"] != ["ui-controls.js", "relationship-guards.js", "content.js"]:
        raise ValueError("Production helper load order changed")
    refs = [manifest["background"]["service_worker"]]
    refs += list(manifest["icons"].values()) + list(manifest["action"]["default_icon"].values())
    for entry in manifest["content_scripts"]:
        refs += entry.get("js", []) + entry.get("css", [])
        if set(entry["matches"]) != set(manifest["host_permissions"]):
            raise ValueError("Content-script sites changed")
    if not set(refs) <= set(FILES):
        raise ValueError("Manifest references an unstaged runtime file")

    payload = {}
    for name in FILES:
        path = RUNTIME / name
        if path.is_symlink() or not path.resolve().is_relative_to(RUNTIME.resolve()):
            raise ValueError("Runtime path escapes the extension folder")
        content = path.read_bytes()
        if name.endswith(".js"):
            subprocess.run(["node", "--check", str(path)], check=True, capture_output=True, text=True)
            if any(marker in content for marker in (b"fixtureGuardProbe", b"demo_user_", b"window.chrome =")):
                raise ValueError("Test fixture in production runtime")
        if name.endswith(".png") and not content.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("Invalid PNG icon")
        payload[name] = content
    payload["PRIVACY.md"] = (ROOT / "PRIVACY.md").read_bytes()

    dest = ROOT / "artifacts"
    dest.mkdir(exist_ok=True)
    archive = dest / ("x-mutual-checker-" + version + "-local-candidate.zip")
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for name, content in payload.items():
            z.writestr(name, content)
    with zipfile.ZipFile(archive) as z:
        if z.testzip() is not None or set(z.namelist()) != set(payload):
            raise ValueError("Archive failed integrity or file-list validation")
        if json.loads(z.read("manifest.json"))["version"] != version:
            raise ValueError("Archive manifest mismatch")
        for name, content in payload.items():
            if z.read(name) != content:
                raise ValueError("Archive does not match source: " + name)
    report = {
        "version": version,
        "archive": archive.name,
        "archive_sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
        "archive_bytes": archive.stat().st_size,
        "checks": {
            "manifest_references": "pass", "runtime_syntax": "pass",
            "browser_permissions_unchanged": True, "archive_integrity": "pass",
            "fixture_or_user_data_included": False,
        },
        "files": {name: {"bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}
                  for name, content in payload.items()},
        "limits": ["Real Chrome 1.9.4 upgrade pending", "No public upload or store submission"],
    }
    report_path = dest / ("package-validation-" + version + ".json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"version": version, "files": len(payload), "bytes": report["archive_bytes"],
                      "archive": str(archive), "report": str(report_path), "result": "PASS"}, ensure_ascii=False))


if __name__ == "__main__":
    build()
