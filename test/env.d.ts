import type { MonitorEnv } from "../src/model";

declare global {
  namespace Cloudflare {
    interface Env extends MonitorEnv {}
  }
}

export {};
