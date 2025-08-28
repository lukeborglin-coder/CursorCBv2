// public/search-tracker.js — v3
// Goals: never break the page if certain endpoints are missing.
// - Intercepts POST /auth/switch-client (no network) and stores selection
// - Gracefully handles GET /api/client-libraries (fallback JSON if missing)
// - Optional fallback for GET /api/reports to cached last results

(function(){
  if (window.__searchTrackerPatchedV3__) return;
  window.__searchTrackerPatchedV3__ = true;

  const realFetch = window.fetch.bind(window);
  const log = (...args) => console.info.apply(console, ["[tracker]", ...args]);

  function parseBody(init){
    const out = {};
    if (!init || !init.body) return out;
    try {
      if (typeof init.body === "string") {
        try { return JSON.parse(init.body); } catch(_){ out.raw = init.body; return out; }
      }
      if (init.body instanceof URLSearchParams) {
        for (const [k,v] of init.body.entries()) out[k]=v;
        return out;
      }
      if (init.body instanceof FormData) {
        for (const [k,v] of init.body.entries()) out[k]=v;
        return out;
      }
    } catch (_){}
    return out;
  }

  function libsFallback(){
    const cid = localStorage.getItem("jaice_client") || "default";
    const cname = localStorage.getItem("jaice_client_name") || "Default";
    return [{ id: cid, name: cname, label: cname }];
  }

  function reportsFallback(){
    try {
      const raw = localStorage.getItem("jaice_last_reports");
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch(_){ return []; }
  }

  window.fetch = async function(input, init){
    const url = (typeof input === "string") ? input : (input && input.url) || "";
    const method = (init && init.method ? String(init.method) : "GET").toUpperCase();

    // 1) Intercept client switch
    if (/\/auth\/switch-client\b/.test(url) && method === "POST") {
      const payload = parseBody(init);
      const cid = payload.client || payload.clientId || payload.library || payload.libraryId || payload.id || null;
      try {
        if (cid) localStorage.setItem("jaice_client", String(cid));
        if (payload && payload.name) localStorage.setItem("jaice_client_name", String(payload.name));
        localStorage.setItem("jaice_client_payload", JSON.stringify(payload || {}));
        window.dispatchEvent(new CustomEvent("jaice:clientSwitched", { detail: { client: cid, payload } }));
      } catch(_){}
      return new Response(JSON.stringify({ ok: true, client: cid }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // 2) Client libraries — try real fetch first, fallback to stub JSON
    if (/\/api\/(client-libraries|clients|libraries)\b/.test(url) && method === "GET") {
      try {
        const res = await realFetch(input, init);
        if (res && res.ok) return res;
        // Non-OK -> fallback
        return new Response(JSON.stringify({ ok: true, data: libsFallback() }), { status: 200, headers: { "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ ok: true, data: libsFallback() }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
    }

    // 3) Reports list — if network fails, return cached
    if (/\/api\/reports\b/.test(url) && method === "GET") {
      try {
        const res = await realFetch(input, init);
        if (res && res.ok) return res;
        const data = reportsFallback();
        return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { "Content-Type": "application/json" } });
      } catch (e) {
        const data = reportsFallback();
        return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
    }

    // Default: pass-through
    return realFetch(input, init);
  };
})();