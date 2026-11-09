import { server } from "../../../server.js";

server
  .route()
  .post()
  .describe("Run a job")
  .config({ docs: { hidden: true } })
  .handle(() => ({ started: true }))
  .get()
  .describe("List jobs")
  .config({ docs: { group: "not-declared" } })
  .handle(() => []);
