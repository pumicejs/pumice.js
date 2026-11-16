/**
 * Holds `/slow`'s answers until the test opens the gate, so a request is
 * still under way when the test closes the server.
 */
let opened = Promise.resolve();
let openGate = () => {};
let reached = () => {};

/** Holds every `/slow` answer from now on; resolves once one has arrived. */
export function closeGate(): { arrived: Promise<void>; open: () => void } {
  opened = new Promise((resolve) => {
    openGate = resolve;
  });
  const arrived = new Promise<void>((resolve) => {
    reached = resolve;
  });
  return { arrived, open: () => openGate() };
}

/** `/slow`'s handler waits here. */
export async function passGate(): Promise<void> {
  reached();
  await opened;
}
