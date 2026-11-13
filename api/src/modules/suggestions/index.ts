import { createRouter } from "@/lib/create-app";
import * as handlers from "./handlers";
import * as routes from "./routes";

const suggestionsRouter = createRouter()
  .openapi(routes.list, handlers.listHandler)
  .openapi(routes.add, handlers.addHandler)
  .openapi(routes.dismiss, handlers.dismissHandler);

export default suggestionsRouter;
