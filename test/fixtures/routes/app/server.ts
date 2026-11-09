import { Server } from "pumice.js";

/**
 * An app whose own path contains a `routes` directory (test/fixtures/routes/),
 * with files discovery must not import (REVIEW §1.3).
 */
export const server = new Server({ rootDir: import.meta.dirname });
