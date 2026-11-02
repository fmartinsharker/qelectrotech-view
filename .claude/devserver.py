import http.server, functools, os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")
SAVE_DIR = sys.argv[2] if len(sys.argv) > 2 else None

class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        # só para desenvolvimento: guarda capturas de ecrã enviadas pela página
        if not SAVE_DIR or not self.path.startswith("/__save/"):
            self.send_error(404)
            return
        name = os.path.basename(self.path[len("/__save/"):])
        data = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        with open(os.path.join(SAVE_DIR, name), "wb") as f:
            f.write(data)
        self.send_response(200)
        self.end_headers()

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    handler = functools.partial(H, directory=ROOT)
    http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
