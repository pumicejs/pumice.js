import { Draft, Note, Problem } from "../../lib/schemas.js";
import { server } from "../../server.js";

server
  .route()
  .post()
  .describe("Create a note")
  .body(Draft)
  .response({ 201: Note })
  .throws({ 422: { message: "The note can't be saved", data: Problem } })
  .handle((c) => c.response({ status: 201, data: { id: 1, ...c.body } }));
