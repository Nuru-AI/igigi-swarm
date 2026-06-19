/**
 * The render-verified economy — the agent's menu of REAL services it can buy.
 *
 * The first 21 were each confirmed on mainnet (paid AND returned genuine output),
 * 2026-06-16, for ~$0.46 total. Source: Sippar Notion "Swarm verified economy".
 * Expanded 2026-06-19 with 10 more Locus MPP services, each PAID + RENDERED on
 * Tempo mainnet (raw responses in test-results/; harness: verify-mpp.py).
 * `inputHint` tells the agent the request shape (it fills the rest).
 *
 * BLOCKED on Locus upstream (NOT added — re-test before adding): the entire
 * Abstract API family — abstract-exchange-rates / -timezone / -holidays /
 * -ip-intelligence / -company-enrichment / -phone-intelligence. All 6 return
 * 502 "Upstream API call failed". Root cause triangulated 2026-06-19:
 *   (1) OpenAPI schema (GET .../openapi.json) confirms our payloads were exactly
 *       correct (required fields present, valid values);
 *   (2) the INDEPENDENT Wrapped path (beta-api.paywithlocus.com/api/wrapped/<svc>,
 *       Locus key, no Tempo payment, no Sippar) fails IDENTICALLY — so it is not
 *       our payload, not the MPP payment path, not Sippar;
 *   (3) control: wrapped ipinfo + coingecko on the same key/path return 200 real
 *       data — so the key/path are healthy; the break is Abstract-specific.
 * => Locus's own abstractapi.com upstream integration (key/quota) is down for the
 *    whole family. External dependency. Failed MPP calls auto-refund (~2min).
 *
 * Also INVESTIGATING (NOT added): mapbox/directions, hunter/domain-search,
 * hunter/company-enrichment — all 502 via the MPP path. NOTE mapbox/directions is
 * MPP-path-specific: the Wrapped path returns a real route with the same payload,
 * so the upstream + payload are fine; it's a Locus MPP-directions endpoint issue
 * (mapbox geocode-forward/reverse via MPP work fine). clado/search + apollo/
 * people-search return 200 but ZERO results on this account (plan-limited) — not a
 * usable render, so not added.
 */
export interface Service {
  id: string;
  name: string;
  category: 'llm' | 'search' | 'translate' | 'market-data' | 'web-data' | 'geo' | 'computational' | 'developer' | 'compliance' | 'security' | 'real-estate' | 'weather';
  price: number;
  chain: 'tempo' | 'base';
  url: string;
  description: string;
  inputHint: Record<string, string>;
}

