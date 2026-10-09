/* The page's state: the tree on screen (S), the selection, your settings (opts), Claude's connection, and the code
   shared with the server (Core, Ops). */

const IS_MAC=/Mac|iPhone|iPad/.test(navigator.platform||navigator.userAgent);
const sendKbd = () => opts.sendKey==='mod' ? (IS_MAC?'⌘↵':'Ctrl ↵') : '↵';
const sendNote = () => opts.sendKey==='mod' ? `${IS_MAC?'⌘':'Ctrl'}+Enter sends. Enter adds a new line.` : 'Enter sends. Shift+Enter adds a new line.';
let S, sel = null, pick = null, composeFor = null, renaming = false, undoStack = [], redoStack = [];
let opts = {simple:true, summary:true, cow:false, rerootBy:'template', squashBy:'join', replies:'selected', model:'quick', prompts:{}, open:{ops:true}, collapsed:{spaces:false, convs:false}};
let sampleFn = null, sampleState = 'loading'; const genNotes = {};
const TIERS = (window.TREECHATS_LOCAL && window.TREECHATS_LOCAL.tiers) || [['quick','Quick (fastest, lightest)'],['default','Default'],['complex','Complex (most capable)']];
const openReplies = new Set(), fullReplies = new Set();
let editingNow = false;
/* Sent ahead of the turns a merge brings in, so the model reads the join as a separate thread. */
/* the tree and the context a prompt sends are built by treecore.js, shared with the server */
const Core = TreechatsCore;
/* tree helpers and the ✦ tools agents can use too, shared with the server (treeops.js) */
const Ops = TreechatsOps;
const SEAM = Core.DEFAULTS.seam;
