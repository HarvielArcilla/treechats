/* Renders Claude's replies: Markdown (GitHub style, with tables), math written in TeX ($…$, $$…$$, \(…\), \[…\])
   and code blocks with syntax colors and a Copy button. Everything is bundled, so it works offline.

   The app's main script loads first and calls window.TreechatsMarkdown.render once this has loaded; until then it
   uses its own small renderer, and it redraws when the 'treechats-markdown' event fires. */
import { Marked } from 'marked';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import hljs from 'highlight.js/lib/common';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function tex(src, display) {
  try {
    return katex.renderToString(src, { displayMode: display, throwOnError: false, strict: 'ignore', trust: false, output: 'htmlAndMathml' });
  } catch {
    return `<code>${esc(src)}</code>`;
  }
}

/* $$…$$ or \[…\] on lines of their own become display math; $…$ and \(…\) are inline. A lone $ next to a number,
   as in "$5 and $10", stays a dollar sign: inline math can't start or end with a space or end right before a digit. */
const mathBlock = {
  name: 'mathBlock',
  level: 'block',
  start: (src) => { const m = src.match(/\$\$|\\\[/); return m ? m.index : undefined; },
  tokenizer(src) {
    const m = /^ {0,3}\$\$([\s\S]+?)\$\$[ \t]*(?:\n|$)/.exec(src) || /^ {0,3}\\\[([\s\S]+?)\\\][ \t]*(?:\n|$)/.exec(src);
    if (m) return { type: 'mathBlock', raw: m[0], text: m[1].trim() };
  },
  renderer: (t) => `<div class="math">${tex(t.text, true)}</div>`,
};
const mathInline = {
  name: 'mathInline',
  level: 'inline',
  start: (src) => { const m = src.match(/\$|\\\(/); return m ? m.index : undefined; },
  tokenizer(src) {
    let m = /^\$\$((?:\\.|[^$\\])+?)\$\$/.exec(src);
    if (m) return { type: 'mathInline', raw: m[0], text: m[1].trim(), display: true };
    m = /^\\\(([\s\S]+?)\\\)/.exec(src);
    if (m) return { type: 'mathInline', raw: m[0], text: m[1].trim() };
    m = /^\$(?![\s$])((?:\\.|[^$\\\n])+?)(?<![\s\\])\$(?!\d)/.exec(src);
    if (m) return { type: 'mathInline', raw: m[0], text: m[1] };
  },
  renderer: (t) => tex(t.text, !!t.display),
};

const safeUrl = (href) => /^(https?:|mailto:)/i.test(href || '') ? href : null;

const marked = new Marked({ gfm: true, breaks: true });
marked.use({
  extensions: [mathBlock, mathInline],
  renderer: {
    code({ text, lang }) {
      const name = (lang || '').trim().split(/\s+/)[0];
      let body;
      try {
        body = name && hljs.getLanguage(name) ? hljs.highlight(text, { language: name, ignoreIllegals: true }).value
          : text.length < 20000 ? hljs.highlightAuto(text).value : esc(text);
      } catch { body = esc(text); }
      return `<div class="codewrap"><div class="codehead"><span class="codelang">${esc(name || 'code')}</span><button class="codecopy" data-copycode type="button">Copy</button></div><pre><code class="hljs">${body}</code></pre></div>`;
    },
    /* replies are shown as text, never as live HTML */
    html({ text }) { return esc(text); },
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens), url = safeUrl(href);
      return url ? `<a href="${esc(url)}"${title ? ` title="${esc(title)}"` : ''} target="_blank" rel="noopener noreferrer">${label}</a>` : label;
    },
    image({ href, text }) {
      const url = safeUrl(href);
      return url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text || 'image')}</a>` : esc(text || '');
    },
    table(token) {
      const cell = (c) => `<${c.header ? 'th' : 'td'}${c.align ? ` style="text-align:${c.align}"` : ''}>${this.parser.parseInline(c.tokens)}</${c.header ? 'th' : 'td'}>`;
      const head = `<tr>${token.header.map(cell).join('')}</tr>`;
      const rows = token.rows.map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('');
      return `<div class="tablewrap"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
    },
  },
});

function render(src) {
  try {
    return marked.parse(String(src || ''));
  } catch {
    return `<p>${esc(src)}</p>`;
  }
}

/* a whole file's text with syntax colors, for the file viewer; the language comes from the file name */
const EXT_LANG = { js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', swift: 'swift', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell', sql: 'sql', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml', css: 'css', scss: 'scss', json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini', md: 'markdown', markdown: 'markdown', lua: 'lua', r: 'r', pl: 'perl', scala: 'scala', dart: 'dart', graphql: 'graphql', gql: 'graphql', dockerfile: 'dockerfile', makefile: 'makefile' };
function highlightFile(text, name) {
  const base = String(name || '').split('/').pop().toLowerCase(), ext = base.includes('.') ? base.split('.').pop() : base;
  const lang = EXT_LANG[ext];
  if (text.length > 200000) return esc(text);
  try { return lang && hljs.getLanguage(lang) ? hljs.highlight(text, { language: lang, ignoreIllegals: true }).value : esc(text); } catch { return esc(text); }
}

window.TreechatsMarkdown = { render, highlightFile };
window.dispatchEvent(new Event('treechats-markdown'));
