import { ClientGenerationPlugin, DocsPlugin, ServerBuilder } from "pumice.js";
import { Draft, Note, Problem, Secret } from "./lib/schemas.js";

/** Models declared through the builder, used in a body, a response and throws data. */
export const server = new ServerBuilder()
  .rootDir(import.meta.dirname)
  .models([
    { name: "Note", schema: Note, description: "A note." },
    { name: "Draft", schema: Draft },
  ])
  .models([
    { name: "Problem", schema: Problem },
    // Only a route hidden from both manifests returns it.
    { name: "Secret", schema: Secret },
  ])
  .use(ClientGenerationPlugin())
  .use(DocsPlugin())
  .build();
