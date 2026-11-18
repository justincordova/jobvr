import { createRouter } from "@/lib/create-app";
import * as handlers from "./handlers";
import * as routes from "./routes";

const logsRouter = createRouter().openapi(routes.list, handlers.listHandler);

export default logsRouter;
