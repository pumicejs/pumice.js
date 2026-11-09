import { z } from "pumice.js";
import { server } from "../server.js";

export const POSTS = new Map([
  [1, { id: 1, userId: "ann", title: "Ann's post" }],
  [2, { id: 2, userId: "bob", title: "Bob's post" }],
]);

export const calls: string[] = [];

/** Loads a post and, unless relaxed for the method, requires its owner. */
export const postProcedure = server
  .procedure()
  .config<{ relaxForMethods?: string[] }>()
  .params(z.object({ postId: z.number() }))
  .handle((c) => {
    calls.push(`post:${c.params.postId}`);
    const post = POSTS.get(c.params.postId);
    if (!post) throw 404;
    const relaxed = c.config.relaxForMethods?.includes(c.req.method) === true;
    if (!relaxed && post.userId !== c.auth.data.user.id) throw 403;
    return { post };
  });

export const auditProcedure = server.procedure().handle(() => {
  calls.push("audit");
  return { audited: true as const };
});

export const brokenProcedure = server.procedure().handle(() => {
  throw new Error("procedure exploded");
});
