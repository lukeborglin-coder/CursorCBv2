// planner.js
// LLM-backed (optional) layout planner with rule-based fallback

import OpenAI from 'openai';

const DEFAULT_TIMEOUT_MS = 1200;

export async function planLayout({ query, signals, forcePlan, forceBlocks, model, apiKey }) {
  const palette = ['headline','text','chart','table','quote','slide','group'];

  // Apply forceBlocks override: create a minimal plan using provided kinds
  if (Array.isArray(forceBlocks) && forceBlocks.length) {
    const layout = forceBlocks.map(kind => ({ kind: String(kind) }));
    return { layout, plan: (forcePlan || 'rich'), usedFallback: true };
  }

  const desiredPlan = forcePlan || (signals?.hasQual ? 'rich' : 'simple');

  // Try small LLM call with timeout
  if (apiKey && model) {
    try {
      const openai = new OpenAI({ apiKey });
      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      const sys = 'You are a senior market researcher composing a report out of blocks (text, chart, table, quote, slide, group). You decide which blocks to use and how to arrange them to best answer the query. Do not write long essays; prefer concise, decision-useful blocks.';
      const usr = `Given the query and these content availability signals, output ONLY a JSON array named layoutPlan consisting of block requests in desired order. Use kinds from: headline, text, chart, table, quote, slide, group(cols=2|3 with inner kinds). Keep it minimal and relevant.\nInput:\nquery: ${query}\nsignals: ${JSON.stringify(signals)}\n\nOutput example:\n{"layoutPlan":[{"kind":"headline"},{"kind":"group","cols":3,"blocks":[{"kind":"text"},{"kind":"chart"},{"kind":"quote"}]},{"kind":"text"},{"kind":"slide"}]}`;
      const cmp = await openai.chat.completions.create({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: usr }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 350,
        signal: controller.signal
      });
      clearTimeout(to);
      const txt = cmp.choices?.[0]?.message?.content || '{}';
      const obj = JSON.parse(txt);
      const layout = Array.isArray(obj.layoutPlan) ? obj.layoutPlan : [];
      if (layout.length) return { layout, plan: desiredPlan, usedFallback: false };
    } catch (_) {
      // fall through to rules
    }
  }

  // Rule-based fallback per spec 4A
  const hasTimeseries = !!signals?.hasTimeseries;
  const hasQuant = !!signals?.hasQuant;
  const hasQual = !!signals?.hasQual;

  const layout = [];
  if (desiredPlan === 'simple') {
    if (hasTimeseries || (hasQuant && !hasQual)) {
      layout.push({ kind: 'chart' });
      layout.push({ kind: 'text' });
    } else {
      layout.push({ kind: 'text' });
      layout.push({ kind: 'table' });
    }
  } else {
    // rich
    layout.push({ kind: 'headline' });
    layout.push({ kind: 'group', cols: 3, blocks: [ { kind: 'text' }, { kind: hasQuant ? 'chart' : 'table' }, { kind: 'quote' } ] });
    layout.push({ kind: 'text' });
    layout.push({ kind: 'slide' });
  }

  return { layout, plan: desiredPlan, usedFallback: true };
}

export default { planLayout };

