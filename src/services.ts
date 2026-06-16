/**
 * The render-verified economy — the agent's menu of REAL services it can buy.
 *
 * These 21 were each confirmed on mainnet (paid AND returned genuine output),
 * 2026-06-16, for ~$0.46 total. Source: Sippar Notion "Swarm verified economy".
 * `inputHint` tells the agent the request shape (it fills the rest).
 */
export interface Service {
  id: string;
  name: string;
  category: 'llm' | 'search' | 'translate' | 'market-data' | 'web-data' | 'geo' | 'computational';
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
  { id: 'alphavantage', name: 'AlphaVantage',     category: 'market-data', price: 0.008, chain: 'tempo', url: 'https://alphavantage.mpp.paywithlocus.com/alphavantage/time-series-intraday', description: 'Stock intraday series', inputHint: { symbol: 'IBM', interval: '5min' } },
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
];
