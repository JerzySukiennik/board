/* Durable Object holding the daily spend and per-visitor counters. No timers, so it hibernates between requests. */

export class Limits {
  constructor(state) {
    this.storage = state.storage;
  }

  async fetch(req) {
    const p = await req.json();
    const day = new Date().toISOString().slice(0, 10);
    if ((await this.storage.get("day")) !== day) {
      await this.storage.deleteAll();
      await this.storage.put("day", day);
    }
    const usdKey = `usd:${p.bucket}`;
    const spent = (await this.storage.get(usdKey)) || 0;

    if (p.op === "take") {
      if (spent >= p.usd) return Response.json({ ok: false, why: "budget" });
      const key = `who:${p.bucket}:${p.who}`;
      const rec = (await this.storage.get(key)) || { n: 0, t: 0 };
      const now = Date.now();
      if (rec.n >= p.perVisitor) return Response.json({ ok: false, why: "visitor" });
      if (now - rec.t < p.gapMs) return Response.json({ ok: false, why: "fast" });
      rec.n += 1;
      rec.t = now;
      await this.storage.put(key, rec);
      return Response.json({ ok: true });
    }

    if (p.op === "spend") {
      await this.storage.put(usdKey, spent + p.amount);
      return Response.json({ ok: true });
    }

    return Response.json({ ok: true, spent });
  }
}
