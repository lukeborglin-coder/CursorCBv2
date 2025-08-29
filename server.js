// ---- Flexible loaders for pdfjs and canvas variants ----
async function __loadPdfjsFlexible() {
  const candidates = [
    'pdfjs-dist/legacy/build/pdf.mjs',
    'pdfjs-dist/legacy/build/pdf.js',
    'pdfjs-dist/build/pdf.mjs',
    'pdfjs-dist'
  ];
  for (const p of candidates) {
    try { const mod = await import(p); return { mod, variant: p }; } catch {}
  }
  return { mod: null, variant: null };
}
async function __loadCanvasFlexible() {
  try { const m = await import('@napi-rs/canvas'); const createCanvas = m.createCanvas || (m.default && m.default.createCanvas); if (createCanvas) return { mod: m, variant: '@napi-rs/canvas' }; } catch {}
  try { const m = await import('canvas'); const createCanvas = m.createCanvas || (m.default && m.default.createCanvas); if (createCanvas) return { mod: m, variant: 'canvas' }; } catch {}
  return { mod: null, variant: null };
}
// --------------------------------------------------------
/* === MR Broker Server â€“ FULL v12 (ESM/CJS safe, no early returns in stats) === */

// ===== Dashboard payload builder (intent-aware; async) =====
async function buildDashboardPayload({answer, themes, relevantChunks, mostRecentRef}){
  try{
    // Snapshot (prefer canonical chartData)
    let snapshot = null;
    const charts = (themes||[]).map(t=>t.chartData).filter(Boolean);
    let c = Array.isArray(charts) ? charts.find(x=>x && x._preferred) || charts.find(x=>x && x.type==='pie') : charts;
    if (Array.isArray(c)) c = c[0];
    if (c && c.series && c.series.length){
      snapshot = {
        type: "pie",
        asOf: (mostRecentRef && (mostRecentRef.yearTag||mostRecentRef.monthTag)) ? `${mostRecentRef.monthTag||''} ${mostRecentRef.yearTag||''}`.trim() : null,
        labels: c.series.map(s=> s.label),
        values: c.series.map(s=> Number(s.value)||0),
        colors: (Array.isArray(c.colors) && c.colors.length? c.colors : (Array.isArray(c.series) ? c.series.map(s=> (s && s.color) || null) : null))
      };
      // label -> color map (preserve report palette)
      if (c.series){
        const cmap = {};
        c.series.forEach((s,i)=>{
          if (s && s.label){
            const col = s.color || (snapshot.colors && snapshot.colors[i]) || null;
            if (col) cmap[s.label] = col;
          }
        });
        if (Object.keys(cmap).length) snapshot.colorMap = cmap;
      }
    }

    // Trend from dated snippets (if available, 2+ timepoints)
    let trend = null;
    if (typeof buildTrendFromChunks === 'function'){
      trend = buildTrendFromChunks(relevantChunks) || null;
    }

    // Drivers (frequency of bullets)
    let drivers = null;
    const counts = {};
    (themes||[]).forEach(t=> (t.bullets||[]).forEach(b=>{
      const k = String(b).split(':')[0].trim().toLowerCase();
      if (k) counts[k] = (counts[k]||0)+1;
    }));
    const top = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,5);
    if (top.length){ drivers = { type:"bars", items: top.map(([k,v])=>({label: k[0].toUpperCase()+k.slice(1), value:v})) }; }

    // Quotes (HCP/Patient/Caregiver only)
    const quotes = [];
    (themes||[]).forEach(t=> (t.quotes||[]).forEach(q=>{
      if (!q || !q.text || !q.speaker) return;
      const s = String(q.speaker).toLowerCase();
      if (s==='hcp' || s==='patient' || s==='caregiver') quotes.push({text:q.text, speaker:q.speaker});
    }));

    // Reports: enrich with Drive preview + thumbnail
    const reports = await (async () => {
      const arr = (relevantChunks || []).slice(0, 6);
      const out = [];
      for (const c of arr) {
        let thumb = null, preview = null;
        if (c.fileId) {
          try {
            thumb = await getPdfThumbnail(c.fileId, c.pageNumber || c.page || 1);
            preview = buildDrivePreviewUrl(c.fileId, c.pageNumber || c.page);
          } catch (e) {}
        }
        // Only include reports that have successfully generated thumbnails or valid file IDs
        if (c.fileName && c.fileId) {
          out.push({
            source: c.fileName,
            page: c.pageNumber || c.page,
            study: c.study,
            date: (c.monthTag ? (c.monthTag + ' ') : '') + (c.yearTag || ''),
            fileId: c.fileId || null,
            preview,
            thumbnail: thumb
          });
        }
      }
      return out;
    })();

    console.log('Debug - Server generating reports:', reports);
    console.log('Debug - First report:', reports[0]);
    return { headline: answer, snapshot, trend, drivers, quotes: quotes.slice(0, 4), reports };
  }catch(e){
    console.error('Error in buildAnalysisResponse:', e);
    console.error('Stack trace:', e.stack);
    return { headline: answer, reports: [] }; // Return empty reports array instead of undefined
  }
}

// ===== Drive thumbnails and preview links =====
import pdf2pic from 'pdf2pic';
import sharp from 'sharp';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

// --- helper to fetch Drive file bytes as Buffer ---
async function __downloadDriveFile(fileId) {
  const auth = getAuth && typeof getAuth === 'function' ? getAuth() : undefined;
  const drive = google.drive({ version: 'v3', auth });
  const resp = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
  return Buffer.from(resp.data);
}

import { fileURLToPath } from 'node:url';
import { createWriteStream } from 'fs';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// fsp already imported above

// Create a temporary directory for PDF processing
const TEMP_DIR = path.join(tmpdir(), 'jaice-pdf-temp');

async function ensureTempDir() {
  try {
    mkdirSync(TEMP_DIR, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }
}

// Global auth client for Google Drive
let authClient;

// Initialize Google Drive authentication
async function initializeGoogleAuth() {
  try {
    authClient = getAuth();
    const client = await authClient.getClient();
    console.log('âœ… Google Drive authentication initialized successfully');
    return client;
  } catch (error) {
    console.error('âŒ Failed to initialize Google Drive auth:', error);
    throw error;
  }
}

// FIXED: More robust PDF thumbnail generation with file-based approach

// Simplified: do not download/convert. Just return our secure-slide URL.
async function getPdfThumbnail(fileId, pageNumber = 1) {
  if (!fileId) return null;
  const page = Number(pageNumber) > 0 ? Number(pageNumber) : 1;
  return `/secure-slide/${fileId}/${page}`;
}

function buildDrivePreviewUrl(fileId, page){
  const p = page && Number(page)>0 ? `#page=${Number(page)}` : '';
  return `https://drive.google.com/file/d/${fileId}/preview${p}`;
}

// ===== Extract trend from snippets across timepoints =====
function extractSharesFromText(text){
  if (!text) return null;
  const out = {};
  const reLabelVal = /(Evrysdi|Spinraza|Zolgensma|Untreated)\s*(?:-|:)?\s*(\d{1,2})(?:\.\d+)?\s*%/gi;
  let m;
  while((m = reLabelVal.exec(text))){
    const L = m[1]; const v = Number(m[2]);
    out[L] = v;
  }
  const keys = Object.keys(out);
  return keys.length ? out : null;
}

function buildTrendFromChunks(chunks){
  // group by (year, month)
  const pts = {};
  (chunks||[]).forEach(c=>{
    const y = Number(c.yearTag)||0; const m = monthToNum(c.monthTag||'');
    if (!y) return;
    const key = `${y}-${String(m).padStart(2,'0')}`;
    const parsed = extractSharesFromText(c.textSnippet||'');
    if (parsed){
      pts[key] = Object.assign(pts[key]||{}, parsed);
    }
  });
  const keys = Object.keys(pts).sort();
  if (keys.length < 2) return null;
  const labels = ["Evrysdi","Spinraza","Zolgensma","Untreated"];
  const series = labels.map(L=> ({ label:L, values: keys.map(k=> pts[k][L] ?? null) }));
  return { type: 'lines', timepoints: keys, labels, series };
}

async function extractTagsFromTitlePage(fileId){
  try{
    const pdfjsLoad = (typeof __loadPdfjsFlexible === 'function') ? await __loadPdfjsFlexible() : { mod: null };
    const pdfjsMod = pdfjsLoad.mod;
    const pdfjsLib = (pdfjsMod && (pdfjsMod.getDocument || pdfjsMod.GlobalWorkerOptions)) ? pdfjsMod
                     : (pdfjsMod && pdfjsMod.default ? pdfjsMod.default : null);
    if (!pdfjsLib) return { year:'', month:'', report:'' };
    const pdfBuffer = await __downloadDriveFile(fileId);
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) }).promise;
    const page = await doc.getPage(1);
    const tc = await page.getTextContent();
    const text = (tc.items||[]).map(it=>it.str).join(' ').replace(/\s+/g,' ').trim();
    const monthWord = (text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/i)||[])[0] || '';
    const month = monthWord ? monthWord.slice(0,3) : '';
    const y = (text.match(/\b(20\d{2})\b/)||[])[1] || '';
    const lower = text.toLowerCase();
    let report = '';
    if (lower.includes('conjoint')) report = 'Conjoint';
    else if (lower.includes('atu')) report = 'ATU';
    else if (lower.includes('integrated') || lower.includes('pmr') || lower.includes('quant')) report = 'PMR';
    else if (lower.includes('competitive')) report = 'Competitive Readiness';
    else if (lower.includes('tracker')) report = 'Tracker';
    return { year:y||'', month:month||'', report };
  }catch(e){
    return { year:'', month:'', report:'' };
  }
}

async function ensureChunkTags(c){
  if (!c) return;
  const haveAll = c.yearTag && c.monthTag && c.reportTag;
  if (haveAll) return;
  let y = c.yearTag || '', m = c.monthTag || '', r = c.reportTag || '';
  if ((!y || !m || !r) && c.fileId){
    const t = await extractTagsFromTitlePage(c.fileId);
    y = y || t.year; m = m || t.month; r = r || t.report;
  }
  const fname = c.fileName || c.source || c.study || '';
  y = y || extractYearFromFileName(fname);
  m = m || extractMonthFromFileName(fname);
  r = r || extractReportTypeFromFileName(fname);
  c.yearTag = y; c.monthTag = m; c.reportTag = r;
}

// === Enhanced report metadata extraction from first ~20 slides ===
async function __extractTextPagesFromPdf(fileId, maxPages = 20) {
  try {
    const { mod } = await __loadPdfjsFlexible();
    const pdfjsLib = (mod && (mod.getDocument || mod.GlobalWorkerOptions)) ? mod : (mod && mod.default ? mod.default : null);
    if (!pdfjsLib || !pdfjsLib.getDocument) return [];
    const buffer = await __downloadDriveFile(fileId);
    const task = pdfjsLib.getDocument({ data: new Uint8Array(buffer), disableWorker: true, isEvalSupported: false });
    const doc = await task.promise;
    const pages = Math.min(maxPages, Math.max(1, doc.numPages));
    const texts = [];
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
      const text = (content.items || []).map(it => (it && it.str) ? it.str : '').join(' ').replace(/\s+/g, ' ').trim();
      texts.push(text);
    }
    return texts;
  } catch (_) {
    return [];
  }
}

function __parseDateFromText(firstPagesText) {
  const monthRegex = /(January|February|March|April|May|June|July|August|September|October|November|December)/i;
  const yearRegex = /\b(20\d{2})\b/;
  for (const t of firstPagesText) {
    const m = monthRegex.exec(t || '');
    const y = yearRegex.exec(t || '');
    if (y) {
      return {
        month: m ? (m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()) : null,
        year: y[1]
      };
    }
  }
  return { month: null, year: null };
}

function __mapMethodologyFromText(text) {
  const s = String(text || '').toLowerCase();
  // Prefer Qual if both mentioned
  if (/(qualitative|in-depth\s*interview|\bidi\b|focus\s*group|fgd|discussion\s*guide|ethnograph|moderated|unmoderated|competitive\s*readiness)/i.test(text)) return 'Qual';
  if (/(\batu\b|attitude\s*tracking|awareness\s*trial\s*usage|tracking\s*study)/i.test(text)) return 'ATU';
  if (/(conjoint|dce|maxdiff)/i.test(text)) return 'Conjoint';
  if (/(obb\b|obbs|omnibus)/i.test(text)) return 'OBBs';
  if (/(access\s*confidence|payer\s*access|market\s*access)/i.test(text)) return 'Access Confidence';
  if (/(message\s*testing|claim\s*testing|messaging\s*test)/i.test(text)) return 'Message Testing';
  if (/(concept\s*testing|concept\s*test|concept\s*evaluation)/i.test(text)) return 'Concept Testing';
  return 'Other';
}

function __mapMethodologiesFromText(text) {
  const s = String(text || '');
  const found = [];
  const pushIf = (label, re) => { if (re.test(s)) found.push(label); };
  // Detect all relevant methodologies
  pushIf('Qual', /(qualitative|in-depth\s*interview|\bidi\b|focus\s*group|fgd|discussion\s*guide|ethnograph|moderated|unmoderated|competitive\s*readiness)/i);
  pushIf('ATU', /(\batu\b|attitude\s*tracking|awareness\s*trial\s*usage|tracking\s*study)/i);
  pushIf('Conjoint', /(conjoint|dce|maxdiff)/i);
  pushIf('OBBs', /(\bobb\b|\bobbs\b|omnibus)/i);
  pushIf('Access Confidence', /(access\s*confidence|payer\s*access|market\s*access)/i);
  pushIf('Message Testing', /(message\s*testing|claim\s*testing|messaging\s*test)/i);
  pushIf('Concept Testing', /(concept\s*testing|concept\s*test|concept\s*evaluation)/i);
  // Priority order: Qual, Conjoint, ATU, Message Testing, Concept Testing, Access Confidence, OBBs
  const order = ['Qual','Conjoint','ATU','Message Testing','Concept Testing','Access Confidence','OBBs'];
  const unique = [];
  for (const label of order) {
    if (found.includes(label) && !unique.includes(label)) unique.push(label);
  }
  return unique.slice(0, 3);
}

function __inferQuantQualFromText(text){
  const s = String(text||'');
  const isQual = /(qualitative|in-depth\s*interview|\bidi\b|focus\s*group|fgd|discussion\s*guide|ethnograph|moderated|unmoderated|open\s*ended)/i.test(s);
  const isQuant = /(survey|n\s*=\s*\d|sample\s*size|questionnaire|quantitative|scale\s*\d|closed\s*ended)/i.test(s);
  if (isQual && isQuant) return ['Quant','Qual'];
  if (isQual) return ['Qual'];
  if (isQuant) return ['Quant'];
  return [];
}

function __extractSampleFromText(pagesText) {
  // Scan first 15 slides and keep the MAX sample size seen per primary group
  const maxPages = Math.min(15, Array.isArray(pagesText) ? pagesText.length : 0);
  const canonGroups = [
    { re: /(hcp|physician[s]?|doctor[s]?|provider[s]?|specialist[s]?)/i, label: 'HCPs' },
    { re: /(patient[s]?)/i, label: 'Patients' },
    { re: /(caregiver[s]?|carer[s]?)/i, label: 'Caregivers' }
  ];
  const best = new Map(); // label -> max n
  // Prioritize likely pages: Objectives/Methodology/Sample near the front
  const pageOrder = Array.from({length: maxPages}, (_,i)=>i).sort((a,b)=>{
    const pa = String(pagesText[a]||'');
    const pb = String(pagesText[b]||'');
    const ra = /(sample|respondent|participants?|methodology|objectives?)/i.test(pa) ? 0 : 1;
    const rb = /(sample|respondent|participants?|methodology|objectives?)/i.test(pb) ? 0 : 1;
    return ra - rb || a - b;
  });
  for (const i of pageOrder) {
    const page = String(pagesText[i] || '');
    const text = page;
    const re = /n\s*=\s*(\d{1,4})\s*(?:[-–:]\s*)?([A-Za-z][A-Za-z\s]+?)(?=\bwith\b|\(|\)|\,|\;|\.|\n|$)/ig;
    let m;
    while ((m = re.exec(text))) {
      const nVal = parseInt(m[1], 10);
      const raw = (m[2] || '').trim();
      if (!Number.isFinite(nVal)) continue;
      let label = null;
      for (const g of canonGroups) { if (g.re.test(raw)) { label = g.label; break; } }
      if (!label) continue;
      const cur = best.get(label) || 0;
      if (nVal > cur) best.set(label, nVal);
    }
  }
  if (best.size === 0) return 'Not specified';
  // Adjust overlapping subsets: if Caregivers appear as subset of Patients, subtract caregivers from patients
  if (best.has('Patients') && best.has('Caregivers')) {
    const adj = Math.max(0, (best.get('Patients')||0) - (best.get('Caregivers')||0));
    best.set('Patients', adj);
  }
  const order = ['HCPs', 'Patients', 'Caregivers'];
  const parts = [];
  for (const lab of order) {
    if (best.has(lab)) parts.push(`n=${best.get(lab)} ${lab}`);
    if (parts.length >= 3) break;
  }
  return parts.length ? parts.join('; ') : 'Not specified';
}

function __extractFieldworkFromText(pagesText) {
  const text = pagesText.join(' \n ');
  const rawDates = Array.from(text.matchAll(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/g)).map(m => ({ m: parseInt(m[1],10), d: parseInt(m[2],10), y: parseInt(m[3],10) }));
  if (!rawDates.length) return 'Not specified';
  const norm = (o) => { const y=o.y<100?o.y+2000:o.y; const mm=String(Math.max(1,Math.min(12,o.m))).padStart(2,'0'); const dd=String(Math.max(1,Math.min(31,o.d))).padStart(2,'0'); return { t: Date.parse(`${y}-${mm}-${dd}T00:00:00Z`), s: `${mm}/${dd}/${y}` }; };
  const normalized = rawDates.map(norm).filter(x=>Number.isFinite(x.t));
  if (!normalized.length) return 'Not specified';
  let min=normalized[0], max=normalized[0];
  for (const d of normalized){ if (d.t<min.t) min=d; if (d.t>max.t) max=d; }
  if (min.s===max.s) return 'Not specified';
  return `${min.s} - ${max.s}`;
}

function __extractBackgroundFromText(pagesText) {
  const joined = pagesText.join(' \n ');
  const sec = /(project\s*objective[s]?|objective[s]?|research\s*objective[s]?|goal[s]?|goals\s*&\s*objectives|objectives\s*&\s*methodology)[:\s\-]+([\s\S]{0,1200})/i.exec(joined);
  if (!sec) return '';
  const area = sec[2] || '';
  let frags = area
    .split(/\n|\u2022|•|\-|;|\./)
    .map(s => String(s).replace(/\s+/g,' ').trim())
    .filter(Boolean);
  const looksHeading = (s) => {
    const words = s.split(' ');
    if (words.length <= 2) return true;
    const letters = s.replace(/[^A-Za-z]/g,'');
    const upper = letters.replace(/[^A-Z]/g,'').length;
    const frac = letters.length ? upper/letters.length : 0;
    return frac > 0.75;
  };
  const hasVerb = (s) => /(assess|evaluate|measure|understand|track|monitor|optimi[sz]e|identify|explore|determine|compare|quantif|qualit|gauge|inform|validate|test|perception|drivers?|barriers?|satisfaction|awareness|usage|preference|impact)/i.test(s);
  frags = frags
    .map(s => s.replace(/^\s*\d+\s*([).:\-]|of)\s*/i,'').replace(/^(objective|goal)s?\s*[:\-]?\s*/i,''))
    .filter(s => s && !looksHeading(s) && hasVerb(s));
  const uniq = [];
  const seen = new Set();
  for (const s of frags) {
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(s);
    if (uniq.length >= 4) break;
  }
  if (!uniq.length) return '';
  const toSentence = (s) => {
    let y = s.trim();
    if (!/[.!?]$/.test(y)) y += '.';
    y = y.charAt(0).toUpperCase() + y.slice(1);
    return y;
  };
  const first = `This study aimed to ${uniq[0].replace(/[.;]+$/,'')}.`;
  const second = uniq[1] ? `Additionally, it ${uniq[1].replace(/[.;]+$/,'')}.` : '';
  return [toSentence(first), second ? toSentence(second) : null].filter(Boolean).join(' ');
}

