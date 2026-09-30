import http.server
import socketserver
import urllib.request
import json
import os
import sys

PORT = 3000

class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

class ETFHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Enable CORS and caching headers
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        # Proxy endpoint for Naver API if accessed through server
        if self.path.startswith('/api/naver/etfs'):
            query = self.path.split('?', 1)[1] if '?' in self.path else ''
            params = []
            if 'listingType=' not in query:
                params.append('listingType=aumDesc')
            if 'size=' not in query:
                params.append('size=100')
            if 'index=' not in query:
                params.append('index=0')
            
            full_query = query + (('&' if query else '') + '&'.join(params) if params else '')
            target_url = f"https://stock.naver.com/api/stockSecurity/etfs/v2/domestic?{full_query}"
            
            try:
                req = urllib.request.Request(target_url, headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                })
                with urllib.request.urlopen(req, timeout=10) as resp:
                    data = resp.read()
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.end_headers()
                    self.wfile.write(data)
                    return
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
                return

        return super().do_GET()

def run():
    sys.stdout.reconfigure(encoding='utf-8')
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = ThreadingHTTPServer(("", PORT), ETFHandler)
    print("=======================================================")
    print(f"[*] NAVER ETF EDA DASHBOARD SERVER RUNNING (THREADED)")
    print(f"[*] Local URL: http://localhost:{PORT}")
    print(f"[*] Direct Naver CORS whitelist port: 3000")
    print(f"[*] Proxy endpoint: http://localhost:{PORT}/api/naver/etfs")
    print(f"[*] Static and live dashboard ready!")
    print("=======================================================")
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")

if __name__ == '__main__':
    run()
