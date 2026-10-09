/* The first lines the page runs: whether to draw off-screen chats lazily, and stopping here while Treechats waits
   for you to sign in or unlock it (local-shim.js shows that screen). */

/* lazy drawing of off-screen chats, where the browser keeps the page still as they're drawn (see html.lazy) */
const IS_SAFARI=/^((?!chrome|chromium|crios|edg|android|fxios).)*safari/i.test(navigator.userAgent);
if(window.CSS && CSS.supports('overflow-anchor','auto') && !IS_SAFARI) document.documentElement.classList.add('lazy');
/* not signed in yet, or locked: the sign-in screen (local-shim.js) shows instead, and the app waits for a reload */
if(window.TREECHATS_GATE) throw new Error('Treechats is waiting for you to sign in or unlock it.');
