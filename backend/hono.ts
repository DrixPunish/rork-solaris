import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { appRouter } from "./trpc/app-router";
import { createContext } from "./trpc/create-context";
import { runWorldTick, startWorldTickLoop } from "./worldTick";

const app = new Hono();

app.use("*", cors());

app.use(
  "/trpc/*",
  trpcServer({
    endpoint: "/api/trpc",
    router: appRouter,
    createContext,
  }),
);

app.get("/", (c) => {
  return c.json({ status: "ok", message: "Solaris Backend API" });
});

app.post("/tick", async (c) => {
  const result = await runWorldTick();
  return c.json({ success: true, ...result, timestamp: Date.now() });
});

app.get("/tick/status", (c) => {
  return c.json({ running: true, timestamp: Date.now() });
});

app.get("/debug/timers", async (c) => {
  const { supabase } = await import("./supabase");
  const now = Date.now();

  const { data: allTimers, error: allErr } = await supabase
    .from('active_timers')
    .select('id, end_time, start_time, timer_type, target_id, target_level, planet_id, user_id')
    .order('end_time', { ascending: true })
    .limit(20);

  const { data: expiredTimers, error: expErr } = await supabase
    .from('active_timers')
    .select('id, end_time, timer_type, target_id')
    .lte('end_time', now);

  return c.json({
    now,
    nowISO: new Date(now).toISOString(),
    nowType: typeof now,
    allTimersCount: allTimers?.length ?? 0,
    allTimersError: allErr?.message ?? null,
    expiredCount: expiredTimers?.length ?? 0,
    expiredError: expErr?.message ?? null,
    timers: (allTimers ?? []).map((t: Record<string, unknown>) => ({
      id: t.id,
      end_time: t.end_time,
      end_time_type: typeof t.end_time,
      start_time: t.start_time,
      timer_type: t.timer_type,
      target_id: t.target_id,
      target_level: t.target_level,
      diff_ms: Number(t.end_time) - now,
      diff_sec: Math.round((Number(t.end_time) - now) / 1000),
      is_expired: Number(t.end_time) <= now,
      lte_would_match: (t.end_time as number) <= now,
      lte_string_match: String(t.end_time) <= String(now),
    })),
  });
});

startWorldTickLoop(5000);
console.log("[Backend] Solaris world tick loop started (5s interval)");

export default app;