function __extractKeyInsightsFromText(pagesText) {
  const limited = pagesText.slice(0, 20);
  const text = limited.join(' \n ');
  const block = /(executive\s*summary|key\s*insights?|key\s*findings|highlights?)[:\s\-]+([\s\S]{0,1800})/i.exec(text);
  const area = (block ? block[2] : text);
  const raw = [];
  const bulletRe = /(•|\-\s|\u2022)\s*([^\n]+)\n?/g;
  let m;
  while ((m = bulletRe.exec(area))) {
    const line = String(m[2] || '').trim();
    if (line) raw.push(line);
    if (raw.length >= 12) break;
  }
  if (!raw.length) {
    raw.push(...area.split(/(?<=[.!?])\s+/).map(s=>s.trim()).filter(Boolean).slice(0,8));
  }
  // Clean and normalize lines
  const clean = (s) => {
    let y = String(s||'')
      .replace(/^((?:[A-Z0-9]{2,}[\s\/|-]+){2,})+/, '') // remove leading all-caps headings
      .replace(/^([A-Za-z ]+):\s*/, '') // remove label prefixes like "Demand Research:"
      .replace(/[•\u2022]+/g,' ')
      .replace(/\s+\[\d+(?:,\d+)*\]/g,'')
      .replace(/\s+/g,' ')
      .trim();
    if (!y) return '';
    // Sentence case if mostly uppercase
    const upperFrac = (y.replace(/[^A-Z]/g,'').length) / Math.max(1, y.replace(/[^A-Za-z]/g,'').length);
    if (upperFrac > 0.6) y = y.charAt(0) + y.slice(1).toLowerCase();
    if (!/[.!?]$/.test(y)) y += '.';
    return y.charAt(0).toUpperCase() + y.slice(1);
  };
  const uniq = [];
  const seen = new Set();
  for (const x of raw) {
    const y = clean(x);
    if (!y) continue;
    const k = y.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(y);
    if (uniq.length >= 5) break;
  }
  // Compose 2–3 coherent bullets (elevator-style sentences)
  const out = [];
  if (uniq[0]) out.push(uniq[0]);
  if (uniq[1]) out.push(uniq[1]);
  if (uniq[2] && out.length < 3) out.push(uniq[2]);
  // Ensure at least 2 bullets by splitting a long sentence if needed
  if (out.length === 1) {
    const parts = out[0].split(/;|, and |, but |\.\s+/).map(s=>s.trim()).filter(Boolean);
    if (parts.length > 1) {
      out.length = 0;
      out.push(parts[0] + '.');
      out.push(parts[1] + '.');
    } else {
      out.push('Additionally, the study identified supporting themes relevant to this objective.');
    }
  }
  return out.slice(0, 3);
}

async function extractReportDetailsFromDrive(fileId) {
  const pages = await __extractTextPagesFromPdf(fileId, 20);
  if (!pages.length) return null;
  const { month, year } = __parseDateFromText(pages);
  const combined = pages.join(' \n ');
  let methodologies = __mapMethodologiesFromText(combined);
  if (!methodologies.length) methodologies = __inferQuantQualFromText(combined);
  if (!methodologies.length) methodologies = ['Unknown'];
  const sample = __extractSampleFromText(pages);
  const fieldwork = __extractFieldworkFromText(pages);
  const background = __extractBackgroundFromText(pages);
  const insights = __extractKeyInsightsFromText(pages);
  return { month, year, methodology: (methodologies[0] || __mapMethodologyFromText(combined)), methodologies, sample, fieldwork, background, insights };
}

// ===== Helpers =====
// recency + market share canonicalization (global scope) =====
const SMA_LABELS = ["Evrysdi","Spinraza","Zolgensma","Untreated"];
const COLOR_BY_LABEL = { Evrysdi:"#2563eb", Spinraza:"#16a34a", Zolgensma:"#f59e0b", Untreated:"#6b7280" };

function normalizeLabel(lbl){
  if(!lbl) return null;
  const x = String(lbl).trim().toLowerCase();
  if (x.startsWith("evry")) return "Evrysdi";
  if (x.startsWith("spin")) return "Spinraza";
  if (x.startsWith("zol")) return "Zolgensma";
  if (x.includes("untreat") || x.includes("no treat") || x.includes("none")) return "Untreated";
  return String(lbl).trim();
}

function monthToNum(m){
  if (!m) return 0;
  const map={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
  const n = Number(String(m).replace(/[^0-9]/g,''));
  if (n>=1 && n<=12) return n;
  const k = String(m).slice(0,3).toLowerCase();
  return map[k]||0;
}

function preferMostRecent(chunks){
  const arr = (chunks||[]).map(c=>({...c,_y:Number(c.yearTag)||0,_m:monthToNum(c.monthTag)}));
  arr.sort((a,b)=> (b._y - a._y) || (b._m - a._m) || ((b.score||0)-(a.score||0)));
  return { mostRecent: arr[0] || null, ordered: arr };
}

function canonicalizeMarketShareChart(chart){
  if (!chart || !Array.isArray(chart.series)) return chart;
  const map = new Map();
  chart.series.forEach(s=>{
    if(!s) return;
    const L = normalizeLabel(s.label);
    if (!L) return;
    const val = Number(s.value)||0;
    map.set(L, (map.get(L)||0) + val);
  });
  // If totals look like a pie, force pie
  const sum = Array.from(map.values()).reduce((a,b)=>a+b,0);
  if (sum>=90 && sum<=110) chart.type = "pie";
  const series = SMA_LABELS.map(L=> ({ label:L, value: map.get(L)||0, color: COLOR_BY_LABEL[L] }));
  chart.series = series.filter(s=> s.value>0);
  chart.colors = chart.series.map(s=> s.color);
  chart.legend = chart.series.map(s=> s.label);
  chart._preferred = true;
  return chart;
}

// server.js - Jaice server with fixes for visual issues and chart display

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import session from "express-session";
import bcrypt from "bcryptjs";
import OpenAI from "openai";
import { google } from "googleapis";
import crypto from "node:crypto";

import { classify } from './server/addons/classifier.js';
import { planLayout } from './server/addons/planner.js';
import { vectorSearch } from './server/addons/retrieval.js';
import { bind } from './server/addons/binder.js';
import { validateLayout } from './server/addons/validators.js';

dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true });

// Environment detection
const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER || process.env.RAILWAY || process.env.VERCEL;
const isLocal = !isProduction;

console.log(`🌍 Environment: ${isProduction ? 'PRODUCTION' : 'LOCAL'}`);

// Auto-discover Google credentials with environment-specific handling
function discoverGoogleCredentials() {
  // For production (Render/Railway/etc), prefer environment variables
  if (isProduction) {
    // Try JSON credentials first (Render preferred method)
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
      try {
        // Validate JSON
        JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
        console.log(`✅ Using production Google credentials (JSON)`);
        return null; // Signal to use credentialsJson instead of keyFile
      } catch (e) {
        console.log(`❌ Invalid Google credentials JSON in environment`);
      }
    }
    
    // Try file path
    const envPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (envPath && fs.existsSync(envPath)) {
      console.log(`✅ Using production Google credentials at: ${envPath}`);
      return envPath;
    }
    
    console.log(`⚠️ No production Google credentials found. Set GOOGLE_CREDENTIALS_JSON environment variable.`);
    return "";
  }
  
  // For local development, check local files first
  const possiblePaths = [
    'credentials/google-credentials.json',
    'credentials/service-account.json',
    'google-credentials.json',
    'service-account.json'
  ];
  
  for (const filePath of possiblePaths) {
    try {
      if (fs.existsSync(filePath)) {
        console.log(`✅ Found local Google credentials at: ${filePath}`);
        return filePath;
      }
    } catch (e) {
      // Continue searching
    }
  }
  
  // Fallback to system env var for local
  const envPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (envPath && fs.existsSync(envPath)) {
    console.log(`✅ Using system Google credentials at: ${envPath}`);
    return envPath;
  }
  
  if (isLocal) {
    console.log(`⚠️ No Google credentials found locally. Place credentials in ./credentials/ folder for auto-discovery.`);
    console.log(`   For production, set GOOGLE_CREDENTIALS_JSON environment variable.`);
  }
  
  return "";
}

// Runtime flags
let FORCE_REEMBED_ON_MANUAL = false;

const config = {
  server: {
    port: Number(process.env.PORT) || 3000,
    sessionSecret: process.env.SESSION_SECRET || "change-me-in-production",
    authToken: process.env.AUTH_TOKEN || "coggpt25",
    secureCookies: process.env.SECURE_COOKIES === "true",
  },
  environment: {
    isProduction,
    isLocal,
    platform: process.env.RENDER ? 'render' : process.env.RAILWAY ? 'railway' : process.env.VERCEL ? 'vercel' : 'local',
  },
  ai: {
    openaiKey: process.env.OPENAI_API_KEY,
    embeddingModel: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
    answerModel: process.env.ANSWER_MODEL || "gpt-4o-mini",
    defaultTopK: Number(process.env.DEFAULT_TOPK) || 50,
  },
  pinecone: {
    apiKey: process.env.PINECONE_API_KEY,
    indexHost: process.env.PINECONE_INDEX_HOST,
  },
  drive: {
    rootFolderId: process.env.DRIVE_ROOT_FOLDER_ID || "",
    keyFile: (() => {
      const discovered = discoverGoogleCredentials();
      return discovered === null ? "" : discovered; // null means use credentialsJson instead
    })(),
    credentialsJson: (() => {
      const discovered = discoverGoogleCredentials();
      return discovered === null ? process.env.GOOGLE_CREDENTIALS_JSON || "" : "";
    })(),
  },
  data: {
    cacheDir: process.env.DATA_CACHE_DIR || path.resolve(process.cwd(), "data-cache"),
  },
  search: {
    skipManifestFilter: process.env.SKIP_MANIFEST_FILTER === "true",
    maxThemes: Number(process.env.MAX_THEMES) || 50,
    scoreThreshold: Number(process.env.SEARCH_SCORE_THRESHOLD || 0.5),
  },
  autoIngest: {
    onStart: String(process.env.AUTO_INGEST_ON_START || "false").toLowerCase() === "true",
    startDelayMs: Number(process.env.AUTO_INGEST_DELAY_MS || 2000),
    syncIntervalMs: Number(process.env.AUTO_SYNC_INTERVAL_MS || 3600000),
  },
};

// Thumbnail cache to improve performance
const THUMBNAIL_CACHE = new Map();
const THUMBNAIL_CACHE_DIR = path.join(process.cwd(), 'data-cache', 'thumbnails');
let cacheInitialized = false;

// Client libraries cache to reduce redundant calls
const CLIENT_LIBRARIES_CACHE = {
  data: null,
  lastUpdated: 0,
  ttl: 30000 // 30 seconds
};

async function initThumbnailCache() {
  if (cacheInitialized) return;
  try {
    await fsp.mkdir(THUMBNAIL_CACHE_DIR, { recursive: true });
    cacheInitialized = true;
  } catch (error) {
    console.warn('Failed to initialize thumbnail cache directory:', error.message);
  }
}

function getThumbnailCacheKey(fileId, pageNumber) {
  return `${fileId}_page_${pageNumber}`;
}

const logger = {
  info: (...a)=>console.log("INFO", new Date().toISOString(), ...a),
  warn: (...a)=>console.warn("WARN", new Date().toISOString(), ...a),
  error: (...a)=>console.error("ERROR", new Date().toISOString(), ...a),
};

// FIXED: Regex-free HTML injector with proper chart rendering script
async function serveHtmlWithUi(res, filePath) {
  try {
    let html = await fsp.readFile(filePath, "utf8");
    
    // FIXED: Updated chart rendering function with proper data labels and no duplication
    const chartScript = `
    <script>
    // Global chart instances tracker
    window.chartInstances = window.chartInstances || new Map();
    
    function renderChart(containerId, chartData) {
      const container = document.getElementById(containerId);
      if (!container) {
        console.warn('Chart container not found:', containerId);
        return;
      }
      
      // CRITICAL: Destroy existing chart instance if it exists
      if (window.chartInstances.has(containerId)) {
        const existingChart = window.chartInstances.get(containerId);
        try {
          existingChart.destroy();
          console.log('Destroyed existing chart:', containerId);
        } catch (e) {
          console.warn('Error destroying chart:', e);
        }
        window.chartInstances.delete(containerId);
      }
      
      // CRITICAL: Clear existing content to prevent duplication
      container.innerHTML = '';
      
      console.log('Rendering chart:', containerId, chartData);
      
      if (window.Chart && chartData && chartData.series && chartData.series.length > 0) {
        const canvas = document.createElement('canvas');
        canvas.style.maxHeight = '250px';
        canvas.style.width = '100%';
        canvas.id = containerId + '_canvas';
        container.appendChild(canvas);
        
        const labels = chartData.series.map(s => s.label);
        const data = chartData.series.map(s => s.value);
        
        // Determine chart type intelligently
        let chartType = 'bar'; // Default to bar charts
        
        // Only use pie charts for market share data that adds up to ~100%
        const total = data.reduce((sum, val) => sum + val, 0);
        if (chartData.type === 'pie' && total >= 90 && total <= 110) {
          chartType = 'pie';
        } else if (chartData.type === 'line') {
          chartType = 'line';
        }
        
        // Enhanced color selection with brand colors
        let backgroundColor, borderColor;
        if (chartType === 'pie') {
          backgroundColor = labels.map(label => {
            const lowerLabel = label.toLowerCase();
            // Match pharmaceutical product colors
            if (lowerLabel.includes('evrysdi') || lowerLabel.includes('risdiplam')) return '#D14829';
            if (lowerLabel.includes('spinraza') || lowerLabel.includes('nusinersen')) return '#2563eb';
            if (lowerLabel.includes('zolgensma') || lowerLabel.includes('onasemnogene')) return '#16a34a';
            if (lowerLabel.includes('untreated') || lowerLabel.includes('no treatment')) return '#94a3b8';
            if (lowerLabel.includes('other') || lowerLabel.includes('others')) return '#6366f1';
            
            // Fallback to orange palette
            const index = labels.indexOf(label);
            const palette = ['#2563eb','#16a34a','#f59e0b','#6b7280','#7c3aed','#dc2626','#059669','#64748b']; // Neutral, not brand-specific
            return palette[index % palette.length];
          });
          borderColor = '#fff';
        } else {
          backgroundColor = labels.map((_, i) => \`rgba(255, 122, 0, \${0.8 - i * 0.1})\`);
          borderColor = labels.map((_, i) => 'rgba(255, 122, 0, 1)');
        }
        
        const chartConfig = {
          type: chartType,
          data: {
            labels: labels,
            datasets: [{
              label: chartData.title || 'Values',
              data: data,
              backgroundColor: backgroundColor,
              borderColor: borderColor,
              borderWidth: chartType === 'pie' ? 2 : 1,
              fill: chartType === 'line' ? false : true
            }]
          },
          plugins: [ChartDataLabels], // CRITICAL: Register the plugin
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                display: chartType === 'pie', // Only show legend for pie charts
                position: chartType === 'pie' ? 'right' : 'top',
                labels: {
                  font: { size: 12 },
                  padding: 15,
                  usePointStyle: true
                }
              },
              tooltip: {
                callbacks: {
                  label: function(context) {
                    const value = context.parsed || context.parsed === 0 ? context.parsed : context.raw;
                    return context.label + ': ' + value + '%';
                  }
                }
              },
              // FIXED: Proper data labels configuration
              datalabels: {
                display: true,
                color: chartType === 'pie' ? '#fff' : '#333',
                font: {
                  weight: 'bold',
                  size: 14
                },
                formatter: function(value, context) {
                  return value + '%';
                },
                anchor: chartType === 'pie' ? 'center' : 'end',
                align: chartType === 'pie' ? 'center' : 'top',
                offset: chartType === 'pie' ? 0 : -8,
                clip: false // Ensure labels always show
              }
            },
            scales: chartType === 'pie' ? {} : {
              y: {
                display: false, // Clean look
                grid: { display: false },
                border: { display: false }
              },
              x: {
                grid: { display: false },
                border: { display: false },
                ticks: {
                  maxRotation: 45,
                  font: { size: 11 }
                }
              }
            },
            // FIXED: Enhanced animations and interactions
            onHover: function(event, activeElements) {
              event.native.target.style.cursor = activeElements.length > 0 ? 'pointer' : 'default';
            },
            animation: {
              onComplete: function() {
                // Additional data label rendering for non-pie charts
                if (chartType !== 'pie') {
                  const ctx = this.chart.ctx;
                  ctx.font = 'bold 12px Arial';
                  ctx.fillStyle = '#333';
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'bottom';
                  
                  this.data.datasets.forEach((dataset, i) => {
                    const meta = this.chart.getDatasetMeta(i);
                    meta.data.forEach((bar, index) => {
                      const value = dataset.data[index];
                      if (value && value > 0) {
                        ctx.fillText(value + '%', bar.x, bar.y - 5);
                      }
                    });
                  });
                }
              }
            }
          }
        };
        
        // CRITICAL: Register the plugin and create chart
        if (window.ChartDataLabels) {
          Chart.register(ChartDataLabels);
        }
        
        try {
          const chartInstance = new Chart(canvas.getContext('2d'), chartConfig);
          window.chartInstances.set(containerId, chartInstance);
        } catch (error) {
          console.error('Chart creation failed:', error);
          container.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">Chart rendering failed</p>';
        }
      } else if (chartData && chartData.series) {
        // Fallback to styled list format with percentages
        const ul = document.createElement('ul');
        ul.style.margin = '16px 0';
        ul.style.paddingLeft = '0';
        ul.style.listStyle = 'none';
        
        chartData.series.forEach((item, index) => {
          const li = document.createElement('li');
          li.style.margin = '8px 0';
          li.style.padding = '12px 16px';
          li.style.background = 'rgba(37, 99, 235, ' + (0.10 + (index * 0.05)) + ')';
          li.style.borderRadius = '8px';
          li.style.borderLeft = '4px solid #2563eb';
          li.style.display = 'flex';
          li.style.justifyContent = 'space-between';
          li.style.alignItems = 'center';
          
          li.innerHTML = '<span style="font-weight: 600;">' + item.label + '</span>' +
            '<span style="background: #2563eb; color: white; padding: 6px 12px; border-radius: 16px; font-size: 14px; font-weight: bold;">' +
            item.value + '%</span>';
          ul.appendChild(li);
        });
        
        container.appendChild(ul);
      } else {
        console.warn('No chart data available for', containerId);
        container.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">No chart data available</p>';
      }
    }
    </script>`;
    
    const scriptTag = '\n  <script src="/ui/user-menu.js" defer></script>\n' + chartScript + '\n';
    if (!html.includes('/ui/user-menu.js')) {
      const lower = html.toLowerCase();
      const marker = "</body>";
      const idx = lower.lastIndexOf(marker);
      if (idx !== -1) {
        html = html.slice(0, idx) + scriptTag + html.slice(idx);
      } else {
        html += scriptTag;
      }
    }
    res.set("Cache-Control", "no-store");
    res.type("html").send(html);
  } catch (e) {
    logger.error("Failed to serve HTML:", e.message);
    res.set("Cache-Control","no-store");
    res.sendFile(filePath);
  }
}

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json({ limit: "20mb" }));

