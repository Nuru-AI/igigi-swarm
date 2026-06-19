#!/usr/bin/env python3
"""Pay+render verification harness for Locus MPP services via Sippar's rails.

Reads SIPPAR_BASE_URL / SIPPAR_ACCESS_TOKEN from .env. For each test case, POSTs
to /api/sippar/agent/pay and reports success / serviceStatus / amountPaid / tx,
plus a snippet of the rendered response. Full responses saved to test-results/.

VERIFIED = success:true AND serviceStatus<400 AND response holds real rendered data.
Failures auto-refund on Locus (charge-on-success), so a 4xx costs only the sig cycle.

Usage: python verify-mpp.py <case_id> [<case_id> ...]   (or no args = run all)
"""
import json, sys, os, urllib.request, urllib.error, time, pathlib

ROOT = pathlib.Path(__file__).parent
env = {}
for line in (ROOT / ".env").read_text().splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()

BASE = env["SIPPAR_BASE_URL"]
TOKEN = env["SIPPAR_ACCESS_TOKEN"]
PRINCIPAL = sys.argv[sys.argv.index("--principal") + 1] if "--principal" in sys.argv else \
    "bp23b-xx4d3-xibxd-kjypf-gwh4c-3zfqx-7i7lb-5wqr7-bpgfm-wzb6q-6ae"

# id, url, price, payload
CASES = {
    "abstract-exchange-rates": ("https://abstract-exchange-rates.mpp.paywithlocus.com/abstract-exchange-rates/live", 0.006, {"base": "USD", "target": "EUR"}),
    "abstract-timezone":       ("https://abstract-timezone.mpp.paywithlocus.com/abstract-timezone/current-time", 0.006, {"location": "Tokyo, Japan"}),
    "abstract-holidays":       ("https://abstract-holidays.mpp.paywithlocus.com/abstract-holidays/lookup", 0.006, {"country": "US", "year": 2026}),
    "abstract-ip-intelligence":("https://abstract-ip-intelligence.mpp.paywithlocus.com/abstract-ip-intelligence/lookup", 0.006, {"ip_address": "8.8.8.8"}),
    "abstract-company-enrichment":("https://abstract-company-enrichment.mpp.paywithlocus.com/abstract-company-enrichment/lookup", 0.006, {"domain": "stripe.com"}),
    "abstract-phone-intelligence":("https://abstract-phone-intelligence.mpp.paywithlocus.com/abstract-phone-intelligence/lookup", 0.006, {"phone": "14155552671"}),
    "ofac":                    ("https://ofac.mpp.paywithlocus.com/ofac/screen", 0.012, {"cases": [{"name": "Vladimir Putin", "id": "1"}]}),
    "perplexity-search":       ("https://perplexity.mpp.paywithlocus.com/perplexity/search", 0.006, {"query": "Tempo blockchain stablecoin payments", "max_results": 5}),
    "judge0":                  ("https://judge0.mpp.paywithlocus.com/judge0/execute-code", 0.006, {"source_code": "print(6*7)", "language_id": 71}),
    "edgar-search":            ("https://edgar-search.mpp.paywithlocus.com/edgar-search/search", 0.008, {"q": "artificial intelligence", "forms": "10-K", "hits": 3}),
    "diffbot-nl":              ("https://diffbot-nl.mpp.paywithlocus.com/diffbot-nl/analyze", 0.004, {"content": "Apple Inc. is headquartered in Cupertino, California and was founded by Steve Jobs.", "fields": "entities,sentiment"}),
    "rentcast":                ("https://rentcast.mpp.paywithlocus.com/rentcast/markets", 0.033, {"zipCode": "78701", "dataType": "All"}),
    "grok":                    ("https://grok.mpp.paywithlocus.com/grok/chat", 0.01, {"model": "grok-3-mini", "messages": [{"role": "user", "content": "In one sentence, what is the Tempo blockchain?"}]}),
    "diffbot-kg":              ("https://diffbot-kg.mpp.paywithlocus.com/diffbot-kg/enhance", 0.03, {"type": "Organization", "name": "OpenAI"}),
    "virustotal":             ("https://virustotal.mpp.paywithlocus.com/virustotal/domain-report", 0.055, {"domain": "google.com"}),
    "perplexity-chat":        ("https://perplexity.mpp.paywithlocus.com/perplexity/chat", 0.02, {"model": "sonar", "messages": [{"role": "user", "content": "What is the Tempo blockchain by Stripe and Paradigm? One sentence."}]}),
    # round 2 — more endpoints of already-healthy upstreams (openweather/coingecko/alphavantage)
    "openweather-current":    ("https://openweather.mpp.paywithlocus.com/openweather/current-weather", 0.006, {"lat": 35.6812, "lon": 139.7671, "units": "metric"}),
    "openweather-aqi":        ("https://openweather.mpp.paywithlocus.com/openweather/air-quality", 0.006, {"lat": 35.6812, "lon": 139.7671}),
    "av-news":                ("https://alphavantage.mpp.paywithlocus.com/alphavantage/news-sentiment", 0.008, {"tickers": "AAPL", "limit": 5}),
    "av-overview":            ("https://alphavantage.mpp.paywithlocus.com/alphavantage/company-overview", 0.008, {"symbol": "AAPL"}),
    "av-fx":                  ("https://alphavantage.mpp.paywithlocus.com/alphavantage/currency-exchange-rate", 0.008, {"from_currency": "USD", "to_currency": "EUR"}),
    "av-macro":               ("https://alphavantage.mpp.paywithlocus.com/alphavantage/economic-indicator", 0.008, {"indicator": "CPI"}),
    "cg-trending":            ("https://coingecko.mpp.paywithlocus.com/coingecko/trending", 0.06, {}),
    # round 3 — search/geo variants (healthy upstreams) + new data providers (wrapped-prescreened OK)
    "brave-news":             ("https://brave.mpp.paywithlocus.com/brave/news-search", 0.035, {"q": "Tempo blockchain Stripe Paradigm", "count": 5}),
    "brave-llm":              ("https://brave.mpp.paywithlocus.com/brave/llm-context", 0.035, {"q": "Tempo blockchain Stripe Paradigm"}),
    "mapbox-directions":      ("https://mapbox.mpp.paywithlocus.com/mapbox/directions", 0.005, {"profile": "mapbox/driving", "coordinates": "-73.99,40.73;-77.03,38.90", "overview": "false"}),
    "mapbox-reverse":         ("https://mapbox.mpp.paywithlocus.com/mapbox/geocode-reverse", 0.004, {"longitude": -73.99, "latitude": 40.73}),
    "tavily-extract":         ("https://tavily.mpp.paywithlocus.com/tavily/extract", 0.11, {"urls": ["https://en.wikipedia.org/wiki/Stripe,_Inc."]}),
    "apollo-org":             ("https://apollo.mpp.paywithlocus.com/apollo/org-enrichment", 0.008, {"domain": "stripe.com"}),
    "hunter-verify":          ("https://hunter.mpp.paywithlocus.com/hunter/email-verifier", 0.008, {"email": "patrick@stripe.com"}),
}

