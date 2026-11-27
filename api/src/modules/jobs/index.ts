import { createRouter } from "@/lib/create-app";
import * as handlers from "./handlers";
import * as routes from "./routes";

// Chained so the full route types flow into AppType for the RPC client.
const jobsRouter = createRouter()
  .openapi(routes.list, handlers.listHandler)
  .openapi(routes.visit, handlers.visitHandler)
  .openapi(routes.details, handlers.detailsHandler)
  .openapi(routes.setState, handlers.setStateHandler)
  .openapi(routes.setStage, handlers.setStageHandler);

export default jobsRouter;