// PDF Preview endpoint - serve PDF pages on-demand with improved stream handling

// Re-add lightweight placeholder for /secure-slide to avoid broken thumbnails.
// Generates a simple PNG with the slide number; avoids heavy PDF rendering.
app.get('/secure-slide/:fileId/:page', async (req, res) => {
  try {
    const { fileId, page } = req.params;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);

    // Lazy import canvas implementation
    const canvasLoad = (typeof __loadCanvasFlexible === 'function') ? await __loadCanvasFlexible() : { mod: null, variant: null };
    const createCanvas = canvasLoad.mod && (canvasLoad.mod.createCanvas || (canvasLoad.mod.default && canvasLoad.mod.default.createCanvas));
    if (!createCanvas) {
      // If canvas is unavailable, fall back to Drive preview redirect so clients at least see something.
      const previewUrl = buildDrivePreviewUrl(fileId, pageNum);
      return res.redirect(302, previewUrl);
    }

    const width = 640, height = 360;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#f3f4f6'; // gray-100
    ctx.fillRect(0, 0, width, height);

    // Border
    ctx.strokeStyle = '#9ca3af'; // gray-400
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, width - 4, height - 4);

    // Text
    ctx.fillStyle = '#1f2937'; // gray-800
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`Preview slide ${pageNum}`, width / 2, height / 2 - 10);
    ctx.font = '16px Arial';
    ctx.fillText('Drive previews are used in production; this is a lightweight placeholder.', width / 2, height / 2 + 22);

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    canvas.createPNGStream().pipe(res);
  } catch (e) {
    // On any error, degrade to a 1x1 transparent PNG
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/afnqCIAAAAASUVORK5CYII=',
      'base64'
    );
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).end(png);
  }
});
// removed /pdf-preview route
// /* removed /secure-slide/ route */

app.use(session({
  secret: config.server.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: config.server.secureCookies, maxAge: 1000*60*60*8 }
}));

const CONFIG_DIR = path.resolve(process.cwd(), "config");
const USERS_PATH = path.join(CONFIG_DIR, "users.json");
const MANIFEST_DIR = path.join(CONFIG_DIR, "manifests");
const CLIENTS_PATH = path.join(CONFIG_DIR, "clients.json");

// Wrapped for maximum compatibility (no top-level await)
;(async () => {
  try {
    await fsp.mkdir(CONFIG_DIR, { recursive: true });
    await fsp.mkdir(MANIFEST_DIR, { recursive: true });
    await fsp.mkdir(config.data.cacheDir, { recursive: true });
  } catch (e) {
    logger.error("mkdir bootstrap failed:", e?.message || e);
  }
})();

function readJSON(p,fallback){ 
  try{ 
    if(!fs.existsSync(p)) return fallback; 
    return JSON.parse(fs.readFileSync(p,"utf8")||"null") ?? fallback;
  }catch(e){ 
    logger.warn("readJSON failed", p, e.message); 
    return fallback; 
  } 
}

function writeJSON(p,obj){ 
  try{ 
    fs.writeFileSync(p, JSON.stringify(obj,null,2)); 
  }catch(e){ 
    logger.error("writeJSON failed", p, e.message);
  } 
}

// seed internal admin (non-destructive) - DISABLED
// (function seedUsers(){
//   const u = readJSON(USERS_PATH, { users: []});
//   const username = "cognitive_internal";
//   // Only seed if missing; never overwrite an existing account
//   const existingIndex = u.users.findIndex(x => (x.username||'').toLowerCase() === username);
//   if (existingIndex === -1) {
//     const passwordHash = bcrypt.hashSync(config.server.authToken || "coggpt25", 10);
//     const admin = { username, passwordHash, role:"internal", allowedClients:"*" };
//     u.users.push(admin);
//     writeJSON(USERS_PATH, u);
//     logger.info("Seeded default internal admin user");
//   } else {
//     logger.info("Admin user already exists; not overwriting");
//   }
// })();

function getAuth(){
  if (config.drive.credentialsJson){
    return new google.auth.GoogleAuth({ 
      credentials: JSON.parse(config.drive.credentialsJson), 
      scopes:[
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/presentations.readonly",
        "https://www.googleapis.com/auth/spreadsheets.readonly",
      ]
    });
  }
  if (config.drive.keyFile){
    return new google.auth.GoogleAuth({ 
      keyFile: config.drive.keyFile, 
      scopes:[
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/presentations.readonly",
        "https://www.googleapis.com/auth/spreadsheets.readonly",
      ]
    });
  }
  throw new Error("Google credentials missing");
}

const openai = new OpenAI({ apiKey: config.ai.openaiKey });

async function embedTexts(texts){
  const r = await openai.embeddings.create({ model: config.ai.embeddingModel, input: texts });
  return r.data.map(d=>d.embedding);
}

async function pineconeQuery(vector, namespace, topK){
  const r = await fetch(`${config.pinecone.indexHost}/query`, {
    method:"POST",
    headers:{ "Content-Type":"application/json", "Api-Key": config.pinecone.apiKey },
    body: JSON.stringify({ vector, topK, includeMetadata:true, namespace })
  });
  if(!r.ok){ throw new Error(`Pinecone query failed: ${await r.text()}`); }
  return r.json();
}

// === Quote extraction helper ===
async function extractSupportingQuotes(chunks, userQuery, quotesLevel) {
  const quotes = [];
  
  // Determine how many quotes to return based on level
  const maxQuotes = quotesLevel === 'many' ? 8 : quotesLevel === 'moderate' ? 4 : 2;
  
  for (const chunk of chunks) {
    if (quotes.length >= maxQuotes) break;
    
    const text = chunk.textSnippet || '';
    
    // Find quotes in the format: "quote text" - Attribution
    const quoteRegex = /"([^"]+)"\s*-\s*([^"\n]+)/g;
    let match;
    
    while ((match = quoteRegex.exec(text)) !== null && quotes.length < maxQuotes) {
      const quoteText = match[1].trim();
      const attribution = match[2].trim();
      
      // Categorize the attribution
      let category = 'HCP'; // Default
      const lowerAttribution = attribution.toLowerCase();
      
      if (lowerAttribution.includes('patient') || lowerAttribution.includes('pt')) {
        category = 'Patient';
      } else if (lowerAttribution.includes('caregiver') || lowerAttribution.includes('cg') || 
                 lowerAttribution.includes('parent') || lowerAttribution.includes('mother') || 
                 lowerAttribution.includes('father')) {
        category = 'Caregiver';
      } else if (lowerAttribution.includes('hcp') || lowerAttribution.includes('doctor') || 
                 lowerAttribution.includes('physician') || lowerAttribution.includes('clinician') ||
                 lowerAttribution.includes('neurologist') || lowerAttribution.includes('specialist')) {
        category = 'HCP';
      }
      
      // Only include quotes that are relevant and substantial
      if (quoteText.length > 20) {
        quotes.push({
          text: quoteText,
          attribution: `- ${category}`,
          source: chunk.fileName || 'Unknown Source',
          relevance: calculateQuoteRelevance(quoteText, userQuery)
        });
      }
    }
  }
  
  // Sort by relevance and return top quotes
  return quotes
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, maxQuotes)
    .map(q => ({
      text: q.text,
      attribution: q.attribution,
      source: q.source
    }));
}

function calculateQuoteRelevance(quoteText, userQuery) {
  const queryWords = userQuery.toLowerCase().split(/\s+/);
  const quoteWords = quoteText.toLowerCase().split(/\s+/);
  
  let matches = 0;
  for (const word of queryWords) {
    if (word.length > 3 && quoteWords.some(qw => qw.includes(word))) {
      matches++;
    }
  }
  
  return matches / queryWords.length;
}

// === FIXED Supporting Findings helpers ===
async function proposeThemeAssignments(openai, model, userQuery, chunks) {
  const refs = (chunks || []).map((c, i) => ({
    id: c.id || `ref${i + 1}`,
    text: c.textSnippet,
    file: c.fileName
  }));

  // Ensure we have enough references to create themes
  if (refs.length < 2) {
    logger.warn(`Only ${refs.length} references available - creating single theme`);
    return [{
      title: "Research Findings",
      refIds: refs.map(r => r.id)
    }];
  }

  const prompt = `Create up to 10 DISTINCT themes for: "${userQuery}"

Available references (assign each to EXACTLY ONE theme):
${refs.map(r => `${r.id}: ${r.text.substring(0, 200)}.`).join("\n\n")}

RULES:
- Create up to 10 themes that don't overlap
- Each reference assigned to ONLY ONE theme
- Distribute references evenly across themes
- Theme titles should be specific to the query context

Return JSON:
{"themes":[
  {"title":"Theme 1 Name", "refIds":["ref1","ref2"]},
  {"title":"Theme 2 Name", "refIds":["ref3"]},
  {"title":"Theme 3 Name", "refIds":["ref4","ref5"]}
]}`;

  const cmp = await openai.chat.completions.create({
    model,
    temperature: 0.7,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
    max_tokens: 800
  });

  try {
    const data = JSON.parse(cmp.choices[0]?.message?.content || "{}");
    let themes = Array.isArray(data.themes) ? data.themes : [];
    
    // Ensure no reference appears in multiple themes
    const usedRefIds = new Set();
    const uniqueThemes = [];
    
    for (const theme of themes) {
      if (!theme.refIds || !Array.isArray(theme.refIds)) continue;
      
      const availableRefIds = theme.refIds.filter(id => !usedRefIds.has(id));
      
      if (availableRefIds.length >= 1) {
        availableRefIds.forEach(id => usedRefIds.add(id));
        uniqueThemes.push({
          title: theme.title,
          refIds: availableRefIds
        });
      }
    }
    
    // Assign any unused references to a fallback theme
    const unusedRefs = refs.filter(r => !usedRefIds.has(r.id));
    if (unusedRefs.length > 0) {
      uniqueThemes.push({
        title: "Additional Insights",
        refIds: unusedRefs.map(r => r.id)
      });
    }
    
    // Final dedup by title + reference Jaccard overlap
    const normalized = new Set();
    const finalThemes = [];
    for (const t of uniqueThemes) {
      const key = String(t.title||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,' ');
      if (normalized.has(key)) continue;
      let tooSimilar = false;
      for (const u of finalThemes) {
        const A = new Set((t.refIds||[]).map(String));
        const B = new Set((u.refIds||[]).map(String));
        const inter = [...A].filter(x=>B.has(x)).length;
        const jaccard = inter / (A.size + B.size - inter || 1);
        if (jaccard >= 0.6) { tooSimilar = true; break; }
      }
      if (!tooSimilar) { normalized.add(key); finalThemes.push(t); }
    }
    
    logger.info(`Generated ${finalThemes.length} unique themes with no overlap`);
    return finalThemes.slice(0, config.search.maxThemes || 50);
  } catch (e) {
    logger.error("Theme assignment failed:", e.message);
    return [{
      title: "Research Findings", 
      refIds: refs.map(r => r.id)
    }];
  }
}

async function buildSupportingThemes(openai, model, userQuery, chunks, opts) {
  if (!chunks || chunks.length === 0) {
    return [];
  }

  const proposals = await proposeThemeAssignments(openai, model, userQuery, chunks);
  const byId = Object.fromEntries((chunks || []).map(c => [c.id, c]));
  const out = [];

  for (const th of proposals) {
    const refs = (th.refIds || []).map(id => byId[id]).filter(Boolean);
    if (!refs.length) continue;

    const themeContext = refs.map(r => `[${r.id}] ${r.textSnippet}`).join("\n\n");
    
    const prompt = `Analyze "${th.title}" theme using ONLY these references:

${themeContext}

Extract information for this theme:

1. Create up to 10 key findings with [1], [2] style citations
2. Look for NUMERIC data and create appropriate charts:
   - Market share data (parts of whole) â†’ "pie" chart
   - Separate issues/barriers â†’ "bar" chart  
   - Trends over time â†’ "line" chart
3. Find actual quoted text (in quotation marks) with speaker attribution

IMPORTANT: Only create charts if you find real numbers in the references above${opts && opts.charts==='no' ? ' AND charts are disabled for this response.' : '.'}
IMPORTANT: For quotes, speaker must be EXACTLY one of: "Patient", "Caregiver", or "HCP" - no other speaker types allowed. Quote density: ${opts && opts.quotes ? opts.quotes : 'moderate'} (many=up to 5, moderate=1-2, none=0)

JSON format:
{
  "title": "${th.title}",
  "subtitle": "One sentence describing this theme",
  "bullets": ["Finding 1 with [1] citation", "Finding 2 with [2] citation"],
  "chartData": {
    "type": "pie",
    "series": [{"label": "Category A", "value": 45}, {"label": "Category B", "value": 55}]
  },
  "quotes": [{"text": "actual quoted text", "speaker": "Patient"}]
}`;

    const cmp = await openai.chat.completions.create({
      model,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1200
    });

    let obj = {};
    try { 
      obj = JSON.parse(cmp.choices[0]?.message?.content || "{}");
    } catch {
      logger.warn("Failed to parse theme JSON, skipping");
      continue;
    }
    
    if (!obj || !obj.title) continue;

    // FIXED: Enhanced chart validation with proper percentage handling
    if (obj.chartData && obj.chartData.series) {
      const series = Array.isArray(obj.chartData.series) ? obj.chartData.series : [];
      const validSeries = series
        .filter(s => s && typeof s.value === "number" && isFinite(s.value) && s.value > 0 && s.label)
        .slice(0, 8);
      
      if (validSeries.length >= 2) {
        let chartType = obj.chartData.type || 'bar';
        
        // Auto-detect market share data
        const total = validSeries.reduce((sum, s) => sum + s.value, 0);
        if (total >= 90 && total <= 110 && validSeries.length >= 2) {
          chartType = 'pie';
        }
        
        obj.chartData = {
          type: chartType,
          series: validSeries,
          title: obj.title
        };
        if (obj.chartData) { 
          obj.chartData = canonicalizeMarketShareChart(obj.chartData); 
          obj.chartData._preferred = true; 
        }
      } else {
        delete obj.chartData;
      }
    } else {
      delete obj.chartData;
    }

    // Ensure unique bullets
    const bullets = Array.isArray(obj.bullets) ? obj.bullets : [];
    const uniqueBullets = [...new Set(bullets)].slice(0, 4);

    // FIXED: Strict quote filtering - only allow Patient, Caregiver, HCP
    let validQuotes = Array.isArray(obj.quotes) ?
      obj.quotes
        .filter(q => {
          if (!q || !q.text || !q.speaker) return false;
          const speaker = q.speaker.toLowerCase().trim();
          return speaker === 'patient' || speaker === 'caregiver' || speaker === 'hcp';
        })
        .map(q => ({ text: q.text, speaker: q.speaker }))
      : [];
    const qCap = (opts && opts.quotes==='many') ? 5 : (opts && opts.quotes==='none') ? 0 : 2;
    validQuotes = validQuotes.slice(0, qCap);

    out.push({
      title: obj.title,
      subtitle: obj.subtitle,
      bullets: uniqueBullets,
      chartData: (opts && opts.charts==='no') ? null : obj.chartData,
      quotes: validQuotes
    });

    if (out.length >= 4) break;
  }

  logger.info(`Built ${out.length} supporting themes`);
  return out;
}