export const VERIFIED_SERVICES: Service[] = [
  // LLM inference
  { id: 'groq',      name: 'Groq (Llama 3.3 70B)', category: 'llm', price: 0.008, chain: 'tempo', url: 'https://groq.mpp.paywithlocus.com/groq/chat',         description: 'Fast LLM chat completion', inputHint: { model: 'llama-3.3-70b-versatile', messages: '[{role,content}]' } },
  { id: 'deepseek',  name: 'DeepSeek',            category: 'llm', price: 0.004, chain: 'tempo', url: 'https://deepseek.mpp.paywithlocus.com/deepseek/chat', description: 'LLM chat completion',      inputHint: { model: 'deepseek-chat', messages: '[{role,content}]' } },
  { id: 'mistral',   name: 'Mistral',             category: 'llm', price: 0.008, chain: 'tempo', url: 'https://mistral.mpp.paywithlocus.com/mistral/chat',   description: 'LLM chat completion',      inputHint: { model: 'mistral-small-latest', messages: '[{role,content}]' } },
  // Search
  { id: 'tavily',    name: 'Tavily Search',       category: 'search', price: 0.09,  chain: 'tempo', url: 'https://tavily.mpp.paywithlocus.com/tavily/search', description: 'AI web search + answer', inputHint: { query: 'string' } },
  { id: 'brave',     name: 'Brave Search',        category: 'search', price: 0.035, chain: 'tempo', url: 'https://brave.mpp.paywithlocus.com/brave/web-search', description: 'Web search results',    inputHint: { q: 'string' } },
  // Translate
  { id: 'deepl',     name: 'DeepL Translate',     category: 'translate', price: 0.025, chain: 'tempo', url: 'https://deepl.mpp.paywithlocus.com/deepl/translate', description: 'Translation', inputHint: { text: '[string]', target_lang: 'e.g. DE' } },
  // Market / crypto data
  { id: 'coingecko', name: 'CoinGecko Prices',    category: 'market-data', price: 0.06,  chain: 'tempo', url: 'https://coingecko.mpp.paywithlocus.com/coingecko/simple-price', description: 'Crypto spot prices', inputHint: { ids: 'bitcoin,ethereum', vs_currencies: 'usd' } },
  { id: 'alphavantage', name: 'AlphaVantage',     category: 'market-data', price: 0.008, chain: 'tempo', url: 'https://alphavantage.mpp.paywithlocus.com/alphavantage/global-quote', description: 'Real-time stock quote (price, volume, day range)', inputHint: { symbol: 'NVDA' } },
  { id: 'heurist-trending', name: 'Heurist Trending', category: 'market-data', price: 0.002, chain: 'base', url: 'https://mesh.heurist.xyz/x402/agents/TrendingTokenAgent/get_trending_tokens', description: 'Trending tokens', inputHint: {} },
  { id: 'heurist-funding',  name: 'Heurist Funding',  category: 'market-data', price: 0.001, chain: 'base', url: 'https://mesh.heurist.xyz/x402/agents/FundingRateAgent/get_all_funding_rates', description: 'Perp funding rates', inputHint: {} },
  { id: 'chainray-gas', name: 'ChainRay Gas Oracle', category: 'market-data', price: 0.01, chain: 'base', url: 'https://chainray.online/gas-oracle', description: 'Multi-chain gas prices', inputHint: {} },
  // Web / IP / geo
  { id: 'ipinfo',    name: 'IPinfo',              category: 'web-data', price: 0.001, chain: 'tempo', url: 'https://ipinfo.mpp.paywithlocus.com/ipinfo/ip-lite', description: 'IP geolocation/ASN', inputHint: { ip: 'string' } },
  { id: 'openweather', name: 'OpenWeather Geocode', category: 'geo', price: 0.005, chain: 'tempo', url: 'https://openweather.mpp.paywithlocus.com/openweather/geocode', description: 'Place -> lat/lon', inputHint: { q: 'city' } },
  { id: 'mapbox',    name: 'Mapbox Geocode',      category: 'geo', price: 0.00375, chain: 'tempo', url: 'https://mapbox.mpp.paywithlocus.com/mapbox/geocode-forward', description: 'Forward geocode', inputHint: { q: 'place' } },
  { id: 'padelmaps', name: 'PadelMaps Geocode',   category: 'geo', price: 0.01, chain: 'base', url: 'https://padelmaps.org/api/x402-tools/geocode', description: 'Geocode address', inputHint: { address: 'string' } },
  // Company / web intel
  { id: 'hunter',    name: 'Hunter Email Count',  category: 'web-data', price: 0.003, chain: 'tempo', url: 'https://hunter.mpp.paywithlocus.com/hunter/email-count', description: 'Emails for a domain', inputHint: { domain: 'string' } },
  { id: 'edgar',     name: 'SEC EDGAR',           category: 'web-data', price: 0.008, chain: 'tempo', url: 'https://edgar.mpp.paywithlocus.com/edgar/company-submissions', description: 'SEC company filings', inputHint: { cik: 'e.g. 0000320193' } },
  { id: 'builtwith', name: 'BuiltWith',           category: 'web-data', price: 0.015, chain: 'tempo', url: 'https://builtwith.mpp.paywithlocus.com/builtwith/free', description: 'Site tech stack', inputHint: { LOOKUP: 'domain' } },
  { id: 'diffbot',   name: 'Diffbot Article',     category: 'web-data', price: 0.0042, chain: 'tempo', url: 'https://diffbot.mpp.paywithlocus.com/diffbot/article', description: 'Article extraction', inputHint: { url: 'string' } },
  // Computational
  { id: 'wolfram',   name: 'WolframAlpha',        category: 'computational', price: 0.055, chain: 'tempo', url: 'https://wolframalpha.mpp.paywithlocus.com/wolframalpha/short-answer', description: 'Computational answer', inputHint: { i: 'question' } },
  { id: 'paysponge-rent', name: 'Rentcast Property', category: 'web-data', price: 0.01, chain: 'base', url: 'https://rentcast.x402.paysponge.com/properties/random', description: 'Random property record', inputHint: {} },

  // --- Locus MPP expansion: each PAID + RENDERED on Tempo mainnet 2026-06-19 (see test-results/) ---
  // LLM / AI search
  { id: 'grok',             name: 'Grok (xAI)',            category: 'llm', price: 0.006, chain: 'tempo', url: 'https://grok.mpp.paywithlocus.com/grok/chat', description: 'xAI Grok chat completion (OpenAI-compatible)', inputHint: { model: 'grok-3-mini', messages: '[{role,content}]' } },
  { id: 'perplexity-chat',  name: 'Perplexity Sonar',      category: 'llm', price: 0.02, chain: 'tempo', url: 'https://perplexity.mpp.paywithlocus.com/perplexity/chat', description: 'Sonar chat with real-time web grounding + citations', inputHint: { model: 'sonar', messages: '[{role,content}]' } },
  // Search
  { id: 'perplexity-search', name: 'Perplexity Web Search', category: 'search', price: 0.006, chain: 'tempo', url: 'https://perplexity.mpp.paywithlocus.com/perplexity/search', description: 'Ranked web results (title/url/snippet/date)', inputHint: { query: 'string', max_results: '5' } },
  // Web / company / filings intel
  { id: 'diffbot-nl',       name: 'Diffbot NL',            category: 'web-data', price: 0.0042, chain: 'tempo', url: 'https://diffbot-nl.mpp.paywithlocus.com/diffbot-nl/analyze', description: 'NER + sentiment + facts on text', inputHint: { content: 'string', fields: 'entities,sentiment' } },
  { id: 'diffbot-kg',       name: 'Diffbot Knowledge Graph', category: 'web-data', price: 0.035, chain: 'tempo', url: 'https://diffbot-kg.mpp.paywithlocus.com/diffbot-kg/enhance', description: 'Enrich a company/person from the 10B-entity KG', inputHint: { type: 'Organization|Person', name: 'string' } },
  { id: 'edgar-search',     name: 'SEC EDGAR Full-Text',   category: 'web-data', price: 0.008, chain: 'tempo', url: 'https://edgar-search.mpp.paywithlocus.com/edgar-search/search', description: 'Full-text search across all SEC filings', inputHint: { q: 'string', forms: 'e.g. 10-K', hits: '3' } },
  { id: 'rentcast',         name: 'RentCast Market Stats', category: 'real-estate', price: 0.033, chain: 'tempo', url: 'https://rentcast.mpp.paywithlocus.com/rentcast/markets', description: 'US zip-code sale/rental market statistics', inputHint: { zipCode: '5-digit', dataType: 'All|Sale|Rental' } },
  // Compliance / security
  { id: 'ofac',             name: 'OFAC Sanctions Screen', category: 'compliance', price: 0.012, chain: 'tempo', url: 'https://ofac.mpp.paywithlocus.com/ofac/screen', description: 'Screen names/wallets vs 25+ sanctions lists', inputHint: { cases: '[{name}]' } },
  { id: 'virustotal',       name: 'VirusTotal Domain',     category: 'security', price: 0.055, chain: 'tempo', url: 'https://virustotal.mpp.paywithlocus.com/virustotal/domain-report', description: 'Domain reputation across 70+ engines + RDAP/DNS', inputHint: { domain: 'string' } },
  // Developer / code execution
  { id: 'judge0',           name: 'Judge0 Code Exec',      category: 'developer', price: 0.006, chain: 'tempo', url: 'https://judge0.mpp.paywithlocus.com/judge0/execute-code', description: 'Run code in 60+ languages, returns stdout/stderr', inputHint: { source_code: 'string', language_id: '71=Python 63=JS 54=C++ 62=Java' } },

  // --- Round 2 (2026-06-19): more endpoints of already-healthy upstreams, each PAID + RENDERED ---
  // Weather (OpenWeather — same provider as the verified geocode entry)
  { id: 'openweather-weather', name: 'OpenWeather Current', category: 'weather', price: 0.006, chain: 'tempo', url: 'https://openweather.mpp.paywithlocus.com/openweather/current-weather', description: 'Current conditions by lat/lon (temp, wind, clouds)', inputHint: { lat: 'number', lon: 'number', units: 'metric|imperial' } },
  { id: 'openweather-aqi',  name: 'OpenWeather Air Quality', category: 'weather', price: 0.006, chain: 'tempo', url: 'https://openweather.mpp.paywithlocus.com/openweather/air-quality', description: 'Air Quality Index + pollutants by lat/lon', inputHint: { lat: 'number', lon: 'number' } },
  // Financial data (AlphaVantage — same provider as the verified global-quote entry)
  { id: 'av-news',          name: 'AlphaVantage News',     category: 'market-data', price: 0.008, chain: 'tempo', url: 'https://alphavantage.mpp.paywithlocus.com/alphavantage/news-sentiment', description: 'Market news + AI sentiment scores', inputHint: { tickers: 'AAPL,MSFT', limit: '5' } },
  { id: 'av-company',       name: 'AlphaVantage Overview', category: 'market-data', price: 0.008, chain: 'tempo', url: 'https://alphavantage.mpp.paywithlocus.com/alphavantage/company-overview', description: 'Company fundamentals (sector, P/E, market cap)', inputHint: { symbol: 'AAPL' } },
  { id: 'av-fx',            name: 'AlphaVantage FX Rate',  category: 'market-data', price: 0.008, chain: 'tempo', url: 'https://alphavantage.mpp.paywithlocus.com/alphavantage/currency-exchange-rate', description: 'Realtime fiat/crypto exchange rate', inputHint: { from_currency: 'USD', to_currency: 'EUR' } },
  { id: 'av-macro',         name: 'AlphaVantage Macro',    category: 'market-data', price: 0.008, chain: 'tempo', url: 'https://alphavantage.mpp.paywithlocus.com/alphavantage/economic-indicator', description: 'US economic indicators (CPI, GDP, yields, etc.)', inputHint: { indicator: 'CPI|REAL_GDP|UNEMPLOYMENT|TREASURY_YIELD' } },
  // Crypto data (CoinGecko — same provider as the verified simple-price entry)
  { id: 'coingecko-trending', name: 'CoinGecko Trending',  category: 'market-data', price: 0.06, chain: 'tempo', url: 'https://coingecko.mpp.paywithlocus.com/coingecko/trending', description: 'Trending coins/NFTs/categories (last 24h)', inputHint: {} },

  // --- Round 3 (2026-06-19): search/geo variants + new data providers, each PAID + RENDERED ---
  { id: 'brave-news',       name: 'Brave News Search',     category: 'search', price: 0.035, chain: 'tempo', url: 'https://brave.mpp.paywithlocus.com/brave/news-search', description: 'News results from Brave independent index', inputHint: { q: 'string', count: '5' } },
  { id: 'brave-llm',        name: 'Brave LLM Context',     category: 'search', price: 0.035, chain: 'tempo', url: 'https://brave.mpp.paywithlocus.com/brave/llm-context', description: 'Pre-extracted web content for RAG/grounding', inputHint: { q: 'string' } },
  { id: 'mapbox-reverse',   name: 'Mapbox Reverse Geocode', category: 'geo', price: 0.004, chain: 'tempo', url: 'https://mapbox.mpp.paywithlocus.com/mapbox/geocode-reverse', description: 'Coordinates -> place/address', inputHint: { longitude: 'number', latitude: 'number' } },
  { id: 'tavily-extract',   name: 'Tavily Extract',        category: 'web-data', price: 0.11, chain: 'tempo', url: 'https://tavily.mpp.paywithlocus.com/tavily/extract', description: 'Clean LLM-ready content from URLs', inputHint: { urls: '[url]' } },
  { id: 'apollo-org',       name: 'Apollo Org Enrichment', category: 'web-data', price: 0.008, chain: 'tempo', url: 'https://apollo.mpp.paywithlocus.com/apollo/org-enrichment', description: 'Company data (industry, size, funding, socials)', inputHint: { domain: 'string' } },
  { id: 'hunter-verify',    name: 'Hunter Email Verifier', category: 'web-data', price: 0.008, chain: 'tempo', url: 'https://hunter.mpp.paywithlocus.com/hunter/email-verifier', description: 'Email deliverability + confidence score', inputHint: { email: 'string' } },
];
