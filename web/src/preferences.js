/* Settings and their defaults, per light and dark mode where they differ. */

/* ---- Settings ----
   Personalization changes how the app looks; System changes how it behaves. Both live in opts, so they
   save with everything else and carry over to a locally served build unchanged. */
const NEUTRAL_KEYS=['bg','surface','fg','muted','line','side','panel','reply-bg','code-bg'];
const PALETTES={
  sage:{name:'Sage', light:['#EDF0ED','#FAFBF9','#18201D','#5A6761','#CDD6D1','#E2E8E3','#E8EDE9','#F1EEE6','#E6E9E5'],
                    dark:['#101513','#171E1B','#E3E9E5','#93A19A','#2B3732','#0B100E','#0E1311','#1E1C17','#0E1311']},
  paper:{name:'Paper', light:['#F2EEE6','#FCFAF6','#221E18','#6B6358','#DDD5C7','#E8E2D6','#EDE8DE','#F4EEE1','#E9E3D7'],
                      dark:['#16130F','#1F1B16','#ECE5DA','#A69C8D','#3B342B','#100E0B','#13110D','#251F17','#110F0C']},
  slate:{name:'Slate', light:['#ECEFF3','#FAFBFC','#161B22','#5A6472','#CDD4DD','#E1E6EC','#E7EBF0','#EEF1F5','#E3E7EC'],
                      dark:['#0F1216','#161B21','#E1E6EC','#8E99A7','#29313B','#0A0D10','#0D1014','#1A1F26','#0C0F13']},
  ink:{name:'Ink', light:['#F1F1F1','#FFFFFF','#0A0A0A','#4A4A4A','#C2C2C2','#E6E6E6','#EBEBEB','#F5F5F5','#E8E8E8'],
                  dark:['#0A0A0A','#141414','#F3F3F3','#A8A8A8','#333333','#060606','#0D0D0D','#1A1A1A','#090909']},
  fjord:{name:'Fjord', light:['#E9EEF4','#F8FAFC','#1B2430','#556274','#C9D3DF','#DCE4EE','#E3E9F1','#EEF2F8','#E1E7EF'],
                      dark:['#1E2430','#252C3A','#E5EAF2','#97A3B6','#364052','#181D27','#1B212C','#2A3242','#1A202A']},
  ocean:{name:'Ocean', light:['#E6F0EF','#F8FBFB','#12211F','#4D6662','#C3D7D4','#D8E7E5','#DFEBE9','#EBF4F3','#DCE9E7'],
                      dark:['#0D1818','#132121','#DDEBE9','#8DA8A4','#253939','#091313','#0B1515','#172828','#0A1414']},
  dusk:{name:'Dusk', light:['#EEEBF4','#FBFAFD','#1F1A2B','#625A74','#D5CFE1','#E4DFEE','#E9E5F1','#F2EFF8','#E6E1EF'],
                    dark:['#16131E','#1E1A29','#E8E4F1','#A39CB5','#352F45','#110E18','#14111C','#241F31','#13101A']},
  rose:{name:'Rose', light:['#F4ECEE','#FDFAFA','#2A1A1F','#74585F','#E2D0D4','#EEE0E3','#F1E6E8','#F8EFF1','#EFE3E6'],
                    dark:['#1B1214','#24191C','#F0E4E7','#B59CA2','#423036','#150E10','#181012','#2B1E22','#160E11']}
};
const ACCENTS={
  blue:{name:'Blue', light:'#2350D8', dark:'#7C9BFF'},
  green:{name:'Green', light:'#0B7A58', dark:'#4CC9A2'},
  violet:{name:'Violet', light:'#6B3FC9', dark:'#B59DF2'},
  rose:{name:'Rose', light:'#BE2F5B', dark:'#F27A9C'},
  graphite:{name:'Graphite', light:'#3A4540', dark:'#C9D2CD'}
};
const TEXT_SIZES={small:['Small',15], default:['Default',16], large:['Large',17.5], xl:['Larger',19]};
const FONTS={plex:['Treechats', null], system:['System', '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif']};
const SET_DEFAULTS={aiReview:'send', replyLen:'short', nameBranches:true, nameConvs:false, nameSpaces:false, map:true, theme:'system', palette:'sage', accent:'blue', textSize:'default', ctxMarks:true, branchSettings:false, allowCommands:false, replyBox:'theme', replyBoxChat:'theme', font:'plex', density:'comfortable', motion:'system', sendKey:'enter', opKeys:true};
/* Palette, accent and reply colors are chosen for light and dark mode separately, stored as "palette@dark" and so on;
   a mode with no choice of its own uses the plain setting (all there was before), then the default */
const PER_MODE=['palette','accent','replyBox','replyBoxChat'];
const mget = (k, m) => { const v=opts[k+'@'+m]; return v!=null ? v : opts[k]!=null ? opts[k] : SET_DEFAULTS[k]; };
const set = k => PER_MODE.includes(k) ? mget(k, shownMode()) : opts[k]!=null ? opts[k] : SET_DEFAULTS[k];
/* sets a per-mode choice for one mode, or for both */
function mput(k, v, m){ for(const x of m ? [m] : ['light','dark']){ opts[k+'@'+x]=v; } }
const darkMQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : {matches:false};
const resolvedMode = () => set('theme')==='system' ? (darkMQ.matches?'dark':'light') : set('theme');
