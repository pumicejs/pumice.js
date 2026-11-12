import { Job } from "../../../lib/schemas.js";
import { server } from "../../../server.js";

server
  .route()
  .post()
  .describe("Run a job")
  .config({ docs: { hidden: true } })
  .response(Job)
  .handle(() => ({ id: "j1", state: "queued" as const }))
  .get()
  .describe("List jobs")
  .config({ docs: { group: "not-declared" } })
  .handle(() => []);
