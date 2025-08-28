// validators.js
// Validate and sanitize block structures

export function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

export function validateBlock(block){
  if (!block || typeof block !== 'object') return null;
  const kind = String(block.kind||'');
  switch(kind){
    case 'headline':
      return { kind:'headline', id: block.id||undefined, text: String(block.text||'').slice(0, 240) };
    case 'text':
      return { kind:'text', id: block.id||undefined, text: String(block.text||'').slice(0, 600), style: block.style==='callout'?'callout':'body' };
    case 'quote': {
      const text = String(block.text||'').slice(0, 180);
      const speaker = block.speaker ? String(block.speaker) : null;
      const role = block.role && ['Patient','HCP','Caregiver'].includes(block.role) ? block.role : null;
      return { kind:'quote', id: block.id||undefined, text, speaker, role };
    }
    case 'chart': {
      const series = Array.isArray(block.series) ? block.series.slice(0, 8).map(s=>({
        name: String(s.name||s.label||'Series'),
        points: Array.isArray(s.points) ? s.points.slice(0,50).map(p=>({ x: (typeof p.x==='number'||typeof p.x==='string')?p.x: String(p.x||''), y: Number(p.y)||0 })) : []
      })) : [];
      const vf = ['percent','number','index'].includes(block.valueFormat) ? block.valueFormat : null;
      return { kind:'chart', id: block.id||undefined, title: block.title||null, series, xLabel: block.xLabel||null, yLabel: block.yLabel||null, valueFormat: vf };
    }
    case 'table': {
      const cols = Array.isArray(block.columns) ? block.columns.slice(0, 12).map(c=>({ key:String(c.key||c.label||'col').slice(0,24), label:String(c.label||c.key||'').slice(0,32) })) : [];
      const rows = Array.isArray(block.rows) ? block.rows.slice(0, clamp(Number(block.maxRows)||50,1,50)) : [];
      const notes = Array.isArray(block.notes) ? block.notes.slice(0,3).map(s=>String(s).slice(0,160)) : null;
      return { kind:'table', id: block.id||undefined, title: block.title||null, columns: cols, rows, notes, maxRows: Number(block.maxRows)||null };
    }
    case 'slide': {
      const page = Math.max(1, Number(block.page)||1);
      return { kind:'slide', id: block.id||undefined, reportId: String(block.reportId||''), page, caption: block.caption?String(block.caption).slice(0,160):null };
    }
    case 'group': {
      const cols = block.cols===3?3:2;
      const inner = Array.isArray(block.blocks)? block.blocks.slice(0, cols).map(validateBlock).filter(Boolean) : [];
      if (inner.length===0) return null; // disallow empty groups
      return { kind:'group', id: block.id||undefined, cols, blocks: inner };
    }
    case 'spacer': {
      const size = ['sm','md','lg'].includes(block.size) ? block.size : 'md';
      return { kind:'spacer', id: block.id||undefined, size };
    }
    default:
      return null;
  }
}

export function validateLayout(layout){
  const out = [];
  for (const b of (layout||[])){
    const v = validateBlock(b);
    if (v) out.push(v);
    if (out.length >= 18) break;
  }
  return out;
}

export default { validateBlock, validateLayout };