// === FIXED Google Drive sync (using current manifest files) ===
async function syncGoogleDriveData(options = {}) {
  const __forceAll = !!options.forceAll;
if (!config.drive.rootFolderId) {
    logger.warn("No Google Drive root folder configured - skipping sync");
    return;
  }
  
  // Check if credentials are available
  try {
    const auth = authClient || getAuth();
    if (!auth) {
      logger.warn("⚠️ No Google credentials available - skipping Drive sync");
      return;
    }
  } catch (error) {
    logger.warn(`⚠️ Google credentials error: ${error.message} - skipping Drive sync`);
    return;
  }

  try {
    logger.info("🔄 Starting Google Drive sync...");
  let __embedCounters = {candidates:0, supported:0, skippedUnchanged:0, embedded:0, skippedUnsupported:0, forced:0};
    
    const drive = google.drive({ version: "v3", auth: authClient || getAuth() });
    const clientFolders = await listClientFolders();
    
    for (const clientFolder of clientFolders) {
      logger.info(` Syncing client: ${clientFolder.name}`);
      
      // Get current files from Drive
      const allFiles = await getAllFilesRecursively(drive, clientFolder.id);
      
      // Filter for supported file types
      const supportedTypes = [
        'application/pdf',
        'application/vnd.google-apps.document',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.google-apps.presentation',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.google-apps.spreadsheet',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ];
      
      

  __embedCounters.candidates += (Array.isArray(allFiles)? allFiles.length: 0);
  __embedCounters.supported += (Array.isArray(currentFiles)? currentFiles.length: 0);
const mt = (file.mimeType || '').toLowerCase();
  const isSupported = (
    // Native Google/Office docs
    mt === 'application/vnd.google-apps.document' ||
    mt === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mt === 'application/vnd.google-apps.presentation' ||
    mt === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    mt === 'application/vnd.google-apps.spreadsheet' ||
    mt === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    // Common exports
    /document|presentation|spreadsheet/.test(mt) ||
    // Files we want to parse directly
    /\.(pdf|txt|md|vtt|srt|docx|pptx|xlsx)$/i.test(name) ||
    mt.startsWith('text/') ||
    mt === 'application/x-subrip' // .srt
  );
  return isSupported;
};

      __embedCounters.candidates += (Array.isArray(allFiles) ? allFiles.length : 0);
      __embedCounters.supported += (Array.isArray(currentFiles) ? currentFiles.length : 0);
      __embedCounters.skippedUnsupported += Math.max(0, (Array.isArray(allFiles)?allFiles.length:0) - (Array.isArray(currentFiles)?currentFiles.length:0));

      // Load existing manifest
      const manifestPath = path.join(MANIFEST_DIR, `${clientFolder.id}.json`);
      let existingManifest = { files: [], lastUpdated: null };
      
      if (fs.existsSync(manifestPath)) {
        try {
          existingManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        } catch (e) {
          logger.warn(`Failed to read manifest for ${clientFolder.name}:`, e.message);
        }
      }

      // Update manifest with current files only (remove deleted files)
      const updatedManifest = {
        files: currentFiles.map(f => {
          const existingFile = existingManifest.files.find(ef => ef.id === f.id);
          return {
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            modifiedTime: f.modifiedTime,
            size: f.size || 0,
            folderPath: f.folderPath,
            processed: existingFile ? existingFile.processed : false
          };
        }),
        lastUpdated: new Date().toISOString(),
        clientId: clientFolder.id,
        clientName: clientFolder.name
      };

      writeJSON(manifestPath, updatedManifest);
      
      const processedCount = updatedManifest.files.filter(f => f.processed).length;
      logger.info(`âœ… Updated manifest for ${clientFolder.name}: ${updatedManifest.files.length} files (${processedCount} processed)`);

      // Ingest / embed files to Pinecone when needed
      const forceReembed = __forceAll || (String(process.env.FORCE_REEMBED||'').toLowerCase()==='true');
      
      if (forceReembed) { logger.info('🔁 Manual sync forcing re-embed of all supported files'); }
// Check if we need to re-embed due to missing folderPath metadata in Pinecone
      // Create a marker file to track if we've already done the folderPath update
      const folderPathUpdateMarker = path.join(MANIFEST_DIR, '.folderpath-update-complete');
      const needsFolderPathUpdate = !forceReembed && !fs.existsSync(folderPathUpdateMarker) && 
        existingManifest.files.some(f => f.processed && f.folderPath);
      
      if (needsFolderPathUpdate) {
        logger.info('🔄 Detected need for folderPath metadata update in Pinecone embeddings');
        logger.info('🔄 This is a one-time update to enable project filtering functionality');
     for (const f of updatedManifest.files){
        const existing = existingManifest.files.find(ef => ef.id === f.id) || {};
        const needsReembed = forceReembed || !existing.processed || (existing.modifiedTime !== f.modifiedTime) || needsFolderPathUpdate;
      if (!needsReembed) { if (!forceReembed) continue; }
        try{
          const text = await extractTextForEmbedding(f);
          const [vec] = await embedTexts([text]);
          const meta = { 
            fileId: f.id, 
            fileName: f.name, 
            mimeType: f.mimeType,
            folderPath: f.folderPath || '',
            source: f.name
const meta = {
  fileId: f.id,
  fileName: f.name,
  folderPath: f.folderPath || 'N/A',
  modifiedTime: f.modifiedTime || null,
  clientId,
  driveFileId: f.id,
  type:
    ((f.folderPath || '').toLowerCase().includes('transcript') ||
     (f.name || '').toLowerCase().includes('transcript') ||
     (f.name || '').toLowerCase().includes('interview') ||
     (f.name || '').toLowerCase().includes('focus group') ||
     (f.name || '').toLowerCase().includes('fg_') ||
     (f.mimeType || '').startsWith('text/'))
      ? 'transcript'
      : 'report',
};
          
          __embedCounters.embedded++;f.processed = true;
          upserted++;
        }catch(e){ logger.warn('Embed failed for', f.name, e?.message||e); }
      }
      writeJSON(manifestPath, updatedManifest);
      logger.info(`📥 Ingest complete for ${clientFolder.name}: ${upserted} files embedded`);
      logger.info(`🧮 Embed stats: candidates=${__embedCounters.candidates}, supported=${__embedCounters.supported}, embedded=${__embedCounters.embedded}`);
      
      // Create marker file if we did a folderPath update
      if (needsFolderPathUpdate && upserted > 0) {
        fs.writeFileSync(folderPathUpdateMarker, 'Completed folderPath metadata update');
        logger.info('✅ FolderPath metadata update completed. Project filtering now enabled.');
      }
    }

    FORCE_REEMBED_ON_MANUAL = false;
    
    
  } catch (error) {
    logger.error("âš  Google Drive sync failed:", error.message);
  }
}

// Helper function to recursively get all files from a folder and its subfolders
async function getAllFilesRecursively(drive, folderId, folderPath = '') {
  const allFiles = [];
  
  try {
    const query = `'${folderId}' in parents and trashed=false`;
    const response = await drive.files.list({
      q: query,
      fields: "files(id,name,mimeType,modifiedTime,size,parents)",
      pageSize: 1000,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });

    const items = response.data.files || [];
    
    for (const item of items) {
      if (item.mimeType === 'application/vnd.google-apps.folder') {
        const subFolderPath = folderPath ? `${folderPath}/${item.name}` : item.name;
        const subFiles = await getAllFilesRecursively(drive, item.id, subFolderPath);
        allFiles.push(...subFiles);
      } else {
        allFiles.push({...item,
          folderPath: folderPath || 'Root'
        });
      }
    }
  } catch (error) {
    logger.error(`Failed to get files from folder ${folderId}:`, error.message);
  }
  
  return allFiles;
}

// ---- Embedding helpers ----
async function extractTextForEmbedding(file){
  // Enhanced text extraction for PDFs, Word docs, and plain text files
  try {
    if (file.mimeType === 'application/pdf') {
      const { mod } = await __loadPdfjsFlexible();
      const pdfjsLib = (mod && (mod.getDocument||mod.GlobalWorkerOptions)) ? mod : (mod && mod.default ? mod.default : null);
      const bytes = await __downloadDriveFile(file.id);
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
      const pages = Math.min(doc.numPages, 10);
      let text = file.name + "\n";
      for (let p=1; p<=pages; p++){
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        text += content.items.map(it=>it.str).join(" ") + "\n";
      }
      return text.slice(0, 8000);
    }
    
    // Handle Word documents and other Google Docs formats
    if (file.mimeType === 'application/vnd.google-apps.document' || 
        file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        file.mimeType === 'application/msword') {
      try {
        // For Google Docs, try to export as plain text
        if (file.mimeType === 'application/vnd.google-apps.document') {
          const auth = getAuth && typeof getAuth === 'function' ? getAuth() : undefined;
          const drive = google.drive({ version: 'v3', auth });
          const exportResponse = await drive.files.export({
            fileId: file.id,
            mimeType: 'text/plain'
          });
          if (exportResponse.data) {
            return (file.name + "\n" + exportResponse.data).slice(0, 8000);
          }
        }
      } catch (docError) {
        logger.warn("Document text extraction failed:", docError.message);
      }
    }
    
    // Handle plain text files (common for transcripts)
    if (file.mimeType === 'text/plain' || 
        file.mimeType === 'text/csv' ||
        file.name.toLowerCase().endsWith('.txt') ||
        file.name.toLowerCase().endsWith('.csv')) {
      try {
        const bytes = await __downloadDriveFile(file.id);
        const textContent = Buffer.from(bytes).toString('utf-8');
        return (file.name + "\n" + textContent).slice(0, 8000);
      } catch (textError) {
        logger.warn("Plain text extraction failed:", textError.message);
      }
    }
    
  } catch(e){ logger.warn("extractTextForEmbedding failed:", e?.message||e); }
  return file.name;

    // Handle plain text and transcript-like caption formats
    if (file.mimeType && (file.mimeType === 'text/plain' || file.mimeType === 'text/vtt' || file.mimeType === 'application/x-subrip')) {
      try {
        const buf = await __downloadDriveFile(file.id);
        let raw = buf.toString('utf8');
        // If VTT: strip WEBVTT header and timestamps
        if (file.mimeType === 'text/vtt' || /\.vtt$/i.test(file.name||'')) {
          raw = raw
            .replace(/^WEBVTT.*$/gmi, '')
            .replace(/\d{2}:\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}\.\d{3}.*$/gmi, '')
            .replace(/^\d+\s*$/gmi, '');
        }
        // If SRT: strip numeric cues and time ranges
        if (file.mimeType === 'application/x-subrip' || /\.srt$/i.test(file.name||'')) {
          raw = raw
            .replace(/^\s*\d+\s*$/gmi, '')
            .replace(/\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}.*$/gmi, '');
        }
        // Collapse repeated whitespace
        const text = (file.name + "\n" + raw).replace(/[ \t]+/g,' ').replace(/\n{2,}/g,'\n').slice(0, 8000);
        return text;
      } catch (_) {
        // fall through
      }
    }
    // Handle .txt or .md by extension if mimeType missing/wrong
    if ((file.name||'').toLowerCase().endsWith('.txt') || (file.name||'').toLowerCase().endsWith('.md')) {
      try {
        const buf = await __downloadDriveFile(file.id);
        const text = (file.name + "\n" + buf.toString('utf8')).slice(0, 8000);
        return text;
      } catch (_) {
        // fall through
      }
    }
    
}

