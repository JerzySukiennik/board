/* board-api: streams board scripts from Claude Haiku 5.5 to the whiteboard app, with a daily budget and per-visitor limits. */
import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM, lessonMessage, moreMessage, replyMessage } from "./prompt.mjs";

export { Limits } from "./limits.mjs";

const LESSON_MODEL = "claude-sonnet-5-5";
const REPLY_MODEL = "claude-haiku-5-5";
const USD_PER_MTOK = { "claude-haiku-5-5": [0.1, 0.5], "claude-sonnet-5-5": [2, 10], "claude-opus-5-5": [4, 20] };
const ORIGINS = ["https://board.gzowo.fun", "https://pupka.gzowo.fun"];
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const MAX_IMAGE = 700000;

const MESSAGES = {
  budget: "Tablica wyczerpała dzienny limit pytań. Jutro znowu działa.",
  visitor: "Na dziś to już wszystkie pytania z tego urządzenia. Wróć jutro.",
  fast: "Chwila, jeszcze piszę. Spróbuj za sekundę.",
};

function allowed(origin) {
  return ORIGINS.includes(origin) || LOCAL.test(origin || "");
}

function cors(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

function json(origin, body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors(origin) } });
}

async function visitor(req, env) {
  const ip = req.headers.get("cf-connecting-ip") || "local";
  const data = new TextEncoder().encode(ip + "|" + (env.SALT || "board"));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...hash.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function limits(env, body) {
  const stub = env.LIMITS.get(env.LIMITS.idFromName("limits"));
  return stub.fetch("https://limits/", { method: "POST", body: JSON.stringify(body) }).then((r) => r.json());
}

function cost(u, model) {
  if (!u) return 0;
  const [input, output] = USD_PER_MTOK[model] || USD_PER_MTOK["claude-opus-5-5"];
  return ((u.input_tokens || 0) * input + (u.output_tokens || 0) * output + (u.cache_read_input_tokens || 0) * input * 0.1 + (u.cache_creation_input_tokens || 0) * input * 1.25) / 1e6;
}

function settings(env, p, kind) {
  const dev = env.DEV === "1" && p.debug ? p.debug : {};
  const model = dev.model || (kind === "reply" ? env.REPLY_MODEL || REPLY_MODEL : env.LESSON_MODEL || LESSON_MODEL);
  const thinking = dev.thinking || (kind === "reply" ? env.REPLY_THINKING : env.LESSON_THINKING) || "off";
  const effort = dev.effort || (kind === "reply" ? env.REPLY_EFFORT : env.LESSON_EFFORT) || (model === "claude-haiku-5-5" ? "medium" : "low");
  return { model, effort, thinking: thinking === "on" || model !== "claude-haiku-5-5" ? { type: "adaptive" } : { type: "disabled" } };
}

function buildRequest(env, p) {
  const kind = p.kind === "reply" || p.kind === "more" ? p.kind : "lesson";
  const { model, effort, thinking } = settings(env, p, kind);
  const system = [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }];
  const base = { model, system, thinking, output_config: { effort } };
  if (kind === "reply") {
    const content = [];
    if (p.image) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: p.image } });
    content.push({ type: "text", text: replyMessage(p) });
    return { ...base, max_tokens: 4000, messages: [{ role: "user", content }] };
  }
  return { ...base, max_tokens: 12000, messages: [{ role: "user", content: kind === "more" ? moreMessage(p) : lessonMessage(p) }] };
}

function failure(err) {
  if (err instanceof Anthropic.RateLimitError) return "Za dużo pytań naraz. Spróbuj za chwilę.";
  if (err instanceof Anthropic.AuthenticationError) return "Tablica nie ma teraz dostępu do AI.";
  if (err instanceof Anthropic.APIConnectionError) return "Nie mogę połączyć się z AI. Spróbuj jeszcze raz.";
  if (err instanceof Anthropic.APIError) return err.status >= 500 ? "AI ma chwilową przerwę. Spróbuj jeszcze raz." : "AI odrzuciło to pytanie.";
  return "Coś poszło nie tak. Spróbuj jeszcze raz.";
}

