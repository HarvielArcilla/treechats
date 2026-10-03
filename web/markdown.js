/* Renders Claude's replies: Markdown (GitHub style, with tables), math written in TeX ($…$, $$…$$, \(…\), \[…\])
   and code blocks with syntax colors and a Copy button. Everything is bundled, so it works offline.

   The app's main script loads first and calls window.TreechatsMarkdown.render once this has loaded; until then it
   uses its own small renderer, and it redraws when the 'treechats-markdown' event fires. */
import { Marked } from 'marked';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import hljs from 'highlight.js/lib/common';
import dockerfileLang from 'highlight.js/lib/languages/dockerfile';
import scalaLang from 'highlight.js/lib/languages/scala';
import dartLang from 'highlight.js/lib/languages/dart';
import elixirLang from 'highlight.js/lib/languages/elixir';
import haskellLang from 'highlight.js/lib/languages/haskell';
import powershellLang from 'highlight.js/lib/languages/powershell';
import protobufLang from 'highlight.js/lib/languages/protobuf';
import groovyLang from 'highlight.js/lib/languages/groovy';
import gradleLang from 'highlight.js/lib/languages/gradle';
import clojureLang from 'highlight.js/lib/languages/clojure';
import erlangLang from 'highlight.js/lib/languages/erlang';
import ocamlLang from 'highlight.js/lib/languages/ocaml';
import fsharpLang from 'highlight.js/lib/languages/fsharp';
import juliaLang from 'highlight.js/lib/languages/julia';
import nixLang from 'highlight.js/lib/languages/nix';
import latexLang from 'highlight.js/lib/languages/latex';
import nginxLang from 'highlight.js/lib/languages/nginx';
import cmakeLang from 'highlight.js/lib/languages/cmake';
import elmLang from 'highlight.js/lib/languages/elm';
import propertiesLang from 'highlight.js/lib/languages/properties';
import vimLang from 'highlight.js/lib/languages/vim';
import matlabLang from 'highlight.js/lib/languages/matlab';
import fortranLang from 'highlight.js/lib/languages/fortran';
import pgsqlLang from 'highlight.js/lib/languages/pgsql';
import handlebarsLang from 'highlight.js/lib/languages/handlebars';
import twigLang from 'highlight.js/lib/languages/twig';
import apacheLang from 'highlight.js/lib/languages/apache';

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
/* beyond highlight.js's common set (about 35 languages), the others people often have in a repository */
for (const [name, lang] of Object.entries({ dockerfile: dockerfileLang, scala: scalaLang, dart: dartLang, elixir: elixirLang, haskell: haskellLang, powershell: powershellLang, protobuf: protobufLang, groovy: groovyLang, gradle: gradleLang, clojure: clojureLang, erlang: erlangLang, ocaml: ocamlLang, fsharp: fsharpLang, julia: juliaLang, nix: nixLang, latex: latexLang, nginx: nginxLang, cmake: cmakeLang, elm: elmLang, properties: propertiesLang, vim: vimLang, matlab: matlabLang, fortran: fortranLang, pgsql: pgsqlLang, handlebars: handlebarsLang, twig: twigLang, apache: apacheLang })) if (!hljs.getLanguage(name)) hljs.registerLanguage(name, lang);

/* a whole file's text with syntax colors, for the file viewer and editor; the language comes from the file name */
const EXT_LANG = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  py: 'python', pyi: 'python', pyw: 'python', ipynb: 'json', rb: 'ruby', rake: 'ruby', gemspec: 'ruby', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', kts: 'kotlin',
  swift: 'swift', m: 'objectivec', mm: 'objectivec', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp', cs: 'csharp', csx: 'csharp',
  fs: 'fsharp', fsx: 'fsharp', vb: 'vbnet', php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash', ksh: 'bash', env: 'bash', ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
  bat: 'dos', cmd: 'dos', sql: 'sql', psql: 'pgsql', html: 'xml', htm: 'xml', xhtml: 'xml', xml: 'xml', svg: 'xml', plist: 'xml', csproj: 'xml', vue: 'xml', svelte: 'xml', astro: 'xml',
  hbs: 'handlebars', handlebars: 'handlebars', twig: 'twig', css: 'css', scss: 'scss', sass: 'scss', less: 'less', json: 'json', jsonc: 'json', json5: 'json', geojson: 'json',
  yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini', editorconfig: 'ini', properties: 'properties', md: 'markdown', mdx: 'markdown', markdown: 'markdown',
  rst: 'plaintext', txt: 'plaintext', lua: 'lua', r: 'r', pl: 'perl', pm: 'perl', scala: 'scala', sc: 'scala', sbt: 'scala', dart: 'dart', ex: 'elixir', exs: 'elixir',
  erl: 'erlang', hrl: 'erlang', hs: 'haskell', lhs: 'haskell', ml: 'ocaml', mli: 'ocaml', clj: 'clojure', cljs: 'clojure', cljc: 'clojure', edn: 'clojure', elm: 'elm',
  jl: 'julia', nix: 'nix', tex: 'latex', sty: 'latex', proto: 'protobuf', groovy: 'groovy', gradle: 'gradle', graphql: 'graphql', gql: 'graphql', wasm: 'wasm', wat: 'wasm',
  diff: 'diff', patch: 'diff', vim: 'vim', f90: 'fortran', f: 'fortran', mat: 'matlab', cmake: 'cmake', dockerfile: 'dockerfile', containerfile: 'dockerfile', makefile: 'makefile', mk: 'makefile',
};
/* files known by their whole name */
const NAME_LANG = { dockerfile: 'dockerfile', containerfile: 'dockerfile', makefile: 'makefile', gnumakefile: 'makefile', 'cmakelists.txt': 'cmake', gemfile: 'ruby', rakefile: 'ruby', podfile: 'ruby', vagrantfile: 'ruby', jenkinsfile: 'groovy', 'nginx.conf': 'nginx', '.htaccess': 'apache', '.bashrc': 'bash', '.zshrc': 'bash', '.profile': 'bash', '.gitignore': 'bash', '.dockerignore': 'bash', '.vimrc': 'vim' };
export function langOf(name) {
  const base = String(name || '').split('/').pop().toLowerCase();
  if (NAME_LANG[base]) return NAME_LANG[base];
  if (/^dockerfile\./.test(base)) return 'dockerfile';
  if (/^\.env(\.|$)/.test(base)) return 'bash';
  const ext = base.includes('.') ? base.split('.').pop() : '';
  return EXT_LANG[ext] || null;
}
function highlightFile(text, name) {
  if (text.length > 200000) return esc(text);
  const lang = langOf(name);
  try {
    if (lang && hljs.getLanguage(lang)) return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
    /* no known extension: guess, for short files only, where a guess is quick and usually right */
    if (!lang && text.length < 20000) { const g = hljs.highlightAuto(text); if (g.relevance >= 6) return g.value; }
    return esc(text);
  } catch { return esc(text); }
}
const langName = (name) => { const l = langOf(name); return l && hljs.getLanguage(l) ? hljs.getLanguage(l).name : null; };

window.TreechatsMarkdown = { render, highlightFile, langName };
window.dispatchEvent(new Event('treechats-markdown'));
