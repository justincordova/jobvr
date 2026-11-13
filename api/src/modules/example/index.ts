import { createRouter } from "@/lib/create-app";
import * as handlers from "./handlers";
import * as routes from "./routes";

// Chained so the full route types flow into AppType for the RPC client.
const exampleRouter = createRouter()
  .openapi(routes.list, handlers.listHandler)
  .openapi(routes.create, handlers.createHandler)
  .openapi(routes.getOne, handlers.getOneHandler)
  .openapi(routes.update, handlers.updateHandler)
  .openapi(routes.remove, handlers.removeHandler);

export default exampleRouter;
