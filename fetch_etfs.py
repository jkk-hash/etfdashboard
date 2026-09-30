import urllib.request
import json
import time
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

os.makedirs("data", exist_ok=True)

all_items = []
page = 0
total_count = None

print("Starting fetch of all Naver ETF data...")
start_time = time.time()

while True:
    url = f"https://stock.naver.com/api/stockSecurity/etfs/v2/domestic?listingType=aumDesc&size=100&index={page}"
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            items = data.get('items', [])
            total_count = data.get('totalCount')
            if not items:
                break
            all_items.extend(items)
            print(f"Page {page}: fetched {len(items)} items (Total accumulated: {len(all_items)} / {total_count})")
            if not data.get('hasNext', False):
                break
            page += 1
            time.sleep(0.05)
    except Exception as e:
        print(f"Error on page {page}: {e}")
        break

elapsed = time.time() - start_time
print(f"Completed! Total items fetched: {len(all_items)} in {elapsed:.2f}s")

output_path = os.path.join("data", "etf_data.json")
payload = {
    "lastUpdated": time.strftime("%Y-%m-%d %H:%M:%S"),
    "totalCount": len(all_items),
    "items": all_items
}
with open(output_path, "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, indent=2)

js_output_path = os.path.join("data", "etf_data.js")
with open(js_output_path, "w", encoding="utf-8") as f:
    f.write("window.INITIAL_ETF_DATA = ")
    json.dump(payload, f, ensure_ascii=False)
    f.write(";\n")

print(f"Saved JSON to {output_path} and JS to {js_output_path}")
