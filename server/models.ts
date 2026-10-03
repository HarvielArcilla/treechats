/* What each model accepts, and what it costs. Newer models (Opus 4.7 and later, Sonnet 5 and later, Fable, Mythos)
   reject a non-default temperature and use adaptive thinking with an effort level; older ones take a temperature and a
   thinking budget. Source: https://platform.claude.com/docs/en/build-with-claude/thinking and .../effort. */

export type Caps = { temperature: boolean; effort: boolean; thinking: 'adaptive' | 'budget' };

function parse(model: string) {
  const m = model.match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-|$)/);
  if (!m) return null;
  return { family: m[1], v: Number(m[2]) + (m[3] ? Number(m[3]) / 10 : 0) };
}

export function caps(model: string): Caps {
  const p = parse(model);
  if (!p) return { temperature: false, effort: true, thinking: 'adaptive' }; /* unknown: assume the newest behaviour */
  const top = p.family === 'fable' || p.family === 'mythos';
  const newSampling = top || (p.family === 'opus' && p.v >= 4.7) || (p.family === 'sonnet' && p.v >= 5);
  const effort = top || (p.family === 'opus' && p.v >= 4.5) || (p.family === 'sonnet' && p.v >= 4.6);
  const adaptive = top || ((p.family === 'opus' || p.family === 'sonnet') && p.v >= 4.6);
  return { temperature: !newSampling, effort, thinking: adaptive ? 'adaptive' : 'budget' };
}

/* US dollars per million tokens: input, output, cache write (5 minutes), cache read.
   Source: https://platform.claude.com/docs/en/about-claude/pricing. TREECHATS_PRICE_<TIER> overrides (four numbers). */
const PRICES: [RegExp, [number, number, number, number]][] = [
  [/^claude-(fable|mythos)-5-1/, [10, 50, 12.5, 0.25]],
  [/^claude-(fable|mythos)-5/, [10, 50, 12.5, 1]],
  [/^claude-opus-5-5/, [4, 20, 5, 0.2]],
  [/^claude-opus-(5|4-8|4-7|4-6|4-5)/, [5, 25, 6.25, 0.5]],
  [/^claude-sonnet-(5|4)/, [2, 10, 2.5, 0.2]],
  [/^claude-haiku-4-5/, [1, 5, 1.25, 0.1]],
];
export function prices(model: string, override?: string): [number, number, number, number] | null {
  if (override) { const n = override.split(',').map(Number); if (n.length === 4 && n.every((x) => Number.isFinite(x) && x >= 0)) return n as [number, number, number, number]; }
  return PRICES.find(([re]) => re.test(model))?.[1] ?? null;
}

export type Usage = { input: number; output: number; cacheWrite: number; cacheRead: number; cost?: number; via?: string };
export function costOf(u: Usage, p: [number, number, number, number] | null): number | undefined {
  if (!p) return undefined;
  return (u.input * p[0] + u.output * p[1] + u.cacheWrite * p[2] + u.cacheRead * p[3]) / 1e6;
}
