import { cors } from "hono/cors";
import type { ServerPlugin } from "../types/plugin.js";

export type CorsPluginOptions = Parameters<typeof cors>[0];

export class CorsPlugin implements ServerPlugin {
  public constructor(private readonly options?: CorsPluginOptions) {}

  public apply({ app }: Parameters<ServerPlugin["apply"]>[0]): void {
    app.use("*", cors(this.options));
  }
}
