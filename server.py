# server.py
# A lightweight local bridge that runs TagUI steps sent by your Chrome extension.
# Endpoints:
#  - POST /run   -> run steps, return JSON with stdout/stderr + exit_code
#  - GET  /health -> simple health check
#
# Security: binds to 127.0.0.1 only. Optionally set a shared token via AUTH_TOKEN.

import os, json, tempfile, subprocess, threading
from http.server import BaseHTTPRequestHandler, HTTPServer

HOST = "127.0.0.1"
PORT = 5000
AUTH_TOKEN = os.environ.get("TAGUI_BRIDGE_TOKEN", "")  # optional

# Optionally set Chrome path here if TagUI can't find Chrome
# os.environ["CHROME_EXECUTABLE_PATH"] = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
# Or to use Edge by default: DEFAULT_ARGS = ["-edge"]
DEFAULT_ARGS = ["-edge"]  # e.g., ["-headless"]

def run_tagui(steps_text, args):
    with tempfile.NamedTemporaryFile(mode="w", suffix=".tag", delete=False, encoding="utf-8") as f:
        f.write(steps_text)
        tag_path = f.name

    try:
        # Use full path to tagui executable (update this path to match your system)
        tagui_path = r"C:\Projects\tagui\src\tagui.cmd"  # or tagui.exe if that exists
        
        # Check if tagui exists at this path
        if not os.path.exists(tagui_path):
            return {
                "exit_code": -1,
                "stdout": "",
                "stderr": f"TagUI not found at {tagui_path}",
                "cmd": f"{tagui_path} (not found)"
            }
        
        cmd = [tagui_path, tag_path] + (args or [])
        proc = subprocess.run(cmd, capture_output=True, text=True, shell=True)
        return {
            "exit_code": proc.returncode,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
            "cmd": " ".join(cmd)
        }
    except Exception as e:
        return {
            "exit_code": -1,
            "stdout": "",
            "stderr": f"Error running TagUI: {str(e)}",
            "cmd": "failed"
        }
    finally:
        try: os.remove(tag_path)
        except: pass


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _auth_ok(self):
        if not AUTH_TOKEN:
            return True
        token = self.headers.get("Authorization", "")
        return token == f"Bearer {AUTH_TOKEN}"

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        if not self._auth_ok():
            self.send_response(401)
            self._cors()
            self.end_headers()
            return

        if self.path != "/run":
            self.send_response(404)
            self._cors()
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8") if length else ""
        steps_text, args = "", None

        # Accept both plain text and JSON
        try:
            payload = json.loads(raw)
            steps_text = payload.get("steps", "")
            args = payload.get("args", DEFAULT_ARGS)
        except Exception:
            steps_text = raw
            args = DEFAULT_ARGS

        if not steps_text.strip():
            self.send_response(400)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error":"empty steps"}')
            return

        result = run_tagui(steps_text, args)

        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(result).encode("utf-8"))

def main():
    server = HTTPServer((HOST, PORT), Handler)
    print(f"TagUI bridge running on http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass

if __name__ == "__main__":
    main()
