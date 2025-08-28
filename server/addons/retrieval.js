// retrieval.js
// Wraps embedding + Pinecone query, with helpers for binding stage

export async function vectorSearch({ embed, pineconeQuery, queryOrHint, clientId, topK }) {
  const [vec] = await embed([String(queryOrHint || '').trim()]);
  const results = await pineconeQuery(vec, clientId, Number(topK) || 50);
  const matches = Array.isArray(results?.matches) ? results.matches : [];
  return matches.sort((a,b)=>(b.score||0)-(a.score||0));
}

export function detectTimeseries(text){
  return /(over time|trend|last \d+ (years|months)|\b20\d{2}\b.*\b20\d{2}\b)/i.test(String(text||''));
}

export function parseSeries(snippet){
  const s = String(snippet||'');
  const pairs = [];
  const re = /(\b[A-Za-z][A-Za-z\s\/&-]{1,40}\b)\s*[:\-]?\s*(\d{1,3})(?:\.\d+)?%/g;
  let m; const seen = new Set();
  while ((m = re.exec(s))) {
    const label = m[1].trim();
    const key = label.toLowerCase();
    if (seen.has(key)) continue; seen.add(key);
    const value = Number(m[2]);
    if (Number.isFinite(value)) pairs.push({ label, value });
    if (pairs.length >= 12) break;
  }
  return pairs;
}

export function extractQuotes(snippet){
  const out = [];
  const re = /"([^"]{10,200})"/g;
  let m;
  while ((m = re.exec(String(snippet||'')))) {
    const text = m[1].trim();
    if (text.length <= 180) out.push({ text });
    if (out.length >= 5) break;
  }
  return out;
}

export function filterSlides(chunks){
  return (chunks||[]).filter(c => {
    const name = String(c.fileName||'').toLowerCase();
    const page = Number(c.page||c.pageNumber||1);
    const looksTitle = /title|agenda|contents|divider/.test(name) || page===1;
    return c.fileId && !looksTitle;
  });
}

export default { vectorSearch, detectTimeseries, parseSeries, extractQuotes, filterSlides };