async function pineconeUpsert(vectors, namespace){
  const body = { vectors, namespace };
  const r = await fetch(`${config.pinecone.indexHost}/vectors/upsert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Api-Key': config.pinecone.apiKey },
    body: JSON.stringify(body)
  });
  if (!r.ok){ throw new Error('Pinecone upsert failed: '+r.status); }
  return r.json();
}
// Auto-sync initialization
async function initializeAutoSync() {
  if (config.autoIngest.onStart) {
    logger.info("Auto-ingest enabled - starting initial sync");
    
    setTimeout(async () => {
      try {
        await syncGoogleDriveData();
      } catch (error) {
        logger.error("Initial sync failed:", error.message);
      }
    }, config.autoIngest.startDelayMs);
  }

  if (config.autoIngest.syncIntervalMs > 0) {
    const intervalMinutes = Math.round(config.autoIngest.syncIntervalMs / 60000);
    logger.info(`â° Scheduled sync enabled - will run every ${intervalMinutes} minutes`);
    
    setInterval(async () => {
      try {
        logger.info(" Running scheduled sync (recurring)");
        await syncGoogleDriveData();
      } catch (error) {
        logger.error("Scheduled sync failed:", error.message);
      }
    }, config.autoIngest.syncIntervalMs);
  }
}

// === Helper functions ===

// ===== Filename-based tag extraction helpers (clean) =====
function extractYearFromFileName(name){
  const s = String(name||'');
  
  // Check for MMDDYY format like 111324 (at end of filename)
  let m = s.match(/(\d{2})(\d{2})(\d{2})(?:\.pdf)?$/);
  if (m) {
    const year = m[3];
    return '20' + year; // Convert YY to 20YY
  }
  
  // Check for Q4YYYY pattern like Q42024
  m = s.match(/[Qq](\d+)(20\d{2})/);
  if (m) return m[2];
  
  // prefer explicit 20xx
  m = s.match(/(?:^|[^0-9])(20\d{2})(?:[^0-9]|$)/);
  if (m) return m[1];
  // MMDDYYYY
  m = s.match(/(?:^|[^0-9])(?:0?[1-9]|1[0-2])(?:\D|_)?(?:[0-3]?\d)(?:\D|_)?(20\d{2})(?:[^0-9]|$)/);
  if (m) return m[1];
  // YYYYMMDD
  m = s.match(/(?:^|[^0-9])(20\d{2})(?:\D|_)?(?:0?[1-9]|1[0-2])(?:\D|_)?(?:[0-3]?\d)(?:[^0-9]|$)/);
  if (m) return m[1];
  return '';
}

function extractMonthFromFileName(name){
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const s = String(name||'').toLowerCase();
  
  // Check for MMDDYY format like 111324 (at end of filename)
  let m = s.match(/(\d{2})(\d{2})(\d{2})(?:\.pdf)?$/);
  if (m) {
    const monthNum = parseInt(m[1], 10);
    if (monthNum >= 1 && monthNum <= 12) {
      return months[monthNum - 1];
    }
  }
  
  // Check for Q4YYYY patterns
  if (s.match(/[Qq]4/)) return 'December';
  if (s.match(/[Qq]3/)) return 'September';
  if (s.match(/[Qq]2/)) return 'June';
  if (s.match(/[Qq]1/)) return 'March';
  
  // month word
  for (let i=0;i<months.length;i++){
    if (s.includes(months[i].toLowerCase())) return months[i];
  }
  // numeric month like 12_20_2025 or 2025-12-20 or 122025
  m = s.match(/(?:^|[^0-9])(0?[1-9]|1[0-2])(?:\D|_)?(?:[0-3]?\d)?(?:\D|_)?20\d{2}(?:[^0-9]|$)/);
  if (m) { const n = parseInt(m[1],10); return months[n-1] || ''; }
  m = s.match(/(?:^|[^0-9])20\d{2}(?:\D|_)?(0?[1-9]|1[0-2])(?:\D|_)?(?:[0-3]?\d)?(?:[^0-9]|$)/);
  if (m) { const n = parseInt(m[1],10); return months[n-1] || ''; }
  return '';
}

function extractReportTypeFromFileName(name){
  const s = String(name||'').toLowerCase();
  if (s.includes('atu')) return 'ATU';
  if (s.includes('conjoint')) return 'Conjoint';
  if (s.includes('tracker')) return 'Tracker';
  if (s.includes('pmr') || s.includes('integrated') || s.includes('quant')) return 'PMR';
  if (s.includes('competitive') && s.includes('readiness')) return 'Competitive Readiness';
  return 'Survey';
}

// ===== end tag helpers =====
function requireSession(req,res,next){ 
  const t=req.get("x-auth-token"); 
  if(t && t===config.server.authToken) return next(); 
  if(req.session?.user) return next(); 
  res.status(401).json({ error:"Authentication required"}); 
}

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  res.status(401).json({ error: "Unauthorized" });
}

// ---- Admin role utilities ----
function getRole(req) {
  return String((req.session && req.session.user && req.session.user.role) || '').toLowerCase().trim();
}

function isAdmin(req) { 
  return getRole(req) === 'admin'; 
}

function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    res.status(403).json({ error: 'Admin access required' });
  }
  res.redirect('/');
}

// Pages
// Explicit asset routes (defensive)
app.get('/styles.css', (req, res) => { 
  res.type('text/css'); 
  res.sendFile(path.resolve('public/styles.css')); 
});

app.get('/enhanced_chart_rendering.js', (req, res) => { 
  res.type('application/javascript'); 
  res.sendFile(path.resolve('public/enhanced_chart_rendering.js')); 
});

app.get("/", async (req,res)=>{
  if(!req.session?.user){ 
    res.redirect("/login.html"); 
    return;
  }
  await serveHtmlWithUi(res, path.resolve("public/index.html")); 
});

app.get('/admin', requireAuth, async (req, res) => {
  if (!isAdmin(req)) {
    res.redirect('/');
    return;
  }
  await serveHtmlWithUi(res, path.resolve('public/admin.html')); 
});

// Admin Stats API endpoint
app.get("/api/admin/stats", requireAuth, requireAdmin, async (req, res) => {
  if (!isAdmin(req)) { 
    res.status(403).json({ error: 'Admin access required' }); 
    return;
  }
  
  try {
    // Get user data
    const usersData = readJSON(USERS_PATH, { users: [] });
    const adminCount = usersData.users.filter(u => u.role === 'admin').length;
    const clientCount = usersData.users.filter(u => u.role === 'client').length;
    
    // Get client libraries count
    const clientFolders = await listClientFolders();
    const libraryCount = clientFolders.length;
    
    // Mock searches today (you can implement real tracking later)
    const searchesToday = 0;
    
    res.json({
      totalAdmins: adminCount,
      totalClients: clientCount,
      clientLibraries: libraryCount,
      searchesToday: searchesToday
    });
  } catch (error) {
    logger.error("Failed to get admin stats:", error);
    res.status(500).json({ error: "Failed to get admin stats" });
  }
});

// === Filter options (front-end expects this) ===
app.get("/api/filter-options", async (req, res) => {
  try {
    const clientId = String(req.query.clientId || '').trim();
    const out = { years: [], methodology: [] };
    if (!clientId) {
      return res.json(out);
    }
    const manifestPath = path.join(MANIFEST_DIR, `${clientId}.json`);
    if (!fs.existsSync(manifestPath)) return res.json(out);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) || { files: [] };
    const years = new Set();
    const meths = new Set();
    const order = ['Qual','Conjoint','ATU','Message Testing','Concept Testing','Access Confidence','OBBs','Quant'];
    for (const f of (manifest.files || [])) {
      const name = String(f && f.name || '');
      const y = (name.match(/\b(20\d{2})\b/) || [null, null])[1];
      if (y) years.add(y);
      let labels = __mapMethodologiesFromText(name);
      if (!labels.length) labels = __inferQuantQualFromText(name);
      labels.forEach(l => meths.add(l));
    }
    const yearsArr = Array.from(years).sort((a,b)=> Number(b)-Number(a));
    const methArr = Array.from(meths).sort((a,b)=> order.indexOf(a) - order.indexOf(b));
    res.json({ years: yearsArr, methodology: methArr });
  } catch (e) {
    logger.warn('filter-options error', e.message);
    res.json({ years: [], methodology: [] });
  }
});

// === Clients (align with admin.js) ===
app.get("/api/clients", requireAuth, requireAdmin, async (req, res) => {
  try {
    const data = readJSON(CLIENTS_PATH, { clients: [] });
    const arr = (data.clients || []).map(c => ({
      id: c.id || c.name,
      name: c.name || c.id,
      library: c.library || c.libraryId || "—",
      createdAt: c.createdAt || c.created || null
    }));
    res.json(arr);
  } catch (error) {
    logger.error("Failed to list clients:", error);
    res.status(500).json({ error: "Failed to load clients" });
  }
});

app.post("/api/clients", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, library } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });
    const data = readJSON(CLIENTS_PATH, { clients: [] });
    if ((data.clients || []).some(c => String(c.id||c.name||"").toLowerCase() === String(name).toLowerCase())) {
      return res.status(400).json({ error: "client already exists" });
    }
    const item = { id: name, name, library: library || "—", createdAt: new Date().toISOString() };
    data.clients = [.(data.clients || []), item];
    writeJSON(CLIENTS_PATH, data);
    res.json(item);
  } catch (error) {
    logger.error("Failed to create client:", error);
    res.status(500).json({ error: "Failed to create client" });
  }
});

// === Admin Users (align with admin.js) ===
app.get("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const usersData = readJSON(USERS_PATH, { users: [] });
    const admins = (usersData.users || []).filter(u => String(u.role||"").toLowerCase() === "admin" || String(u.role||"").toLowerCase() === "internal");
    const arr = admins.map(a => ({
      id: a.username,
      username: a.username,
      createdAt: a.createdAt || a.created || null
    }));
    res.json(arr);
  } catch (error) {
    logger.error("Failed to list admin users:", error);
    res.status(500).json({ error: "Failed to load admin users" });
  }
});

app.post("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, password, role, email, allowedClients, library, libraryName } = req.body || {};
    if (!username) return res.status(400).json({ error: "username required" });
    const usersData = readJSON(USERS_PATH, { users: [] });
    if ((usersData.users || []).some(u => String(u.username||"").toLowerCase() === String(username).toLowerCase())) {
      return res.status(400).json({ error: "username already exists" });
    }
    const passwordHash = password ? await bcrypt.hash(password, 10) : bcrypt.hashSync((process.env.DEFAULT_NEW_USER_PASSWORD||"changeme123"),10);
    const user = {
      username,
      passwordHash,
      role: role && String(role).toLowerCase() === "client" ? "client" : "admin",
      createdAt: new Date().toISOString()
    };
    
    // Add optional fields if provided
    if (email) user.email = email;
    if (allowedClients) user.allowedClients = allowedClients;
    if (library) user.library = library;
    if (libraryName) user.libraryName = libraryName;
    
    // For admin accounts, set default allowedClients to "*"
    if (user.role === "admin" && !user.allowedClients) {
      user.allowedClients = "*";
    }
    
    usersData.users = [.(usersData.users||[]), user];
    writeJSON(USERS_PATH, usersData);
    res.json({ id: user.username, username: user.username, createdAt: user.createdAt });
  } catch (error) {
    logger.error("Failed to create admin user:", error);
    res.status(500).json({ error: "Failed to create admin user" });
  }
});

// Admin Accounts API endpoint
app.get("/api/admin/accounts", requireAuth, requireAdmin, async (req, res) => {
  if (!isAdmin(req)) { 
    res.status(403).json({ error: 'Admin access required' }); 
    return;
  }
  
  try {
    const usersData = readJSON(USERS_PATH, { users: [] });
    
    // Return user data without passwords
    const accounts = usersData.users.map(user => ({
      username: user.username,
      role: user.role,
      clientFolderId: user.clientFolderId || null,
      createdAt: user.createdAt || 'Unknown',
      allowedClients: user.allowedClients || null
    }));
    
    res.json(accounts);
  } catch (error) {
    logger.error("Failed to get admin accounts:", error);
    res.status(500).json({ error: "Failed to get admin accounts" });
  }
});

// Create User API endpoint
app.post("/api/admin/users/create", requireAuth, requireAdmin, async (req, res) => {
  if (!isAdmin(req)) { 
    res.status(403).json({ error: 'Admin access required' }); 
    return;
  }
  
  // Restrict account creation to production environment only
  if (isLocal) {
    res.status(403).json({ 
      error: 'Account creation is disabled in local development environment',
      message: 'Account creation is only available on the live production site for security reasons.'
    }); 
    return;
  }
  
  try {
    const { username, password, role, clientFolderId } = req.body;
    
    if (!username || !password || !role) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }
    
    if (password.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters" });
      return;
    }
    
    const usersData = readJSON(USERS_PATH, { users: [] });
    
    // Check if username already exists
    const existingUser = usersData.users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (existingUser) {
      res.status(400).json({ error: "Username already exists" });
      return;
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Create new user
    const newUser = {
      username,
      passwordHash,
      role: role === 'admin' ? 'internal' : role, // Map admin to internal
      createdAt: new Date().toISOString()
    };
    
    if (clientFolderId && role === 'client') {
      newUser.clientFolderId = clientFolderId;
      newUser.allowedClients = clientFolderId;
    }
    
    usersData.users.push(newUser);
    writeJSON(USERS_PATH, usersData);
    
    logger.info(`Created ${role} account: ${username}`);
    
    res.json({
      username: newUser.username,
      role: newUser.role,
      createdAt: newUser.createdAt
    });
    
  } catch (error) {
    logger.error("Failed to create user:", error);
    res.status(500).json({ error: "Failed to create user account" });
  }
});

// Add manual sync endpoint
app.post("/admin/manual-sync", requireAuth, requireAdmin, async (req, res) => {
  if (!isAdmin(req)) { 
    res.status(403).json({ error: 'Admin access required' }); 
    return;
  }
  
  try {
    logger.info(" Manual Google Drive sync triggered from admin panel");
        const result = await syncGoogleDriveData({ forceAll: true });
    res.json({ 
      success: true,
      message: "Google Drive sync completed successfully", 
      timestamp: new Date().toISOString() 
    });
  } catch (error) {
    logger.error("Manual Google Drive sync failed:", error);
    res.status(500).json({ 
      success: false,
      error: "Google Drive sync failed", 
      details: error.message 
    });
  }
});

// Library Stats API endpoint - Fixed to show Google Drive files
app.get("/admin/library-stats", requireAuth, requireAdmin, async (req, res) => {
  if (!isAdmin(req)) { 
    res.status(403).json({ error: 'Admin access required' }); 
    return;
  }
  
  try {
    const { clientId } = req.query;
    
    if (!clientId) {
      res.status(400).json({ error: "Client ID required" });
      return;
    }
    
    // Get manifest data for the client
    const manifestPath = path.join(MANIFEST_DIR, `${clientId}.json`);
    let manifest = { files: [], lastUpdated: null };
    
    if (fs.existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch (e) {
        logger.warn(`Failed to read manifest for ${clientId}:`, e.message);
      }
    }
    
    // Count processed vs total files
    const totalFiles = manifest.files.length;
    const processedFiles = manifest.files.filter(f => f.processed).length;
    
    res.json({
      driveCount: totalFiles,
      libraryCount: processedFiles,
      lastUpdated: manifest.lastUpdated,
      clientId: clientId
    });
    
  } catch (error) {
    logger.error("Failed to get library stats:", error);
    res.status(500).json({ error: "Failed to get library statistics" });
  }
});

// Delete User API endpoint
app.delete("/api/admin/users/:username", requireAuth, async (req, res) => {
  if (!isAdmin(req)) { 
    res.status(403).json({ error: 'Admin access required' }); 
    return;
  }
  
  try {
    const { username } = req.params;
    
    if (username === req.session.user.username) {
      res.status(400).json({ error: "Cannot delete your own account" });
      return;
    }
    
    const usersData = readJSON(USERS_PATH, { users: [] });
    const userIndex = usersData.users.findIndex(u => u.username === username);
    
    if (userIndex === -1) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    
    const deletedUser = usersData.users.splice(userIndex, 1)[0];
    writeJSON(USERS_PATH, usersData);
    
    logger.info(`Deleted user account: ${username}`);
    
    res.json({
      message: `User ${username} deleted successfully`,
      deletedUser: {
        username: deletedUser.username,
        role: deletedUser.role
      }
    });
    
  } catch (error) {
    logger.error("Failed to delete user:", error);
    res.status(500).json({ error: "Failed to delete user account" });
  }
});

// Auth endpoints
app.get('/me', async (req, res) => {
  if (!req.session || !req.session.user) {
    res.status(401).json({ ok:false, error: 'Not authenticated' });
    return;
  }
  const u = req.session.user;
  const role = String(u.role || '').toLowerCase().trim();
  const activeClientId = req.session.activeClientId || null;
  res.json({ ok:true, user: { username: u.username, role }, activeClientId });
});

app.post('/auth/login', express.json(), async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      res.status(400).json({ ok:false, error: 'Missing credentials' });
      return;
    }
    const store = readJSON(USERS_PATH, { users: [] });
    const uname = String(username).trim().toLowerCase();
    const user = store.users.find(u => String(u.username||'').toLowerCase() === uname);
    if (!user) {
      res.status(401).json({ ok:false, error: 'Invalid username or password' });
      return;
    }
    let passOk = false;
    if (user.passwordHash) { 
      try { 
        passOk = await bcrypt.compare(password, user.passwordHash); 
      } catch {}
    }
    if (!passOk && user.password) { 
      passOk = (user.password === password); 
    }
    if (!passOk) {
      res.status(401).json({ ok:false, error: 'Invalid username or password' });
      return;
    }
    const role = String(user.role || '').toLowerCase().trim();
    if (!['admin','client'].includes(role)) {
      res.status(403).json({ ok:false, error: 'Unauthorized role' });
      return;
    }
    req.session.user = { 
      username: user.username, 
      role, 
      allowedClients: user.allowedClients || null, 
      clientFolderId: user.clientFolderId || null 
    };
    res.json({ ok:true, user: { username: user.username, role } });
  } catch (err) {
    logger.error('Login error', err);
    res.status(500).json({ ok:false, error: 'Login failed' });
  }
});

app.post('/auth/logout', (req, res) => {
  try {
    req.session.destroy(() => res.json({ ok:true }));
  } catch {
    res.json({ ok:true });
  }
});

// Client switching endpoint
app.post('/auth/switch-client', (req, res) => {
  const { clientId } = req.body || {};
  if (req.session) {
    req.session.activeClientId = clientId;
  }
  res.json({ ok: true, activeClientId: clientId });
});

app.post('/auth/change-password', express.json(), async (req,res)=>{
  try{
    const { currentPassword, newPassword } = req.body || {};
    if (!req.session?.user) {
      res.status(401).json({ ok:false, error:'Not authenticated' });
      return;
    }
    if (!newPassword) {
      res.status(400).json({ ok:false, error:'New password required' });
      return;
    }
    const store = readJSON(USERS_PATH, { users: [] });
    const idx = store.users.findIndex(u => u.username === req.session.user.username);
    if (idx === -1) {
      res.status(404).json({ ok:false, error:'User not found' });
      return;
    }
    const user = store.users[idx];
    // verify current
    let passOk = false;
    if (user.passwordHash) {
      try { 
        passOk = await bcrypt.compare(currentPassword||'', user.passwordHash); 
      } catch {}
    }
    if (!passOk && user.password) passOk = (user.password === (currentPassword||''));
    if (!passOk) {
      res.status(401).json({ ok:false, error:'Current password incorrect' });
      return;
    }
    // update
    const newHash = await bcrypt.hash(newPassword, 10);
    delete user.password;
    user.passwordHash = newHash;
    store.users[idx] = user;
    writeJSON(USERS_PATH, store);
    res.json({ ok:true });
  }catch(err){
    logger.error('change-password error', err);
    res.status(500).json({ ok:false, error:'Failed to change password' });
  }
});

// Static files with cache control
app.use(express.static("public", {
  index:false, 
  setHeaders(res,filePath){ 
    if(/\.(html|css|js)$/i.test(filePath)){ 
      res.setHeader("Cache-Control","no-store"); 
    } else { 
      res.setHeader("Cache-Control","public, max-age=86400"); 
    } 
  }
}));

// Admin endpoints
app.post("/admin/sync-data", requireAuth, async (req, res) => {
  if (!isAdmin(req)) { 
    res.status(403).json({ error: 'Admin access required' }); 
    return;
  }
  
  try {
    logger.info(" Manual data sync triggered");
    await syncGoogleDriveData();
    res.json({ 
      message: "Data sync completed successfully", 
      timestamp: new Date().toISOString() 
    });
  } catch (error) {
    logger.error("Manual data sync failed:", error);
    res.status(500).json({ 
      error: "Data sync failed", 
      details: error.message 
    });
  }
});

app.get("/admin/sync-status", requireAuth, requireAdmin, async (req, res) => {
  if (!isAdmin(req)) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }

  try {
    const clientFolders = await listClientFolders();
    const status = [];

    for (const folder of clientFolders) {
      const manifestPath = path.join(MANIFEST_DIR, `${folder.id}.json`);
      let manifest = { files: [], lastUpdated: null };
      
      if (fs.existsSync(manifestPath)) {
        try {
          manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        } catch (e) {
          // ignore
        }
      }

      status.push({
        clientId: folder.id,
        clientName: folder.name,
        fileCount: manifest.files.length,
        processedCount: manifest.files.filter(f => f.processed).length,
        lastUpdated: manifest.lastUpdated
      });
    }

    res.json({ status, serverStartTime: new Date().toISOString() });
  } catch (error) {
    logger.error("Failed to get sync status:", error);
    res.status(500).json({ error: "Failed to get sync status" });
  }
});

// FIXED: Get current file manifest for a client
app.get("/api/client-manifest/:clientId", async (req, res) => {
  try {
    const { clientId } = req.params;
    const manifestPath = path.join(MANIFEST_DIR, `${clientId}.json`);
    
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      
      // Filter out any files that might not exist anymore
      const validFiles = manifest.files.filter(file => file && file.name);
      
      res.json({...manifest,
        files: validFiles
      });
    } else {
      res.json({ files: [], lastUpdated: null });
    }
  } catch (error) {
    logger.error("Manifest fetch error:", error);
    res.status(500).json({ error: "Failed to fetch manifest" });
  }
});

// ===== Manifest-driven filter to drop stale references =====
async function filterChunksToCurrentManifest(chunks, clientId){
  try{
    if (!Array.isArray(chunks) || chunks.length === 0) return chunks || [];
    if (!clientId) return chunks;

    const manifest = await getClientManifest(clientId);
    const files = Array.isArray(manifest?.files) ? manifest.files : [];
    const processedCount = files.filter(f => f && f.processed === true).length;

    // If nothing processed / empty manifest, don't drop results
    if (files.length === 0 || processedCount === 0) {
      return chunks;
    }

    // Create comprehensive matching sets for current files
    const currentFileIds = new Set(files.map(f => f.id).filter(Boolean));
    const currentNormalizedNames = new Set(files.map(f => f.name ? f.name.toLowerCase().replace(/[^a-z0-9]/g, '') : '').filter(Boolean));
    
    // Also track all possible name variations for renamed files
    const nameVariations = new Set();
    files.forEach(f => {
      if (f.name) {
        nameVariations.add(f.name.toLowerCase());
        nameVariations.add(f.name.toLowerCase().replace(/[^a-z0-9]/g, ''));
        // Add partial matches for common patterns
        const words = f.name.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
        words.forEach(word => nameVariations.add(word));
      }
    });

    const filtered = (chunks||[]).filter(c => {
      // First check if file ID matches current files
      if (c.fileId && currentFileIds.has(c.fileId)) {
        return true;
      }
      
      // Then check various name patterns
      const candidates = [
        c.fileName, c.source, c.study, c.title, c.name
      ].filter(Boolean);
      
      for (const candidate of candidates) {
        const normalized = candidate.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (currentNormalizedNames.has(normalized)) {
          return true;
        }
        
        // Check if any words from the candidate match current file variations
        const candidateWords = candidate.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
        const matchingWords = candidateWords.filter(word => nameVariations.has(word));
        
        // If significant word overlap, consider it a match (handles renames)
        if (matchingWords.length > 0 && matchingWords.length / candidateWords.length > 0.5) {
          return true;
        }
      }
      
      return false;
    });

    // If filtering removes everything, fallback to original chunks to avoid empty results
    if (filtered.length === 0) {
      logger.warn(`Manifest filter removed all chunks - using original results as fallback`);
      return chunks; 
    }
    
    logger.info(`Manifest filter: ${chunks.length} â†’ ${filtered.length} chunks (handles renamed files)`);
    return filtered;
  }catch(e){
    logger.warn("Manifest filter fallback:", e?.message||e);
    return chunks||[];
  }
}

async function getClientManifest(clientId) {
  const manifestPath = path.join(MANIFEST_DIR, `${clientId}.json`);
  if (fs.existsSync(manifestPath)) {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  }
  return { files: [], lastUpdated: null };
}

// Client libraries endpoint
async function listClientFolders(){
  if (!config.drive.rootFolderId){
    return [{id:"sample_client_1", name:"Genentech Research"}];
  }
  try{
    const drive = google.drive({version:"v3", auth: authClient || getAuth()});
    const q = `'${config.drive.rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const resp = await drive.files.list({ 
      q, 
      fields:"files(id,name)", 
      pageSize:200, 
      supportsAllDrives:true, 
      includeItemsFromAllDrives:true 
    });
    return (resp.data.files||[]).map(f=>({id:f.id, name:f.name}));
  }catch(e){
    logger.error("Failed to list client folders:", e.message);
    return [];
  }
}

app.get("/api/client-libraries", async (req,res)=>{
  try {
    const now = Date.now();
    
    // Check cache first
    if (CLIENT_LIBRARIES_CACHE.data && (now - CLIENT_LIBRARIES_CACHE.lastUpdated) < CLIENT_LIBRARIES_CACHE.ttl) {
      logger.info(`Returning ${CLIENT_LIBRARIES_CACHE.data.length} client libraries (cached)`);
      return res.json(CLIENT_LIBRARIES_CACHE.data);
    }
    
    // Cache miss, fetch fresh data
    const libs = await listClientFolders();
    
    // Update cache
    CLIENT_LIBRARIES_CACHE.data = libs;
    CLIENT_LIBRARIES_CACHE.lastUpdated = now;
    
    logger.info(`Returning ${libs.length} client libraries (fresh)`);
    res.json(libs);
  } catch (error) {
    logger.error('Error fetching client libraries:', error);
    res.status(500).json({ error: 'Failed to fetch client libraries' });
  }
});

// === NEW BLOCK-FIRST QUERY ENDPOINT (V2 PIPELINE) ===
app.post("/api/query", requireSession, async (req, res) => {
  try {
    const { 
      query, 
      clientId, 
      userId, 
      sessionId, 
      stream = true, 
      topK = 50,
      forcePlan = null,
      forceBlocks = null 
    } = req.body || {};

    if (!query || !String(query).trim()) {
      return res.status(400).json({ error: "Query is required" });
    }

    if (!process.env.ANSWER_PIPELINE_V2) {
      return res.status(503).json({ error: "V2 pipeline not enabled" });
    }

    const namespace = clientId || req.session?.activeClientId || "sample_client_1";
    const cleanQuery = String(query).trim();

    if (stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
      });

      const sendEvent = (event, data) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      try {
        const classification = await classify(cleanQuery, { clientId: namespace });
        
        const palette = {
          hasCharts: true,
          hasTables: true,
          hasText: true,
          hasQuotes: true,
          hasSlides: true
        };

        sendEvent('meta', {
          phase: 'classify',
          signals: classification.signals,
          plan: forcePlan || classification.type,
          confidence: classification.confidence
        });

        const plan = await planLayout(cleanQuery, classification.signals, palette);

        sendEvent('plan', {
          phase: 'plan',
          layout: plan
        });

        const bindingGenerator = bind(plan, cleanQuery, namespace, classification.signals);
        const finalLayout = [...plan];

        for await (const event of bindingGenerator) {
          if (event.phase === 'partial') {
            sendEvent('partial', event);
            
            if (event.targetIndex !== undefined && event.blocks) {
              finalLayout[event.targetIndex] = event.blocks.length === 1 ? event.blocks[0] : {
                kind: 'group',
                cols: event.blocks.length,
                blocks: event.blocks
              };
            }
          } else if (event.phase === 'final') {
            const validatedLayout = validateLayout(finalLayout.filter(Boolean));
            sendEvent('final', {
              phase: 'final',
              type: 'report',
              layout: validatedLayout,
              citations: event.citations || []
            });
            break;
          }
        }

      } catch (error) {
        logger.error('Streaming query error:', error);
        sendEvent('error', {
          phase: 'error',
          error: error.message
        });
      }

      res.end();

    } else {
      const classification = await classify(cleanQuery, { clientId: namespace });
      
      const palette = {
        hasCharts: true,
        hasTables: true,
        hasText: true,
        hasQuotes: true,
        hasSlides: true
      };

      const plan = await planLayout(cleanQuery, classification.signals, palette);
      const bindingGenerator = bind(plan, cleanQuery, namespace, classification.signals);
      const finalLayout = [...plan];
      let citations = [];

      for await (const event of bindingGenerator) {
        if (event.phase === 'partial' && event.targetIndex !== undefined && event.blocks) {
          finalLayout[event.targetIndex] = event.blocks.length === 1 ? event.blocks[0] : {
            kind: 'group',
            cols: event.blocks.length,
            blocks: event.blocks
          };
        } else if (event.phase === 'final') {
          citations = event.citations || [];
          break;
        }
      }

      const validatedLayout = validateLayout(finalLayout.filter(Boolean));
      
      res.json({
        type: 'report',
        layout: validatedLayout,
        citations
      });
    }

  } catch (error) {
    logger.error('Query API error:', error);
    res.status(500).json({ error: 'Failed to process query' });
  }
});

// Health check for V2 pipeline
app.get("/api/query/health", (req, res) => {
  const status = {
    v2Enabled: !!process.env.ANSWER_PIPELINE_V2,
    pineconeReady: !!process.env.PINECONE_API_KEY,
    openaiReady: !!process.env.OPENAI_API_KEY,
    timestamp: new Date().toISOString()
  };

  res.json(status);
});

