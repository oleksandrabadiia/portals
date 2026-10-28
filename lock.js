/* © 2026 Ara Badiia. All rights reserved. Not to be copied, shared or reused without permission. */
/* Portals lock screen.
   Asks for a password before showing the app. Once the right password is typed,
   this browser remembers it, so you only type it once per computer.
   The password itself isn't stored here, only a scrambled version of it (a "hash").
   To change the password, ask Claude for a new HASH line. */
(function () {
  const HASH = '960fe7a66c91fa7aa53a8a14da2f51817e1483a9cd9c4f386de62d3fb75a66d7';
  const KEY = 'pandora.unlocked';

  let ok = false;
  try { ok = localStorage.getItem(KEY) === HASH; } catch (e) {}
  if (ok) return;

  // Hide the app until the password is right
  const hide = document.createElement('style');
  hide.id = 'pandora-lock-hide';
  hide.textContent = 'body > *:not(#pandora-lock){visibility:hidden!important}';
  document.head.appendChild(hide);

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function build() {
    const wrap = document.createElement('div');
    wrap.id = 'pandora-lock';
    wrap.innerHTML = `
      <style>
        #pandora-lock{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;
          background:#0e0e10;color:#f2f2f2;font:15px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}
        #pandora-lock form{width:min(340px,calc(100vw - 32px));display:grid;gap:12px;text-align:center}
        #pandora-lock h1{margin:0 0 4px;font-size:22px;font-weight:600;letter-spacing:.02em}
        #pandora-lock p{margin:0;color:#9a9aa2;font-size:14px}
        #pandora-lock input{padding:12px 14px;border-radius:10px;border:1px solid #33333a;
          background:#18181c;color:inherit;font:inherit;outline:none}
        #pandora-lock input:focus{border-color:#8a7cff}
        #pandora-lock button{padding:12px;border:0;border-radius:10px;background:#8a7cff;color:#fff;
          font:inherit;font-weight:600;cursor:pointer}
        #pandora-lock .err{color:#ff7a7a;min-height:1.2em;font-size:13px}
      </style>
      <form autocomplete="off">
        <h1>Portals</h1>
        <p>Enter the password to continue.</p>
        <input type="password" placeholder="Password" aria-label="Password" autofocus>
        <button type="submit">Unlock</button>
        <div class="err" role="alert"></div>
      </form>`;
    document.body.appendChild(wrap);
    const input = wrap.querySelector('input'), err = wrap.querySelector('.err');
    input.focus();
    wrap.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      const h = await sha256(input.value.trim());
      if (h === HASH) {
        try { localStorage.setItem(KEY, HASH); } catch (e) {}
        wrap.remove();
        const s = document.getElementById('pandora-lock-hide'); if (s) s.remove();
      } else {
        err.textContent = 'That’s not the right password.';
        input.value = ''; input.focus();
      }
    });
  }

  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
