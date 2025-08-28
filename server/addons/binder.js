// binder.js
// Deterministic binding of a layout plan into hydrated blocks

import { vectorSearch, parseSeries, extractQuotes, filterSlides } from './retrieval.js';
import { validateLayout, validateBlock } from './validators.js';

function selectTopQuotes(chunks, cap){
  const out = [];
  const seen = new Set();
  for (const c of chunks){
    for (const q of extractQuotes(c.textSnippet||'')){
      const key = q.text.trim().toLowerCase();
      if (seen.has(key)) continue; seen.add(key);
      out.push({ kind:'quote', text: q.text, speaker: null, role: null });
      if (out.length >= cap) return out;
    }
  }
  return out;
}

function buildChartFromChunk(c){
  const pairs = parseSeries(c.textSnippet||'');
  if (!pairs || pairs.length < 2) return null;
  return {
    kind: 'chart',
    title: null,
    series: [{ name: 'Series', points: pairs.map(p=>({ x: p.label, y: Number(p.value)||0 })) }],
    xLabel: null,
    yLabel: null,
    valueFormat: 'percent'
  };
}

function buildTableFromChunks(chunks){
  // Simple prevalence table from first match
  for (const c of chunks){
    const pairs = parseSeries(c.textSnippet||'');
    if (pairs.length >= 2){
      return {
        kind: 'table',
        title: null,
        columns: [ { key:'label', label:'Item' }, { key:'value', label:'%'} ],
        rows: pairs.map(p=>({ label: p.label, value: p.value })),
        notes: null,
        maxRows: 50
      };
    }
  }
  return null;
}

export async function* bind({ plan, query, clientId, topK, searchFns, textModel, maxCaps }){
  const caps = Object.assign({ charts: 2, quotes: 3, slides: 6 }, maxCaps||{});
  let chartsUsed = 0, quotesUsed = 0, slidesUsed = 0;

  // Retrieve a broad set once
  const matches = await vectorSearch({ embed: searchFns.embed, pineconeQuery: searchFns.pineconeQuery, queryOrHint: query, clientId, topK });
  const chunks = matches.map((m,i)=> ({ id: `ref${i+1}`, score: m.score||0, ...(m.metadata||{}) }));

  const validatedPlan = validateLayout(plan);
  const layout = validatedPlan.map(b => ({ ...b }));

  // Emit initial plan
  yield { type:'plan', layout };

  // Iterate and hydrate positions
  for (let i=0;i<layout.length;i++){
    const b = layout[i];
    const updates = [];
    if (b.kind === 'group'){
      const groupBlocks = [];
      for (const gb of (b.blocks||[])){
        const filled = await hydrateOne(gb);
        if (filled) groupBlocks.push(filled);
      }
      if (groupBlocks.length){
        updates.push({ kind:'group', cols: b.cols, blocks: groupBlocks });
      }
    } else {
      const filled = await hydrateOne(b);
      if (filled) updates.push(filled);
    }
    if (updates.length){
      yield { type:'partial', targetIndex: i, blocks: updates };
    }
  }

  // Final layout (validate again)
  const finalLayout = validateLayout(layout);
  yield { type:'final', layout: finalLayout, citations: [] };

  async function hydrateOne(b){
    if (b.kind === 'chart' && chartsUsed < caps.charts){
      for (const c of matches){
        const m = c?.metadata || c;
        const built = buildChartFromChunk(m);
        if (built) { chartsUsed++; return validateBlock(built); }
      }
      // fallback to table if chart not possible
      const tbl = buildTableFromChunks(matches.map(x=>x.metadata||x));
      if (tbl) return validateBlock(tbl);
      return validateBlock({ kind:'text', text:'Quantitative evidence insufficient to create a chart.' });
    }
    if (b.kind === 'table'){
      const tbl = buildTableFromChunks(matches.map(x=>x.metadata||x));
      if (tbl) return validateBlock(tbl);
      return validateBlock({ kind:'text', text:'Tabular evidence insufficient; no structured data available.' });
    }
    if (b.kind === 'quote' && quotesUsed < caps.quotes){
      const qs = selectTopQuotes(matches.map(x=>x.metadata||x), caps.quotes - quotesUsed);
      if (qs.length){ quotesUsed += qs.length; return validateBlock(qs[0]); }
      return null;
    }
    if (b.kind === 'slide' && slidesUsed < caps.slides){
      const slides = filterSlides(matches.map(x=>x.metadata||x));
      if (slides.length){
        slidesUsed++;
        return validateBlock({ kind:'slide', reportId: slides[0].fileId, page: Number(slides[0].page||slides[0].pageNumber||2) });
      }
      return null;
    }
    if (b.kind === 'text'){
      // Simple narrative synthesis using tiny model if available
      if (textModel && searchFns.openai){
        const context = matches.slice(0,6).map(m=>String(m?.metadata?.text||m?.metadata?.content||'').slice(0,280)).filter(Boolean).join('\n');
        try{
          const prompt = `Write 2-3 concise sentences summarizing evidence relevant to: ${query}. Keep 240-420 chars; executive tone.`;
          const r = await searchFns.openai.chat.completions.create({ model: textModel, temperature: 0.3, max_tokens: 180, messages:[{ role:'user', content: prompt + "\n\n" + context }]});
          const text = r.choices?.[0]?.message?.content?.trim() || '';
          if (text) return validateBlock({ kind:'text', text });
        }catch(_){ /* ignore */ }
      }
      return validateBlock({ kind:'text', text:'Relevant evidence indicates several themes; see adjacent blocks.' });
    }
    if (b.kind === 'headline'){
      return validateBlock({ kind:'headline', text: 'Answer overview' });
    }
    return null;
  }
}

export default { bind };