// MAIN SEARCH ENDPOINT - FIXED for thumbnails and file names
app.post("/search", requireSession, async (req,res)=>{
  try{
    const { userQuery, clientId, filters, projectFilter } = req.body || {};
    if(!userQuery || !String(userQuery).trim()) {
      res.status(400).json({ error:"Query is required"});
      return;
    }
    
    const namespace = clientId || req.session?.activeClientId || "sample_client_1";
    logger.info(`Search query: "${userQuery}" in namespace: ${namespace}`);
    
    const [queryEmbedding] = await embedTexts([String(userQuery).trim()]);
    const topK = filters?.topk || filters?.topK || config.ai.defaultTopK;
    const searchResults = await pineconeQuery(queryEmbedding, namespace, topK);
    const matches = (searchResults.matches||[]).sort((a,b)=>(b.score||0)-(a.score||0));
    
    logger.info("Pinecone search returned", matches.length, "results");
    logger.info("Top scores:", matches.slice(0,5).map(m=> (m.score||0).toFixed(3)).join(", "));
    
    const threshold = config.search.scoreThreshold;
    
    // Enrich matches with folderPath/fileName from current manifest if missing
    try {
      if (Array.isArray(matches) && CURRENT_MANIFEST && CURRENT_MANIFEST.byFileId) {
        const byId = CURRENT_MANIFEST.byFileId; // { fileId: { folderPath, name } }
        for (const m of matches) {
          const md = m.metadata || (m.metadata = {});
          const fid = md.fileId || md.driveFileId || md.id || null;
          if (fid && (!md.folderPath || md.folderPath === 'N/A')) {
            const mf = byId[fid];
            if (mf) {
              md.folderPath = mf.folderPath || md.folderPath;
              md.fileName = md.fileName || mf.name;
            }
          }
        }
      }
    } catch (e) {
      logger.warn("FolderPath enrichment failed:", e?.message);
    }
let relevantChunks = matches.filter(m=> (m.score||0) >= threshold).map((m,i)=>{
      const md = m.metadata||{};
      return {
        id:`ref${i+1}`,
        fileName: md.fileName || md.source || "Unknown Document",
        study: md.study || md.title || md.fileName || "Unknown Study",
        yearTag: md.year || md.yearTag || extractYearFromFileName(md.fileName||""),
        monthTag: md.month || md.monthTag || extractMonthFromFileName(md.fileName||""),
        reportTag: md.reportType || md.reportTag || extractReportTypeFromFileName(md.fileName||""),
        textSnippet: md.text || md.content || "Content not available",
        score: m.score,
        pageNumber: md.page || md.pageNumber || 1,
        page: md.page || md.pageNumber || 1,
        source: md.source || md.fileName || "Unknown Document",
        chunkIndex: md.chunkIndex,
        // CRITICAL: Add Google Drive file ID from metadata
        fileId: md.fileId || md.driveId || md.gdocId || null
      };
    });
    
    if (relevantChunks.length===0 && matches.length>0){
      logger.warn(`No matches exceeded threshold ${threshold}. Using topK as fallback.`);
      const fallbackCount = Math.min(matches.length, Number(topK)||50);
      relevantChunks = matches.slice(0,fallbackCount).map((m,i)=>{
        const md = m.metadata||{};
        return {
          id:`ref${i+1}`,
          fileName: md.fileName || md.source || "Unknown Document",
          study: md.study || md.title || md.fileName || "Unknown Study",
          yearTag: md.year || md.yearTag || extractYearFromFileName(md.fileName||""),
          monthTag: md.month || md.monthTag || extractMonthFromFileName(md.fileName||""),
          reportTag: md.reportType || md.reportTag || extractReportTypeFromFileName(md.fileName||""),
          textSnippet: md.text || md.content || "Content not available",
          score: m.score,
          pageNumber: md.page || md.pageNumber || 1,
          page: md.page || md.pageNumber || 1,
          source: md.source || md.fileName || "Unknown Document",
          chunkIndex: md.chunkIndex,
          // CRITICAL: Add Google Drive file ID from metadata
          fileId: md.fileId || md.driveId || md.gdocId || null
        };
      });
    }
    
    logger.info(`Processed ${relevantChunks.length} relevant chunks`);

    // ENHANCED: Better file ID mapping from current Google Drive manifest with name updates
    try {
      const manifestPath = path.join(MANIFEST_DIR, `${namespace}.json`);
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const currentFiles = manifest.files || [];
        
        // Create multiple mappings for robust file matching
        const fileIdToCurrentData = new Map();
        const normalizedNameToCurrentData = new Map();
        
        currentFiles.forEach(file => {
          if (file.id && file.name) {
            const currentData = {
              id: file.id,
              currentName: file.name,  // This is the up-to-date name from Drive
              mimeType: file.mimeType,
              modifiedTime: file.modifiedTime
            };
            
            // Map by file ID (most reliable)
            fileIdToCurrentData.set(file.id, currentData);
            
            // Map by normalized name for fallback matching
            const normalizedName = file.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            normalizedNameToCurrentData.set(normalizedName, currentData);
          }
        });
        
        // Update chunks with current Google Drive file information
        relevantChunks.forEach(chunk => {
          let matched = false;
          
          // First, try to match by existing fileId in metadata
          if (chunk.fileId && fileIdToCurrentData.has(chunk.fileId)) {
            const currentData = fileIdToCurrentData.get(chunk.fileId);
            chunk.fileName = currentData.currentName;  // Use CURRENT name from Drive
            chunk.source = currentData.currentName;
            matched = true;
            console.log(`âœ… Updated by fileId: ${chunk.fileId} â†’ ${currentData.currentName}`);
          }
          
          // If no fileId match, try matching by normalized filename
          if (!matched && chunk.fileName) {
            const normalizedChunkName = chunk.fileName.toLowerCase().replace(/[^a-z0-9]/g, '');
            
            if (normalizedNameToCurrentData.has(normalizedChunkName)) {
              const currentData = normalizedNameToCurrentData.get(normalizedChunkName);
              chunk.fileId = currentData.id;
              chunk.fileName = currentData.currentName;  // Use CURRENT name from Drive
              chunk.source = currentData.currentName;
              matched = true;
              console.log(`âœ… Updated by name match: ${normalizedChunkName} â†’ ${currentData.currentName} (${currentData.id})`);
            }
          }
          
          // Try partial matching for renamed files
          if (!matched && chunk.fileName) {
            const chunkWords = chunk.fileName.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
            
            for (const [fileId, currentData] of fileIdToCurrentData.entries()) {
              const currentWords = currentData.currentName.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
              
              // Calculate word overlap
              const commonWords = chunkWords.filter(word => currentWords.includes(word));
              const similarity = commonWords.length / Math.max(chunkWords.length, currentWords.length);
              
              // If significant similarity (>60% word overlap), assume it's the same file
              if (similarity > 0.6) {
                chunk.fileId = currentData.id;
                chunk.fileName = currentData.currentName;  // Use CURRENT name from Drive
                chunk.source = currentData.currentName;
                matched = true;
                console.log(`âœ… Updated by similarity match: ${chunk.fileName} â†’ ${currentData.currentName} (${similarity.toFixed(2)} similarity)`);
                break;
              }
            }
          }
        });
        
        logger.info(`Mapped file IDs for ${relevantChunks.filter(c => c.fileId).length} chunks from current manifest`);
        logger.info(`Using current file names from Google Drive (handles renames)`);
      }
    } catch (error) {
      logger.error('Error mapping file IDs from manifest:', error);
    }

    // Drop any references not in current Drive manifest (prevents stale docs)
    if (Array.isArray(relevantChunks)) {
      const activeClient = (req.session && req.session.clientId) || (filters && filters.clientId) || null;
      if (!config.search.skipManifestFilter) {
        relevantChunks = await filterChunksToCurrentManifest(relevantChunks, activeClient);
      } else { 
        logger.info('Manifest filter skipped via SKIP_MANIFEST_FILTER'); 
      }
      logger.info(`After manifest filter: ${relevantChunks.length} chunks`);
      
      // PROJECT FILTERING: Filter by specific project if requested
      if (projectFilter && projectFilter.trim()) {
        const originalChunkCount = relevantChunks.length;
        relevantChunks = relevantChunks.filter(chunk => {
          // Check if the chunk is from files within the project folder structure
          // Look for the project name in the folder path, not just filename
          const folderPath = (chunk.folderPath || '').toLowerCase();
          const fileName = (chunk.fileName || chunk.source || '').toLowerCase();
          const projectName = projectFilter.toLowerCase().trim();
          
          // Check if this file is within the project folder structure
          // Format: [client folder]/[project name]/[subfolder like QNR, Reports, Data, Transcripts]
          const isInProjectFolder = folderPath.includes('/' + projectName + '/') || 
                                   folderPath.includes(projectName + '/') ||
                                   folderPath.startsWith(projectName + '/') ||
                                   folderPath === projectName;
          
          // Fallback: also check filename for backwards compatibility
          const isInProjectFile = fileName.includes(projectName);
          
          return isInProjectFolder || isInProjectFile;
        });
        logger.info(`Project filter "${projectFilter}" applied: ${originalChunkCount} → ${relevantChunks.length} chunks`);
        
        // Debug logging to help troubleshoot
        if (relevantChunks.length === 0 && originalChunkCount > 0) {
          logger.warn(`No chunks matched project "${projectFilter}". Sample chunk folder paths:`);
          matches.slice(0, 10).forEach((match, i) => {
            const folderPath = (match.metadata?.folderPath || 'N/A');
            const fileName = (match.metadata?.fileName || 'N/A');
            const fileId = (match.metadata?.fileId || 'N/A');
            logger.warn(`  ${i+1}. FolderPath: "${folderPath}", FileName: "${fileName}", FileId: "${fileId}"`);
          });
          
          // Let's also check if we have ANY vectors with the expected folderPath
          logger.warn(`Looking for any chunks that might match folderPath containing "${projectFilter.toLowerCase()}"`);
          const possibleMatches = matches.filter(match => {
            const folderPath = (match.metadata?.folderPath || '').toLowerCase();
            return folderPath.includes(projectFilter.toLowerCase());
          });
          logger.warn(`Found ${possibleMatches.length} potential matches with folderPath containing "${projectFilter}"`);
        }
      }
    
      // If nothing survives filtering, avoid hallucinations: return a grounded message
      if (!relevantChunks || relevantChunks.length === 0) {
        const noResultsMessage = projectFilter 
          ? `I couldn't find grounded content for that question in the "${projectFilter}" project. Try broadening your search or selecting a different project.`
          : "I couldn't find grounded content in the selected library for that question.";
        
        res.json({
          answer: noResultsMessage,
          supporting: [],
          reportSlides: [],
          references: [],
          ok: true
        });
        return;
      }
    }

    // Select most recent study once (global for this request)
    const recency = preferMostRecent(relevantChunks);
    const mostRecentRef = recency.mostRecent;

    // Generate main answer with better headline structure
    const context = relevantChunks.map((c,i)=>`[${i+1}] ${c.textSnippet}`).join("\n\n");
    let generatedAnswer = "No answer.";
    
    try{
      const thinkingLevel = filters?.thinking || 'moderate';
      logger.info(`Using thinking level: ${thinkingLevel}`);
      
      let responseInstructions;
      switch(thinkingLevel) {
        case 'concise':
          responseInstructions = 'Provide a concise, direct answer focusing only on the key points. Keep your response brief and to the point.';
          break;
        case 'detailed':
          responseInstructions = 'Provide a comprehensive, detailed answer that thoroughly explores the topic. Include context, implications, and relevant details from the research.';
          break;
        case 'moderate':
        default:
          responseInstructions = 'Provide a complete answer with appropriate detail. Include the main findings and sufficient context without being overly lengthy.';
          break;
      }
      
      const prompt = `Question: ${userQuery}

Here is the relevant research information:
${context}

${responseInstructions}

Based on this information, please answer the question in a natural, conversational way.`;
      
      // Adjust max tokens based on thinking level
      let maxTokens;
      switch(thinkingLevel) {
        case 'concise': maxTokens = 300; break;
        case 'detailed': maxTokens = 800; break;
        case 'moderate': 
        default: maxTokens = 500; break;
      }
      
      const completion = await openai.chat.completions.create({
        model: config.ai.answerModel,
        messages: [{ role:"user", content: prompt }],
        temperature: 0.2, 
        max_tokens: maxTokens
      });
      generatedAnswer = completion.choices[0]?.message?.content || generatedAnswer;
      logger.info('RAW AI Response:', JSON.stringify(generatedAnswer));
    }catch(e){
      logger.warn("OpenAI completion failed:", e.message);
      generatedAnswer = "I wasn't able to find enough information in the research library to provide a comprehensive answer to your question.";
    }

    // SIMPLE MODE: Skip theme generation completely
    logger.info('Simple mode: Skipping theme generation for faster response');

    // SIMPLE MODE: Add quotes if requested
    let quotes = [];
    const quotesLevel = filters?.quotes || 'moderate';
    
    if (quotesLevel !== 'none') {
      logger.info(`Processing quotes with level: ${quotesLevel}`);
      quotes = await extractSupportingQuotes(relevantChunks, userQuery, quotesLevel);
      logger.info(`Found ${quotes.length} supporting quotes`);
    }

    // SIMPLE MODE: Return answer with optional quotes
    logger.info('Simple mode: Returning text-only response with quotes');
    res.json({
      answer: generatedAnswer,
      quotes: quotes,
      // Empty arrays for compatibility
      supportingThemes: [],
      themes: [],
      reports: [],
      references: { chunks: [] }
    });
    return;
  }catch(err){
    logger.error("Search error:", err);
    logger.error("Search error details:", {
      message: err.message,
      stack: err.stack,
      name: err.name,
      code: err.code
    });
    res.status(500).json({ 
      error: "Failed to process search query",
      details: err.message,
      type: err.name || 'Unknown Error'
    });
  }
});

// === Simple Reports Store (per-user) ===
const REPORTS_DB = path.resolve(process.cwd(), "data-cache", "reports.json");
function getUserKey(req){ return (req.session?.user?.username) ? `u:${req.session.user.username}` : `s:${req.sessionID||'anon'}`; }
function readReportsDb(){ try{ return JSON.parse(fs.readFileSync(REPORTS_DB,"utf-8")); }catch(e){ return {}; } }
function writeReportsDb(db){ try{ fs.mkdirSync(path.dirname(REPORTS_DB), {recursive:true}); fs.writeFileSync(REPORTS_DB, JSON.stringify(db,null,2)); }catch(e){ logger.warn("Failed to write reports DB:", e.message); } }
function sanitizeText(s) {
  // Strip ASCII control chars (0x00â€“0x1F and DEL 0x7F), collapse whitespace, trim, cap length
  const str = String(s ?? "");
  const cleaned = str.replace(/[\x00-\x1F\x7F]+/g, " ");
  return cleaned.replace(/\s+/g, " ").trim().slice(0, 20000);
}

app.get("/api/reports", requireSession, (req,res)=>{
  const db = readReportsDb(); const key = getUserKey(req);
  const list = Object.values(db[key]||{});
  res.json({ ok:true, data: list });
});

app.post("/api/reports", requireSession, (req,res)=>{
  const { title } = req.body||{};
  const db = readReportsDb(); const key = getUserKey(req);
  const id = `rep_${new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14)}_${Math.random().toString(36).substr(2,5)}`;
  const now = Date.now();
  const rep = { id, title: sanitizeText(title||"My Working Report"), items: [], createdBy: req.session?.user?.username||null, createdAt: now, updatedAt: now };
  db[key] = db[key] || {}; db[key][id] = rep; writeReportsDb(db);
  res.json({ ok:true, data: rep });
});

app.get("/api/reports/:id", requireSession, (req,res)=>{
  const db = readReportsDb(); const key = getUserKey(req);
  const rep = (db[key]||{})[req.params.id];
  if(!rep) return res.status(404).json({ ok:false, error:"Not found" });
  res.json({ ok:true, data: rep });
});

app.put("/api/reports/:id", requireSession, (req,res)=>{
  const db = readReportsDb(); const key = getUserKey(req);
  const rep = (db[key]||{})[req.params.id];
  if(!rep) return res.status(404).json({ ok:false, error:"Not found" });
  if (typeof req.body.title === 'string') rep.title = sanitizeText(req.body.title);
  if (Array.isArray(req.body.items)) rep.items = req.body.items.map(it=> ({
    id: String(it.id||Math.random().toString(36).slice(2)),
    responseId: sanitizeText(it.responseId||""),
    content: sanitizeText(it.content||""),
    sourceMeta: it.sourceMeta && typeof it.sourceMeta==='object' ? it.sourceMeta : {},
    createdAt: Number(it.createdAt||Date.now())
  }));
  rep.updatedAt = Date.now(); writeReportsDb(db);
  res.json({ ok:true, data: rep });
});

app.delete("/api/reports/:id", requireSession, (req,res)=>{
  const db = readReportsDb(); const key = getUserKey(req);
  if (db[key] && db[key][req.params.id]) { delete db[key][req.params.id]; writeReportsDb(db); }
  res.json({ ok:true, data: true });
});

// === Added in v12 fix: delete a report ===
app.delete('/api/reports/:id', (req, res) => {
  try{
    const userKey = getUserKey(req);
    const db = readReports();
    const idx = db.reports.findIndex(x => x.id === req.params.id && x.ownerKey === userKey);
    if (idx === -1) return res.status(404).json({ ok:false, error:'Not found' });
    db.reports.splice(idx, 1);
    writeReports(db);
    res.json({ ok:true, data:true });
  }catch(e){ res.status(500).json({ ok:false, error:'Failed to delete report' }); }
});

app.post("/api/reports/:id/items", requireSession, (req,res)=>{
  const db = readReportsDb(); const key = getUserKey(req);
  const rep = (db[key]||{})[req.params.id];
  if(!rep) return res.status(404).json({ ok:false, error:"Not found" });
  const items = Array.isArray(req.body?.items)? req.body.items : [];
  for (const it of items){
    rep.items.push({
      id: String(it.id||Math.random().toString(36).slice(2)),
      responseId: sanitizeText(it.responseId||""),
      content: sanitizeText(it.content||""),
      sourceMeta: it.sourceMeta && typeof it.sourceMeta==='object' ? it.sourceMeta : {},
      createdAt: Number(it.createdAt||Date.now())
    });
  }
  rep.updatedAt = Date.now(); writeReportsDb(db);
  res.json({ ok:true, data: rep });
});

app.put("/api/reports/:id/items/reorder", requireSession, (req,res)=>{
  const db = readReportsDb(); const key = getUserKey(req);
  const rep = (db[key]||{})[req.params.id];
  if(!rep) return res.status(404).json({ ok:false, error:"Not found" });
  const ids = Array.isArray(req.body?.itemIds) ? req.body.itemIds.map(String) : [];
  const map = new Map(rep.items.map(it=>[String(it.id), it]));
  rep.items = ids.map(id=> map.get(String(id))).filter(Boolean);
  rep.updatedAt = Date.now(); writeReportsDb(db);
  res.json({ ok:true, data: rep });
});

app.post("/api/telemetry", (req,res)=>{
  try { logger.info("telemetry", req.body||{}); } catch(_) {}
  res.json({ ok:true });
});

// Health check
app.get("/health", (req,res)=> res.json({ ok:true, time:new Date().toISOString() }));

// --- Improved: /api/libraries returns readable names
app.get("/api/libraries", requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!isAdmin(req)) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    const folders = await listClientFolders().catch(() => []);
    const libs = [];
    (Array.isArray(folders) ? folders : []).forEach(item => {
      if (item == null) return;
      if (typeof item === 'string') {
        libs.push({ id: item, name: item });
      } else if (typeof item === 'object') {
        const id = item.id || item.folderId || item.gid || item.code || item.key || item.slug || item.name || item.folderName;
        const name = item.name || item.title || item.clientName || item.displayName || item.folderName || item.label || item.text || item.client || item.library || id || 'Unnamed';
        libs.push({ id, name });
      }
    });
    res.json(libs);
  } catch (e) {
    logger && logger.error && logger.error("GET /api/libraries", e);
    res.json([]);
  }
});

