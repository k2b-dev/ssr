import { Hono } from "hono";
import { logger } from "hono/logger";
import { serveStatic } from "hono/bun";
import { routes } from "@k2b/ssr/hono";
import { config } from "../config";
import { api } from "./api";
import Home from "./components/Home";
import About from "./components/About";
import ApiDemo from "./components/ApiDemo";
import NavDemo from "./components/NavDemo";

const app = new Hono()
  .use(logger())
  .route("/_ssr", routes(config))
  .route("/api", api)
  .use("/public/*", serveStatic({ root: "./" }))
  .get("/", ...Home)
  .get("/about", ...About)
  .get("/api-test", ...ApiDemo)
  .get("/nav-demo", ...NavDemo);

export default app;