async function draw(req, env, ctx, origin) {
  let p;
  try {
    p = await req.json();
  } catch {
    return json(origin, { error: "Zły format zapytania." }, 400);
  }
  if (!env.ANTHROPIC_API_KEY) return json(origin, { error: "Tablica nie ma teraz dostępu do AI." }, 503);
  if (p.kind !== "reply" && !String(p.question || "").trim()) return json(origin, { error: "Napisz pytanie." }, 400);
  if (p.image && (typeof p.image !== "string" || p.image.length > MAX_IMAGE)) return json(origin, { error: "Za duży obrazek." }, 413);

  const bucket = origin === "https://pupka.gzowo.fun" || (LOCAL.test(origin) && p.app === "pupka") ? "pupka" : "public";
  const usd = parseFloat((bucket === "pupka" ? env.PUPKA_USD : env.PUBLIC_USD) || "1");
  const perVisitor = parseInt((bucket === "pupka" ? env.PUPKA_PER_VISITOR : env.PUBLIC_PER_VISITOR) || "150", 10);
  const who = await visitor(req, env);
  const gate = await limits(env, { op: "take", bucket, who, usd, perVisitor, gapMs: 700 });
  if (!gate.ok) return json(origin, { error: MESSAGES[gate.why] || MESSAGES.budget }, 429);

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 });
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  let closed = false;
  const send = (text) => (closed ? Promise.resolve() : writer.write(enc.encode(`data: ${JSON.stringify(text)}\n\n`)).catch(() => { closed = true; }));

  const request = buildRequest(env, p);
  const pump = (async () => {
    let usage = null;
    let stream;
    try {
      stream = client.messages.stream(request);
      for await (const event of stream) {
        if (closed) {
          stream.abort();
          break;
        }
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") await send(event.delta.text);
      }
      if (!closed) {
        const final = await stream.finalMessage();
        usage = final.usage;
        if (final.stop_reason === "refusal") await send("\nerror Na to pytanie nie odpowiem na tablicy. Zapytaj o coś innego.\n");
        else if (final.stop_reason === "max_tokens") await send("\nerror Zabrakło miejsca na resztę odpowiedzi.\n");
      } else {
        usage = stream.currentMessage && stream.currentMessage.usage;
      }
    } catch (err) {
      usage = (stream && stream.currentMessage && stream.currentMessage.usage) || usage;
      await send(`\nerror ${failure(err)}\n`);
    }
    await send("\ndone\n");
    try {
      await writer.close();
    } catch {}
    const amount = cost(usage, request.model);
    if (env.DEV === "1") console.log(JSON.stringify({ model: request.model, thinking: request.thinking.type, effort: request.output_config.effort, usage, usd: +amount.toFixed(5) }));
    if (amount > 0) await limits(env, { op: "spend", bucket, amount });
  })();
  ctx.waitUntil(pump);

  return new Response(readable, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no", ...cors(origin) } });
}

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get("origin") || "";
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "");
    if (req.method === "OPTIONS") return allowed(origin) ? new Response(null, { status: 204, headers: cors(origin) }) : new Response(null, { status: 403 });
    if (path === "" || path === "/health") return json(allowed(origin) ? origin : "null", { ok: true, lesson: env.LESSON_MODEL || LESSON_MODEL, reply: env.REPLY_MODEL || REPLY_MODEL, key: !!env.ANTHROPIC_API_KEY });
    if (!allowed(origin)) return new Response("forbidden", { status: 403 });
    if (path === "/draw" && req.method === "POST") return draw(req, env, ctx, origin);
    return json(origin, { error: "Nie ma takiej ścieżki." }, 404);
  },
};