// === v11: Stats per library (ESM/CJS-safe, NO `return` statements inside handler) ===
app.get("/api/libraries/:id/stats", requireAuth, requireAdmin, async (req, res) => {
  if (!isAdmin(req)) { 
    res.status(403).json({ error: 'Admin access required' }); 
    return;
  }

  try {
    const { id } = req.params;
    
    // Get manifest data from Google Drive sync
    const manifestPath = path.join(MANIFEST_DIR, `${id}.json`);
    let manifest = { files: [], lastUpdated: null };
    
    if (fs.existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch (e) {
        logger.warn(`Failed to read manifest for ${id}:`, e.message);
      }
    }
    
    const totalFiles = manifest.files.length;
    const processedFiles = manifest.files.filter(f => f.processed).length;
    
    // Categorize files
    let reportCount = 0;
    let qnrCount = 0;
    let dataCount = 0;
    
    manifest.files.forEach(file => {
      const folderPath = (file.folderPath || '').toLowerCase();
      const fileName = (file.name || '').toLowerCase();
      
      if (folderPath.includes('report') || fileName.includes('report')) {
        reportCount++;
      } else if (folderPath.includes('qnr') || folderPath.includes('questionnaire')) {
        qnrCount++;
      } else if (folderPath.includes('data')) {
        dataCount++;
      } else {
        reportCount++;
      }
    });
    
    res.json({
      totalFiles: totalFiles,
      processedFiles: processedFiles,
      lastSynced: manifest.lastUpdated,
      byCategory: {
        Reports: reportCount,
        QNR: qnrCount,
        DataFiles: dataCount
      },
      // Legacy format for compatibility
      files: totalFiles,
      lastIndexed: manifest.lastUpdated,
      byFolder: {
        Reports: reportCount,
        QNR: qnrCount,
        DataFiles: dataCount
      }
    });
    
  } catch (error) {
    logger.error("Failed to get library stats:", error);
    res.status(500).json({ 
      totalFiles: 0, 
      processedFiles: 0, 
      lastSynced: null,
      byCategory: { Reports: 0, QNR: 0, DataFiles: 0 },
      // Legacy format
      files: 0, 
      lastIndexed: null, 
      byFolder: { Reports: 0, QNR: 0, DataFiles: 0 } 
    });
  }
});

// NEW: Get projects for a library (organized by project folders)
app.get("/api/libraries/:id/projects", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`[API] Loading projects for library: ${id}`);
    
    // Get manifest data from Google Drive sync
    const manifestPath = path.join(MANIFEST_DIR, `${id}.json`);
    console.log(`[API] Looking for manifest at: ${manifestPath}`);
    let manifest = { files: [], lastUpdated: null };
    
    if (fs.existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch (e) {
        logger.warn(`Failed to read manifest for ${id}:`, e.message);
      }
    }
    
    if (!manifest.files || manifest.files.length === 0) {
      console.log(`[API] No files found in manifest for library: ${id}`);
      return res.json([]);
    }
    
    console.log(`[API] Found ${manifest.files.length} files in manifest`);
    
    // Group files by project (folderPath)
    const projectMap = {};
    
    manifest.files.forEach(file => {
      // Extract project name from folderPath
      let projectName = file.folderPath || 'Ungrouped';
      
      // Handle nested folder structure: "Project Name/QNR" -> "Project Name"
      const pathParts = projectName.split('/');
      if (pathParts.length > 1) {
        projectName = pathParts[0]; // Use the top-level folder as project name
      }
      
      if (!projectMap[projectName]) {
        projectMap[projectName] = {
          name: projectName,
          files: [],
          folderStructure: {
            QNR: [],
            Data: [],
            Reports: [],
            Transcripts: [],
            Other: []
          }
        };
      }
      
      // Add file to project
      const fileInfo = {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
        modifiedTime: file.modifiedTime,
        folderPath: file.folderPath,
        processed: file.processed
      };
      
      projectMap[projectName].files.push(fileInfo);
      
      // Categorize file by folder structure
      const lowerFolderPath = (file.folderPath || '').toLowerCase();
      const lowerFileName = (file.name || '').toLowerCase();
      
      if (lowerFolderPath.includes('/qnr') || lowerFolderPath.includes('questionnaire') || lowerFileName.includes('qnr') || lowerFileName.includes('screener')) {
        projectMap[projectName].folderStructure.QNR.push(fileInfo);
      } else if (lowerFolderPath.includes('/data') || lowerFileName.includes('data') || file.mimeType.includes('spreadsheet')) {
        projectMap[projectName].folderStructure.Data.push(fileInfo);
      } else if (lowerFolderPath.includes('/reports') || lowerFileName.includes('report')) {
        projectMap[projectName].folderStructure.Reports.push(fileInfo);
      } else if (lowerFolderPath.includes('/transcript') || lowerFileName.includes('transcript') || lowerFileName.includes('interview') || lowerFileName.includes('focus group') || lowerFileName.includes('fg_')) {
        projectMap[projectName].folderStructure.Transcripts.push(fileInfo);
      } else {
        projectMap[projectName].folderStructure.Other.push(fileInfo);
      }
    });
    
    // Convert to array and extract metadata for each project
    const projects = await Promise.all(
      Object.values(projectMap).map(async (project) => {
        const metadata = await extractProjectMetadata(project);
        return {
          ...project,
          ...metadata,
          fileCount: project.files.length,
          lastModified: Math.max(...project.files.map(f => new Date(f.modifiedTime).getTime())),
          folders: {
            QNR: project.folderStructure.QNR.length,
            Data: project.folderStructure.Data.length,  
            Reports: project.folderStructure.Reports.length,
            Transcripts: project.folderStructure.Transcripts.length,
            Other: project.folderStructure.Other.length
          }
        };
      })
    );
    
    // Sort projects by parsed Date (newest first), fallback to lastModified
    function m2n(s){ if(!s) return 0; const m=String(s).slice(0,3).toLowerCase(); const map={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12}; return map[m]||0; }
    projects.sort((a,b)=>{
      const ya=Number(a.year||0), yb=Number(b.year||0);
      if (yb!==ya) return yb-ya;
      const ma=m2n(a.month), mb=m2n(b.month);
      if (mb!==ma) return mb-ma;
      return (b.lastModified||0)-(a.lastModified||0);
    });
    
    console.log(`[API] Returning ${projects.length} projects for library: ${id}`);
    console.log(`[API] Project names:`, projects.map(p => p.name));
    
    res.json(projects);
    
  } catch (error) {
    logger.error("Failed to get library projects:", error);
    res.status(500).json({ error: "Failed to load projects" });
  }
});

// Helper function to extract project metadata
async function extractProjectMetadata(project) {
  try {
    // Prefer parsing the first available report (PDF) in this project
    const reports = Array.isArray(project.folderStructure?.Reports) ? project.folderStructure.Reports : [];
    const pdfReport = reports.find(f => (f.mimeType || '').includes('pdf')) || reports[0] || null;

    let parsed = null;
    if (pdfReport && pdfReport.id) {
      parsed = await extractReportDetailsFromDrive(pdfReport.id).catch(() => null);
      // If AI key available, enhance background/insights conversationally using only REPORTS text
      if (parsed && (config.ai.openaiKey)) {
        try {
          const reportPages = await __extractTextPagesFromPdf(pdfReport.id, 15);
          const reportText = reportPages.join('\n').slice(0, 24000); // cap tokens
          const promptBg = `You are a senior market research analyst. Given REPORT TEXT from a project deck, write a concise 1-2 sentence background that captures why the research was conducted and what it aimed to learn. Use only the content; do not invent facts. Keep it plain, executive style.\n\nREPORT TEXT:\n${reportText}`;
          const promptKi = `You are a senior market research analyst. Based ONLY on the REPORT TEXT, write 2-3 short bullet points summarizing the key findings in an elevator-pitch, conversational style (no jargon, no headings, no figure captions). Each bullet should be one sentence.\n\nREPORT TEXT:\n${reportText}`;
          const [bgResp, kiResp] = await Promise.all([
            openai.chat.completions.create({ model: config.ai.answerModel, temperature: 0.2, messages: [{ role: 'user', content: promptBg }]}),
            openai.chat.completions.create({ model: config.ai.answerModel, temperature: 0.2, messages: [{ role: 'user', content: promptKi }]})
          ]);
          const bgText = (bgResp && bgResp.choices && bgResp.choices[0] && bgResp.choices[0].message && bgResp.choices[0].message.content) || '';
          const kiText = (kiResp && kiResp.choices && kiResp.choices[0] && kiResp.choices[0].message && kiResp.choices[0].message.content) || '';
          const cleanLines = (s)=> String(s||'')
            .split(/\n|\r|\u2022|\-|•/)
            .map(x=>x.replace(/^[-•\u2022]\s*/, '').trim())
            .filter(Boolean);
          const bgClean = cleanLines(bgText).join(' ').replace(/\s+/g,' ').trim();
          let kiBullets = cleanLines(kiText);
          if (kiBullets.length === 1) {
            // split a paragraph into sentences as bullets
            kiBullets = kiBullets[0].split(/(?<=[.!?])\s+/).map(s=>s.trim()).filter(Boolean);
          }
          kiBullets = kiBullets.slice(0,3);
          if (bgClean) parsed.background = bgClean;
          if (kiBullets.length) parsed.insights = kiBullets;
        } catch (e) {
          logger.warn('AI summarization failed; falling back to extracted text', e.message);
        }
      }
    }

    // Fallbacks from names if parsing failed
    const fallbackYear = (project.name.match(/\b(20\d{2})\b/) || [null, null])[1] || extractYearFromFiles(project.files);
    const fallbackMonth = extractMonthFromProject(project);
    const fallbackMethod = inferMethodology(project);
    const fallbackSample = 'Not specified';
    const fallbackFieldwork = 'Not specified';
    const fallbackBackground = '';
    const fallbackInsights = [];
    const tags = generateProjectTags(project);

    return {
      year: parsed?.year || fallbackYear,
      month: parsed?.month || fallbackMonth,
      methodology: parsed?.methodology || fallbackMethod,
      sample: parsed?.sample || fallbackSample,
      fieldwork: parsed?.fieldwork || fallbackFieldwork,
      background: parsed?.background || fallbackBackground,
      tags: tags,
      insights: Array.isArray(parsed?.insights) && parsed.insights.length ? parsed.insights : fallbackInsights
    };
  } catch (error) {
    logger.warn("Failed to extract metadata for project:", project.name, error);
    return {
      year: null,
      month: null,
      methodology: 'Unknown',
      sample: 'Not specified',
      fieldwork: 'Not specified',
      background: '',
      tags: [],
      insights: []
    };
  }
}

// Helper functions for metadata extraction
function extractYearFromFiles(files) {
  for (const file of files) {
    const yearMatch = file.name.match(/\b(20\d{2})\b/);
    if (yearMatch) return yearMatch[1];
  }
  return new Date().getFullYear().toString();
}

function extractMonthFromProject(project) {
  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 
                      'july', 'august', 'september', 'october', 'november', 'december'];
  const monthAbbrev = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 
                       'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  
  const searchText = (project.name + ' ' + project.files.map(f => f.name).join(' ')).toLowerCase();
  
  for (let i = 0; i < monthNames.length; i++) {
    if (searchText.includes(monthNames[i]) || searchText.includes(monthAbbrev[i])) {
      return monthNames[i].charAt(0).toUpperCase() + monthNames[i].slice(1);
    }
  }
  
  // Try to extract from date patterns
  const dateMatch = searchText.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (dateMatch) {
    const month = parseInt(dateMatch[1]);
    if (month >= 1 && month <= 12) {
      return monthNames[month - 1].charAt(0).toUpperCase() + monthNames[month - 1].slice(1);
    }
  }
  
  return null;
}

function inferMethodology(project) {
  const text = (project.name + ' ' + project.files.map(f => f.name).join(' ')).toLowerCase();
  
  // Clinical research indicators
  if (text.includes('clinical') || text.includes('atu') || text.includes('patient') || text.includes('medical')) {
    return 'Clinical Research';
  }
  
  // Strategy/consulting indicators  
  if (text.includes('strategy') || text.includes('competitive') || text.includes('market') || text.includes('access')) {
    return 'Strategic Analysis';
  }
  
  // Survey research indicators
  if (text.includes('survey') || text.includes('hcp') || text.includes('screener') || text.includes('questionnaire')) {
    return 'Survey Research';
  }
  
  // Promotional/marketing research
  if (text.includes('promo') || text.includes('marketing') || text.includes('campaign')) {
    return 'Marketing Research';
  }
  
  // Compliance/regulatory
  if (text.includes('compliance') || text.includes('regulatory') || text.includes('340b') || text.includes('rebate')) {
    return 'Regulatory/Compliance';
  }
  
  return 'Research Study';
}

function generateProjectTags(project) {
  const tags = [];
  const text = project.name.toLowerCase();
  
  // Extract meaningful words as tags
  const words = project.name.split(/[\s\-_]+/).filter(word => word.length > 2);
  
  // Add significant words as tags
  words.forEach(word => {
    if (word.match(/^[A-Za-z0-9]+$/)) { // Only alphanumeric
      tags.push(word);
    }
  });
  
  // Add file type tags
  if (project.folderStructure.QNR.length > 0) tags.push('QNR');
  if (project.folderStructure.Data.length > 0) tags.push('Data Analysis');
  if (project.folderStructure.Reports.length > 0) tags.push('Reports');
  
  // Add methodology tag
  tags.push(inferMethodology(project));
  
  return [...new Set(tags)]; // Remove duplicates
}

function inferSampleInfo(project) {
  const text = (project.name + ' ' + project.files.map(f => f.name).join(' ')).toLowerCase();
  
  if (text.includes('hcp')) return 'Healthcare Professionals';
  if (text.includes('patient')) return 'Patient Population';
  if (text.includes('physician')) return 'Physicians';
  if (text.includes('atu')) return 'ATU Program Participants';
  if (text.includes('340b')) return '340B Covered Entities';
  
  return 'Study Participants';
}

function inferFieldworkDates(project) {
  // Extract dates from file names
  const allText = project.files.map(f => f.name).join(' ');
  const dateMatch = allText.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  
  if (dateMatch) {
    return `Conducted ${dateMatch[0]}`;
  }
  
  // Use modification dates as fallback
  const dates = project.files.map(f => new Date(f.modifiedTime));
  const minDate = new Date(Math.min(...dates));
  const maxDate = new Date(Math.max(...dates));
  
  if (minDate.getTime() !== maxDate.getTime()) {
    return `${minDate.toLocaleDateString()} - ${maxDate.toLocaleDateString()}`;
  }
  
  return minDate.toLocaleDateString();
}

function generateBackground(project) {
  const methodology = inferMethodology(project);
  const sampleInfo = inferSampleInfo(project);
  
  return `${methodology} project focusing on ${project.name.toLowerCase()}. Study involves ${sampleInfo.toLowerCase()} with analysis of ${project.files.length} documents across multiple categories.`;
}

function generatePlaceholderInsights(project) {
  // This would be replaced with AI/NLP extraction from actual report content
  const insights = [];
  const methodology = inferMethodology(project);
  
  switch (methodology) {
    case 'Clinical Research':
      insights.push('Clinical outcomes showed positive trends');
      insights.push('Safety profile within expected parameters'); 
      insights.push('Patient reported outcomes improved');
      break;
    case 'Strategic Analysis':
      insights.push('Market opportunity identified in key segments');
      insights.push('Competitive positioning strategy recommended');
      insights.push('Implementation roadmap developed');
      break;
    case 'Survey Research':
      insights.push('High response rates achieved across target groups');
      insights.push('Key trends identified in participant feedback');
      insights.push('Recommendations provided for next steps');
      break;
    default:
      insights.push('Analysis completed successfully');
      insights.push('Key findings documented in reports');
      insights.push('Actionable recommendations provided');
  }
  
  return insights;
}

// Start server
if (!global._started){
  global._started=true;
  const server = 

// ---------------------------------------------------------------------------
// SECURE SLIDE ROUTE (brace-safe, ESM-safe)
// ---------------------------------------------------------------------------
console.info('âœ” secure-slide route ready');
app.get('/secure-slide/:fileId/:page', async (req, res) => {
  try {
    const rawFileId = req.params.fileId || '';
    const pageNumber = Math.max(1, parseInt(req.params.page, 10) || 1);
    const fileId = decodeURIComponent(rawFileId);

    if (!fileId) {
      return res.status(400).json({ error: 'File ID is required' });
    }

    // Initialize cache if needed
    await initThumbnailCache();

    // Check cache first
    const cacheKey = getThumbnailCacheKey(fileId, pageNumber);
    const cached = THUMBNAIL_CACHE.get(cacheKey);
    if (cached) {
      res.set({
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600'
      });
      return res.send(cached);
    }

    // Check disk cache
    const diskCachePath = path.join(THUMBNAIL_CACHE_DIR, `${cacheKey}.png`);
    try {
      const diskCached = await fsp.readFile(diskCachePath);
      // Cache in memory for faster access
      THUMBNAIL_CACHE.set(cacheKey, diskCached);
      res.set({
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600'
      });
      return res.send(diskCached);
    } catch (error) {
      // Not in cache, continue with generation
    }

    // Reuse your existing auth initialization
    if (!authClient) {
      await initializeGoogleAuth();
    }
    const drive = google.drive({ version: 'v3', auth: authClient });

    // Download the PDF bytes into memory (no temp files)
    const arrayBuffer = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    ).then(r => r.data);
    const pdfBuffer = Buffer.from(arrayBuffer);

    // ---- Load pdfjs (try multiple entry points) and canvas (Windows-friendly) ----
    async function loadPdfjs() {
      const candidates = [
        'pdfjs-dist/legacy/build/pdf.mjs',
        'pdfjs-dist/legacy/build/pdf.js',
        'pdfjs-dist/build/pdf.mjs',
        'pdfjs-dist'
      ];
      for (const p of candidates) {
        try { return { mod: await import(p), variant: p }; } catch {}
      }
      return { mod: null, variant: null };
    }
    async function loadCanvas() {
      try {
        const m = await import('@napi-rs/canvas');
        const createCanvas = m.createCanvas || (m.default && m.default.createCanvas);
        if (createCanvas) return { mod: m, variant: '@napi-rs/canvas' };
      } catch {}
      try {
        const m = await import('canvas');
        const createCanvas = m.createCanvas || (m.default && m.default.createCanvas);
        if (createCanvas) return { mod: m, variant: 'canvas' };
      } catch {}
      return { mod: null, variant: null };
    }
    // -----------------------------------------------------------------------------

    const { mod: pdfjsLib } = await loadPdfjs();
    const { mod: canvasMod } = await loadCanvas();

    // If deps arenâ€™t available, fail fast (keeps UI snappy, no errors)
    if (!pdfjsLib || !canvasMod) {
      console.warn('secure-slide: missing pdfjs or canvas; returning 204');
      return res.status(204).end();
    }

    const createCanvas =
      canvasMod.createCanvas ||
      (canvasMod.default && canvasMod.default.createCanvas);
    if (!createCanvas) return res.status(204).end();

    // Render the requested page to PNG
    const loadingTask = pdfjsLib.getDocument({
  data: new Uint8Array(pdfBuffer),
  disableWorker: true,
  isEvalSupported: false
});
    const pdf = await loadingTask.promise;
    const pageIndex = Math.min(pageNumber, pdf.numPages);
    const page = await pdf.getPage(pageIndex);

    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');

    await page.render({ canvasContext: ctx, viewport }).promise;

    const buf = canvas.toBuffer('image/png');
    
    // Cache the generated thumbnail
    try {
      THUMBNAIL_CACHE.set(cacheKey, buf);
      await fsp.writeFile(diskCachePath, buf);
    } catch (cacheError) {
      console.warn('Failed to cache thumbnail:', cacheError.message);
    }
    
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600, immutable');
    return res.end(buf);
  } catch (err) {
    console.error('secure-slide error:', err?.message || err);
    return res.status(204).end();
  }
}); // <-- keep this exact closing line
// ---------------------------------------------------------------------------

// Health endpoint for slide deps

app.get('/secure-slide/health', async (req, res) => {
  const out = { ok: true, pdfjs: false, canvas: false, variant: { pdfjs: null, canvas: null } };
  try { const { mod, variant } = await __loadPdfjsFlexible(); out.pdfjs = !!mod; out.variant.pdfjs = variant; } catch {}
  try { const { mod, variant } = await __loadCanvasFlexible(); out.canvas = !!mod; out.variant.canvas = variant; } catch {}
  res.json(out);
});