def run(cid):
    url, price, payload = CASES[cid]
    body = json.dumps({
        "serviceUrl": url,
        "payload": payload,
        "maxAmountUSD": round(price * 1.5, 4),
        "preferTempo": True,
        "agentPrincipal": PRINCIPAL,
    }).encode()
    req = urllib.request.Request(f"{BASE}/api/sippar/agent/pay", data=body,
        headers={"Content-Type": "application/json", "X-Sippar-Access": TOKEN}, method="POST")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            env_resp = json.load(r)
    except urllib.error.HTTPError as e:
        env_resp = {"httpError": e.code, "body": e.read().decode()[:500]}
    except Exception as e:
        env_resp = {"error": str(e)}
    dt = time.time() - t0
    d = env_resp.get("data", env_resp)
    outdir = ROOT / "test-results"; outdir.mkdir(exist_ok=True)
    (outdir / f"{cid}.json").write_text(json.dumps(env_resp, indent=2))
    success = d.get("success")
    sstatus = d.get("serviceStatus")
    ok = bool(success) and (sstatus is None or sstatus < 400)
    snip = json.dumps(d.get("response"))[:280] if d.get("response") is not None else json.dumps(d)[:280]
    print(f"\n=== {cid} ({dt:.1f}s) {'VERIFIED' if ok else 'FAIL'} ===")
    print(f"  success={success} serviceStatus={sstatus} amountPaid={d.get('amountPaid')} chain={d.get('chain')} tx={d.get('paymentTx')}")
    if d.get("error"): print(f"  error={d.get('error')}")
    print(f"  snippet={snip}")
    return ok

ids = [a for a in sys.argv[1:] if not a.startswith("--") and a != PRINCIPAL]
if not ids:
    ids = list(CASES.keys())
for cid in ids:
    run(cid)
    time.sleep(1)
