import { auditProcedure, postProcedure } from "../../../lib/procedures.js";
import { server } from "../../../server.js";

server
  .route()
  .procedure(postProcedure({ relaxForMethods: ["GET"] }))
  .procedure(auditProcedure(), { applyOnMethods: ["delete"] })
  .get()
  .handle((c) => ({ title: c.procedures.post.title, postId: c.params.postId }))
  .delete()
  .handle((c) => ({
    deleted: c.procedures.post.id,
    audited: c.procedures.audited,
  }));
