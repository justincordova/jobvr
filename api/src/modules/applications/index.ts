import { createRouter } from "@/lib/create-app";
import * as handlers from "./handlers";
import * as routes from "./routes";

const applicationsRouter = createRouter()
  .openapi(routes.list, handlers.listHandler)
  .openapi(routes.create, handlers.createHandler)
  .openapi(routes.update, handlers.updateHandler)
  .openapi(routes.remove, handlers.removeHandler);

export default applicationsRouter;
