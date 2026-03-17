import { createTRPCRouter } from "./create-context";
import { worldRouter } from "./routes/world";
import { actionsRouter } from "./routes/actions";
import { defsRouter } from "./routes/defs";

export const appRouter = createTRPCRouter({
  world: worldRouter,
  actions: actionsRouter,
  defs: defsRouter,
});

export type AppRouter = typeof appRouter;
