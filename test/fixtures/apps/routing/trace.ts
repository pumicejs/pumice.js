/** Records the order in which middlewares and handlers ran, per request. */
export const trace: string[] = [];
export const counters = { wrapHandler: 0, voidHandler: 0 };
