// classifier.js
// Simple query classifier to determine plan type and modality signals

export function classify(query, { clientId } = {}) {
  const q = String(query || '').toLowerCase();
  const hasTimeseries = /(trend|over time|last \d+ (years|months)|year over year|yoy|mo[mn])/i.test(query);
  const hasQuant = /(percent|%|n=|share|rate|how many|increase|decrease|compare|table|chart|graph|top|rank)/i.test(query);
  const hasQual = /(why|barrier|drivers?|quote|say|feedback|open[- ]?end|qual)/i.test(query);

  // Coarse plan type
  let type = 'simple';
  if (hasQual || (hasQuant && hasTimeseries) || q.length > 60) type = 'rich';

  // Confidence heuristic
  let confidence = 0.6;
  if (hasQual && hasQuant) confidence += 0.15;
  if (hasTimeseries) confidence += 0.1;
  confidence = Math.max(0.5, Math.min(0.9, confidence));

  return { type, confidence, signals: { hasQuant, hasTimeseries, hasQual } };
}

export default { classify };

