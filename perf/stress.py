"""Add a 'stress' page to the local copy: 200 real screens (the End to end frames), 8 per row."""
import json, urllib.request, http.cookiejar
L = "http://localhost:4477"; loc = json.load(open("local.json")); c = json.load(open("canvas.json"))
cj = http.cookiejar.CookieJar(); op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
def req(method, path, body=None):
    r = urllib.request.Request(L + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers={"content-type": "application/json", "origin": L})
    with op.open(r, timeout=60) as resp: t = resp.read().decode(); return json.loads(t) if t.strip().startswith(("{", "[")) else t
req("POST", "/api/auth/sign-in/email", {"email": loc["email"], "password": loc["password"]})
cid = loc["canvas"]; cur = req("GET", f"/api/canvases/{cid}")
pages = [{"id": p["id"], "name": p["name"]} for p in cur["pages"]]
if not any(p["id"] == "stress" for p in pages):
    req("PUT", f"/api/canvases/{cid}/pages", {"expectedPages": pages, "pages": pages + [{"id": "stress", "name": "Stress: 200 frames"}]})
src = [f for f in c["frames"] if f["pageId"].startswith("e2e") and not f["name"].startswith("§") and f["width"] == 1440][:200]
for i, f in enumerate(src):
    req("POST", f"/api/canvases/{cid}/frames", {"name": f["name"], "pageId": "stress", "x": (i % 8) * 1600, "y": (i // 8) * 1100, "width": 1440, "height": 900, "html": f["html"]})
print("stress frames", len(src))