app.listen(config.server.port, async ()=>{
    logger.info(`Jaice server running on port ${config.server.port}`);
    logger.info(`Secure cookies: ${config.server.secureCookies}`);
    logger.info(`AI Model: ${config.ai.answerModel}`);
    logger.info(`Embedding Model: ${config.ai.embeddingModel}`);
    logger.info(`Auto-ingest on start: ${config.autoIngest.onStart}`);
    
    if (config.autoIngest.syncIntervalMs > 0) {
      const intervalHours = Math.round(config.autoIngest.syncIntervalMs / 3600000 * 10) / 10;
      logger.info(`Recurring sync: Every ${intervalHours} hours`);
    } else {
      logger.warn(`Recurring sync: DISABLED`);
    }
    
    // Initialize Google Drive authentication
    try {
      await initializeGoogleAuth();
    } catch (error) {
      logger.error('Failed to initialize Google Drive authentication:', error);
    }
    
    // Initialize auto-sync
    await initializeAutoSync();
  });

  // Add cleanup function for temp files on server shutdown
  process.on('SIGINT', () => {
    try {
      rmSync(TEMP_DIR, { recursive: true, force: true });
      console.log('Cleaned up temporary files');
    } catch (error) {
      console.warn('Failed to cleanup temp directory:', error.message);
    }
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    try {
      rmSync(TEMP_DIR, { recursive: true, force: true });
      console.log('Cleaned up temporary files');
    } catch (error) {
      console.warn('Failed to cleanup temp directory:', error.message);
    }
    process.exit(0);
  });
}

// (idempotent) text signature endpoint - appended safely
try {
  const __existing = app._router && app._router.stack && app._router.stack.find(s => s.route && s.route.path === '/secure-slide/text/:fileId/:page');
  if (!__existing) {
    app.get('/secure-slide/text/:fileId/:page', async (req, res) => {
      const fileId = req.params.fileId;
      const pageNumber = Math.max(1, parseInt(req.params.page, 10) || 1);
      try {
        const buffer = await __downloadDriveFile(fileId);
        const { mod } = await __loadPdfjsFlexible();
        const pdfjsLib = (mod && (mod.getDocument || mod.GlobalWorkerOptions)) ? mod : (mod && mod.default ? mod.default : null);
        if (!pdfjsLib || !pdfjsLib.getDocument) {
          throw new Error('PDF.js library not properly loaded or getDocument not available');
        }
        const task = pdfjsLib.getDocument({ data: new Uint8Array(buffer), disableWorker: true, isEvalSupported: false });
        const doc = await task.promise;
        const clamped = Math.min(doc.numPages, Math.max(1, pageNumber));
        const page = await doc.getPage(clamped);
        const content = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
        const text = (content.items || []).map(i => (i && i.str) ? i.str : '').join(' ').replace(/\s+/g, ' ').trim();
        res.setHeader('Cache-Control', 'public, max-age=1800');
        res.status(200).json({
          ok: true,
          page: clamped,
          length: text.length,
          hasDigits: /\d/.test(text),
          hasPercent: /%/.test(text),
          snippet: text.slice(0, 600)
        });
      } catch (err) {
        console.error('secure-slide text error (appended):', fileId, pageNumber, err);
        res.status(200).json({ ok: false, error: String(err) });
      }
    });
  }
} catch(_){}

// TEST-MARKER-JAICE

// == JAICE helper datastore ==
const JAICE_DATA_DIR = path.resolve(process.cwd(), 'data');
const JAICE_DATA_PATHS = {
  searchLogs: path.join(JAICE_DATA_DIR, 'search-logs.json'),
  searchRecos: path.join(JAICE_DATA_DIR, 'search-recos.json'),
  feedback: path.join(JAICE_DATA_DIR, 'feedback.json'),
  admins: path.join(JAICE_DATA_DIR, 'admins.json'),
  clients: path.join(JAICE_DATA_DIR, 'clients.json'),
  historyDir: path.join(JAICE_DATA_DIR, 'history'),
  layoutDir: path.join(JAICE_DATA_DIR, 'layout'),
  reportMetaDir: path.join(JAICE_DATA_DIR, 'report-metadata')
};
for (const p of [JAICE_DATA_DIR, JAICE_DATA_PATHS.historyDir, JAICE_DATA_PATHS.layoutDir, JAICE_DATA_PATHS.reportMetaDir]) { try { fs.mkdirSync(p, { recursive: true }); } catch {} }
async function JAICE_readJSON(p, fallback){ try{ const b=await fsp.readFile(p,'utf-8'); return JSON.parse(b||'null') ?? fallback; } catch { return fallback; } }
async function JAICE_writeJSON(p, obj){ const tmp=p+'.tmp'; await fsp.writeFile(tmp, JSON.stringify(obj, null, 2)); await fsp.rename(tmp, p); }
function JAICE_uid(){ return 'id_'+Math.random().toString(36).slice(2)+Date.now().toString(36); }

// == /report-metadata/:fileId ==
app.get('/report-metadata/:fileId', async (req, res) => {
  try {
    const { default: pdfParse } = await import('pdf-parse');
    const fileId = String(req.params.fileId||'').trim();
    if (!fileId) return res.status(400).json({ ok:false, error:'fileId required' });
    const cachePath = path.join(JAICE_DATA_PATHS.reportMetaDir, fileId + '.json');
    const cached = await JAICE_readJSON(cachePath, null);
    if (cached) return res.json({ ok:true, cached:true, ...cached });

    const localCandidates = [ path.resolve(process.cwd(), 'temp', fileId + '.pdf'), path.resolve(process.cwd(), 'temp', fileId) ];
    let buf = null;
    for (const p of localCandidates) { try { buf = await fsp.readFile(p); if (buf) break; } catch {} }
    if (!buf) return res.status(404).json({ ok:false, error:'PDF not found locally for parsing' });

    const parsed = await pdfParse(buf);
    const text = String(parsed.text||'').replace(/\r/g,'\n');
    function sectionAfter(label, limit){ const re = new RegExp(label+"\s*[:\n]+([\\s\\S]{0,"+limit+"})","i"); const m = re.exec(text); return m ? m[1] : ''; }
    const objectivesRaw = sectionAfter('Objectives?', 800);
    const objectives = objectivesRaw ? objectivesRaw.split(/\n|•|-\s/).map(s=>s.trim()).filter(Boolean) : [];
    const sample = sectionAfter('Sample', 500).trim();
    const fieldworkRaw = sectionAfter('Fieldwork(?:\s*Dates?)?', 200);
    const dates = Array.from(fieldworkRaw.matchAll(/(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/g)).map(m=>m[1]);
    function norm(d){ if(!d) return null; const [m,dn,y0]=d.split(/[\/-]/).map(n=>parseInt(n,10)); const y=y0<100?y0+2000:y0; return String(m).padStart(2,'0')+'/'+String(dn).padStart(2,'0')+'/'+String(y); }
    const meta = { objectives, sample, fieldwork: { start: norm(dates[0]||null), end: norm(dates[1]||null) }, pageHits: {} };
    await JAICE_writeJSON(cachePath, meta);
    res.json({ ok:true, cached:false, ...meta });
  } catch (err) { res.status(500).json({ ok:false, error:String(err) }); }
});

// == history endpoints ==
app.post('/history/save', async (req, res) => {
  try {
    const { userId, clientLibraryId, query, resultsJSON, timestamp } = req.body || {};
    if (!userId || !clientLibraryId || !resultsJSON) return res.status(400).json({ ok:false, error:'missing fields' });
    const id = JAICE_uid();
    const file = path.join(JAICE_DATA_PATHS.historyDir, `${userId}.${clientLibraryId}.json`);
    const list = await JAICE_readJSON(file, []);
    const item = { id, userId, clientLibraryId, query: String(query||''), resultsJSON, timestamp: timestamp||Date.now() };
    const updated = [item, ...list].slice(0, 10);
    await JAICE_writeJSON(file, updated);
    res.json({ ok:true, id });
  } catch (err) { res.status(500).json({ ok:false, error:String(err) }); }
});
app.get('/history/list', async (req, res) => {
  try {
    const userId = String(req.query.userId||'').trim();
    const clientLibraryId = String(req.query.clientLibraryId||'').trim();
    if (!userId || !clientLibraryId) return res.status(400).json({ ok:false, error:'missing ids' });
    const file = path.join(JAICE_DATA_PATHS.historyDir, `${userId}.${clientLibraryId}.json`);
    const list = await JAICE_readJSON(file, []);
    res.json({ ok:true, items:list });
  } catch (err) { res.status(500).json({ ok:false, error:String(err) }); }
});
app.get('/history/get/:id', async (req, res) => {
  try {
    const id = String(req.params.id||'').trim();
    const userId = String(req.query.userId||'').trim();
    const clientLibraryId = String(req.query.clientLibraryId||'').trim();
    const file = path.join(JAICE_DATA_PATHS.historyDir, `${userId}.${clientLibraryId}.json`);
    const list = await JAICE_readJSON(file, []);
    const found = list.find(x => x.id===id);
    if (!found) return res.status(404).json({ ok:false, error:'not found' });
    res.json({ ok:true, item: found });
  } catch (err) { res.status(500).json({ ok:false, error:String(err) }); }
});

// == feedback endpoints ==
app.post('/feedback', async (req, res) => {
  try {
    const { type, title, description, userId, clientLibraryId } = req.body || {};
    if (!type || !title) return res.status(400).json({ ok:false, error:'missing fields' });
    const list = await JAICE_readJSON(JAICE_DATA_PATHS.feedback, []);
    const item = { id: JAICE_uid(), type, title, description: String(description||''), status:'open', userId:userId||null, clientLibraryId:clientLibraryId||null, createdAt: Date.now() };
    list.unshift(item);
    await JAICE_writeJSON(JAICE_DATA_PATHS.feedback, list);
    res.json({ ok:true, item });
  } catch (err) { res.status(500).json({ ok:false, error:String(err) }); }
});
app.patch('/feedback/:id', async (req, res) => {
  try {
    const id = String(req.params.id||'').trim();
    const status = String(req.body.status||'').trim();
    const list = await JAICE_readJSON(JAICE_DATA_PATHS.feedback, []);
    const i = list.findIndex(x=>x.id===id);
    if (i<0) return res.status(404).json({ ok:false, error:'not found' });
    list[i].status = status;
    await JAICE_writeJSON(JAICE_DATA_PATHS.feedback, list);
    res.json({ ok:true, item:list[i] });
  } catch (err) { res.status(500).json({ ok:false, error:String(err) }); }
});
app.get('/feedback', async (req, res) => {
  try { const status = String(req.query.status||'').trim(); const list = await JAICE_readJSON(JAICE_DATA_PATHS.feedback, []); const filtered = status ? list.filter(x=>x.status===status) : list; res.json({ ok:true, items: filtered }); }
  catch (err) { res.status(500).json({ ok:false, error:String(err) }); }
});

// == search recommendations ==
const JAICE_NINETY_DAYS = 1000*60*60*24*90;
async function JAICE_rebuildRecos(){
  const logs = await JAICE_readJSON(JAICE_DATA_PATHS.searchLogs, []);
  const cutoff = Date.now() - JAICE_NINETY_DAYS;
  const recent = logs.filter(x => (x.timestamp||0) >= cutoff);
  const byLib = new Map();
  for (const r of recent) { const k=String(r.clientLibraryId||'default'); if(!byLib.has(k)) byLib.set(k, []); byLib.get(k).push(String(r.query||'').trim()); }
  const recos = {};
  for (const [lib, arr] of byLib.entries()) { const counts=new Map(); for (const q of arr){ if(!q) continue; counts.set(q,(counts.get(q)||0)+1); } const top=Array.from(counts.entries()).sort((a,b)=>b[1]-a[1]).slice(0,5).map(x=>x[0]); recos[lib]=top; }
  await JAICE_writeJSON(JAICE_DATA_PATHS.searchRecos, recos);
  await JAICE_writeJSON(JAICE_DATA_PATHS.searchRecos+'.last.json', { rebuiltAt: Date.now() });
  return recos;
}
async function JAICE_getRecos(libId){ const lastMeta = await JAICE_readJSON(JAICE_DATA_PATHS.searchRecos+'.last.json', null); if(!lastMeta || (Date.now()-lastMeta.rebuiltAt)>(1000*60*60*24)){ return await JAICE_rebuildRecos(); } return await JAICE_readJSON(JAICE_DATA_PATHS.searchRecos, {}); }
app.get('/recos/:clientLibraryId', async (req, res) => { try{ const lib=String(req.params.clientLibraryId||'default'); const recos=await JAICE_getRecos(lib); res.json({ ok:true, items: recos[lib]||[] }); } catch (err){ res.status(500).json({ ok:false, error:String(err) }); } });
app.post('/search-log', async (req, res) => { try{ const { userId, clientLibraryId, query } = req.body||{}; if(!clientLibraryId) return res.status(400).json({ ok:false, error:'missing clientLibraryId' }); const logs=await JAICE_readJSON(JAICE_DATA_PATHS.searchLogs, []); logs.push({ userId:userId||null, clientLibraryId, query:String(query||'').trim(), timestamp:Date.now() }); await JAICE_writeJSON(JAICE_DATA_PATHS.searchLogs, logs); res.json({ ok:true }); } catch (err){ res.status(500).json({ ok:false, error:String(err) }); } });

// == simple admin/client JSON persistence ==
app.get('/api/admins', requireAuth, async (req, res) => {
  try {
    const list = await JAICE_readJSON(JAICE_DATA_PATHS.admins, []);
    res.json(list);
  } catch (err) {
    res.status(500).json({ ok:false, error:String(err) });
  }
});
app.post('/api/admins', requireAuth, async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ ok:false, error:'Admin only' });
    const body = req.body || {};
    const list = await JAICE_readJSON(JAICE_DATA_PATHS.admins, []);
    const item = {
      id: body.id || ('adm_' + Date.now().toString(36)),
      username: body.username || body.email || '',
      email: body.email || '',
      createdAt: Date.now()
    };
    list.push(item);
    await JAICE_writeJSON(JAICE_DATA_PATHS.admins, list);
    res.json({ ok:true, item });
  } catch (err) {
    res.status(500).json({ ok:false, error:String(err) });
  }
});
app.get('/api/clients', requireAuth, async (req, res) => {
  try {
    const list = await JAICE_readJSON(JAICE_DATA_PATHS.clients, []);
    res.json(list);
  } catch (err) {
    res.status(500).json({ ok:false, error:String(err) });
  }
});
app.post('/api/clients', requireAuth, async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ ok:false, error:'Admin only' });
    const body = req.body || {};
    const list = await JAICE_readJSON(JAICE_DATA_PATHS.clients, []);
    const item = {
      id: body.id || ('cli_' + Date.now().toString(36)),
      name: body.name || body.clientName || '',
      createdAt: Date.now()
    };
    list.push(item);
    await JAICE_writeJSON(JAICE_DATA_PATHS.clients, list);
    res.json({ ok:true, item });
  } catch (err) {
    res.status(500).json({ ok:false, error:String(err) });
  }
});

// ===== Reports API (ESM) — BEGIN (idempotent) =====
if (!globalThis.__REPORTS_API_INSTALLED__) {
  globalThis.__REPORTS_API_INSTALLED__ = true;

  const REPORTS_DB_PATH = path.join(process.cwd(), 'data', 'reports.json');

  function ensureReportsDB(){
    const dir = path.dirname(REPORTS_DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(REPORTS_DB_PATH)) fs.writeFileSync(REPORTS_DB_PATH, JSON.stringify({ version:1, reports: [] }, null, 2));
  }
  function readReports(){
    ensureReportsDB();
    try{ return JSON.parse(fs.readFileSync(REPORTS_DB_PATH, 'utf8')); }
    catch{ return { version:1, reports: [] }; }
  }
  function writeReports(db){
    ensureReportsDB();
    fs.writeFileSync(REPORTS_DB_PATH, JSON.stringify(db, null, 2));
  }
  function getUserKey(req){
    const u = req.session && (req.session.user || {});
    return u.username || u.id || req.session?.username || 'anonymous';
  }
  const now = () => Date.now();
  const uid = () => Math.random().toString(36).slice(2) + now().toString(36);

  app.get('/api/reports', (req, res) => {
    try{
      const userKey = getUserKey(req);
      const db = readReports();
      const list = db.reports.filter(r => r.ownerKey === userKey);
      list.sort((a,b)=>(b.updatedAt||b.createdAt||0)-(a.updatedAt||a.createdAt||0));
      res.json({ ok:true, data:list });
    }catch(e){ res.status(500).json({ ok:false, error:'Failed to load reports' }); }
  });

  app.post('/api/reports', (req, res) => {
    try{
      const { title, description='' } = req.body || {};
      const t = (title||'').trim();
      if (!t) return res.status(400).json({ ok:false, error:'Title is required' });
      const userKey = getUserKey(req);
      const db = readReports();
      const doc = { id: uid(), ownerKey:userKey, title:t, description:String(description||''), items:[], createdAt: now(), updatedAt: now() };
      db.reports.push(doc); writeReports(db);
      res.json({ ok:true, data: doc });
    }catch(e){ res.status(500).json({ ok:false, error:'Failed to create report' }); }
  })
  app.delete('/api/reports/:id', (req, res) => {
    try{
      const userKey = getUserKey(req);
      const db = readReports();
      const idx = db.reports.findIndex(x => x.id === req.params.id && x.ownerKey === userKey);
      if (idx === -1) return res.status(404).json({ ok:false, error:'Not found' });
      db.reports.splice(idx, 1);
      writeReports(db);
      res.json({ ok:true });
    }catch(e){ res.status(500).json({ ok:false, error:'Failed to delete report' }); }
  });
;

  app.get('/api/reports/:id', (req, res) => {
    try{
      const userKey = getUserKey(req);
      const db = readReports();
      const r = db.reports.find(x => x.id === req.params.id && x.ownerKey === userKey);
      if (!r) return res.status(404).json({ ok:false, error:'Not found' });
      res.json({ ok:true, data: r });
    }catch(e){ res.status(500).json({ ok:false, error:'Failed' }); }
  });

  app.post('/api/reports/:id/items', (req, res) => {
    try{
      const userKey = getUserKey(req);
      const db = readReports();
      const r = db.reports.find(x => x.id === req.params.id && x.ownerKey === userKey);
      if (!r) return res.status(404).json({ ok:false, error:'Not found' });
      const item = req.body || {};
      item.id = item.id || uid();
      item.title = String(item.title || 'Untitled Item');
      item.html = String(item.html || '');
      item.createdAt = item.createdAt || now();
      r.items.push(item); r.updatedAt = now(); writeReports(db);
      res.json({ ok:true, data:item });
    }catch(e){ res.status(500).json({ ok:false, error:'Failed to add item' }); }
  });

  app.delete('/api/reports/:id/items/:itemId', (req, res) => {
    try{
      const userKey = getUserKey(req);
      const db = readReports();
      const r = db.reports.find(x => x.id === req.params.id && x.ownerKey === userKey);
      if (!r) return res.status(404).json({ ok:false, error:'Not found' });
      const before = r.items.length;
      r.items = r.items.filter(it => it.id !== req.params.itemId);
      if (r.items.length !== before) r.updatedAt = now();
      writeReports(db); res.json({ ok:true, data:true });
    }catch(e){ res.status(500).json({ ok:false, error:'Failed to delete item' }); }
  });
}
// ===== Reports API — END =====