// /authorize: the consent page. The user proves who they are with their Quest Log sync code
// (the same secret that links devices), then approves Claude's access.
import { AuthorizationError, CimdFetchError } from "@cloudflare/workers-oauth-provider";
import { userExists } from "./db.js";
import { html, userIdForCode } from "./http.js";

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function handleAuthorize(req, env) {
  const oauth = env.OAUTH_PROVIDER;
  try {
    if (req.method === "GET") {
      const request = await oauth.parseAuthRequest(req);
      const details = await oauth.describeConsent(request);
      const consent = await oauth.beginConsent(request);
      consent.headers.set("Content-Type", "text/html; charset=utf-8");
      return new Response(page(details, consent.handle, ""), { headers: consent.headers });
    }

    if (req.method === "POST") {
      const form = await req.formData();
      const handle = String(form.get("handle") || "");
      if (form.get("decision") !== "approve") {
        const denied = await oauth.denyConsent(req, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const code = String(form.get("code") || "").trim();
      const userId = await userIdForCode(code);
      if (!userId || !(await userExists(env.DB, userId))) {
        // The handle is single-use, so send the user back through the flow from the client.
        return html(
          errorPage(
            "That sync code didn't match a Quest Log account. In the app, go to Settings → Show sync code, then start connecting again from Claude.",
          ),
          400,
        );
      }
      const approved = await oauth.approveConsent(req, handle, { scope: form.getAll("scope").map(String) });
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId,
        metadata: { label: "Quest Log" },
        scope: approved.request.scope,
        props: { userId },
      });
      approved.headers.set("Location", redirectTo);
      return new Response(null, { status: 302, headers: approved.headers });
    }
    return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
    if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
      const msg = error instanceof AuthorizationError ? error.description : "This app could not be verified.";
      return html(errorPage(msg || "This sign-in link has expired. Start connecting again from Claude."), 400);
    }
    throw error;
  }
}

const STYLE = `<style>
:root{--bg:#f6f4ef;--card:#fff;--ink:#1d1b18;--muted:#6b665d;--line:#e4dfd4;--accent:#2f6f5e;--warn:#b4472f}
@media (prefers-color-scheme:dark){:root{--bg:#141412;--card:#1e1d1a;--ink:#ece8df;--muted:#a39d91;--line:#33312c;--accent:#6cc3a8;--warn:#ef8a6f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,sans-serif;line-height:1.5}
main{max-width:460px;margin:40px auto;padding:0 16px}.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px}
h1{font-size:1.3rem;margin:0 0 8px}p{margin:0 0 12px}.muted{color:var(--muted);font-size:.9rem}.warn{color:var(--warn)}
label{display:block;font-weight:600;margin:14px 0 6px}input[type=password]{width:100%;padding:11px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink);font:inherit}
ul{margin:6px 0 12px;padding-left:20px}.row{display:flex;gap:8px;margin-top:16px}
button{flex:1;padding:12px;border-radius:10px;border:1px solid var(--line);font:inherit;font-weight:700;cursor:pointer;background:transparent;color:var(--ink)}
button.go{background:var(--accent);border-color:var(--accent);color:var(--bg)}
</style>`;

function page(d, handle, error) {
  const scopes = (d.scope || []).map((s) => `<input type="hidden" name="scope" value="${esc(s)}">`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Quest Log</title>${STYLE}</head><body><main><div class="card">
<h1>Connect ${esc(d.clientName)} to Quest Log?</h1>
<p class="muted">${d.clientDomain ? `Published by <b>${esc(d.clientDomain)}</b>.` : "This app registered itself; its name is not verified."}
Access will be sent to <b>${esc(d.redirectHost)}</b>.</p>
${d.redirectIsLoopback ? `<p class="warn"><b>This sends access to an app on your computer.</b> Continue only if you just started connecting from it.</p>` : ""}
<p>It will be able to:</p>
<ul><li>See your quests, mood check-ins and progress</li><li>Add, update, complete and delete quests</li><li>Log mood check-ins</li></ul>
<form method="post">
<input type="hidden" name="handle" value="${esc(handle)}">${scopes}
<label for="code">Your sync code</label>
<input id="code" name="code" type="password" autocomplete="off" required placeholder="Settings → Show sync code">
<p class="muted">This proves the quests are yours. It's never shared with ${esc(d.clientName)}.</p>
${error ? `<p class="warn">${esc(error)}</p>` : ""}
<div class="row"><button name="decision" value="deny" formnovalidate>Cancel</button><button class="go" name="decision" value="approve">Connect</button></div>
</form></div></main></body></html>`;
}

function errorPage(message) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Quest Log</title>${STYLE}</head><body><main><div class="card"><h1>Couldn't connect</h1><p>${esc(message)}</p></div></main></body></html>`;
}
