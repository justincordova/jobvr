import { createRouter } from "@/lib/create-app";
import * as handlers from "./handlers";
import * as routes from "./routes";

const settingsRouter = createRouter()
  .openapi(routes.get, handlers.getHandler)
  .openapi(routes.update, handlers.updateHandler);

export default settingsRouter;
