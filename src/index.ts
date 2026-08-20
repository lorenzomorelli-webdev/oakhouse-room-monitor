import {
  createAyntecProductionDependencies,
  runAyntecMonitor,
  type AyntecMonitorEnv,
  type AyntecMonitorRunner,
} from "./ayntec/monitor";
import {
  createFxProductionDependencies,
  runFxMonitor,
  type FxMonitorDependencies,
  type FxMonitorEnv,
  type FxMonitorRunner,
} from "./fx/monitor";
import { isFxDigestDue } from "./fx/schedule";
import type { WorkerEnv } from "./model";
import {
  handleTelegramUpdate,
  type TelegramUpdateHandler,
} from "./commands";
import {
  createProductionDependencies,
  runMonitor,
  type MonitorDependencies,
  type MonitorRunner,
} from "./monitor";

type DependenciesFactory = (env: WorkerEnv) => MonitorDependencies;
type AyntecDependenciesFactory = (
  env: AyntecMonitorEnv,
) => MonitorDependencies;
type FxDependenciesFactory = (
  env: FxMonitorEnv,
) => FxMonitorDependencies;

export interface ScheduledWorker {
  scheduled(
    controller: ScheduledController,
    env: WorkerEnv,
    context: ExecutionContext,
  ): Promise<void>;
}

export interface OakhouseWorker extends ScheduledWorker {
  fetch(
    request: Request,
    env: WorkerEnv,
    context: ExecutionContext,
  ): Promise<Response>;
}

const TELEGRAM_WEBHOOK_PATH = "/telegram/webhook";
export const OAKHOUSE_CRON = "* * * * *";
export const AYNTEC_CRON = "0 * * * *";

function secretsMatch(expected: string, received: string | null): boolean {
  if (!expected || received === null || expected.length !== received.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ received.charCodeAt(index);
  }
  return difference === 0;
}

export function createWorker(
  runner: MonitorRunner = runMonitor,
  dependenciesFactory: DependenciesFactory = createProductionDependencies,
  updateHandler: TelegramUpdateHandler = handleTelegramUpdate,
  ayntecRunner: AyntecMonitorRunner = runAyntecMonitor,
  ayntecDependenciesFactory: AyntecDependenciesFactory =
    createAyntecProductionDependencies,
  fxRunner: FxMonitorRunner = runFxMonitor,
  fxDependenciesFactory: FxDependenciesFactory =
    createFxProductionDependencies,
): OakhouseWorker {
  async function runScheduled(
    monitor: "oakhouse" | "ayntec" | "fx",
    execute: () => Promise<import("./monitor").RunResult>,
  ): Promise<void> {
    try {
      const result = await execute();
      console.log(
        JSON.stringify({
          event: "scheduled_run_finished",
          monitor,
          status: result.status,
          checkedAt: result.checkedAt,
          detail: result.detail,
        }),
      );
    } catch {
      console.error(JSON.stringify({
        event: "scheduled_run_failed",
        monitor,
      }));
    }
  }

  return {
    async fetch(request, env, _context) {
      if (new URL(request.url).pathname !== TELEGRAM_WEBHOOK_PATH) {
        return new Response("Not found", { status: 404 });
      }
      if (request.method !== "POST") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { allow: "POST" },
        });
      }
      if (
        !secretsMatch(
          env.TELEGRAM_WEBHOOK_SECRET,
          request.headers.get("x-telegram-bot-api-secret-token"),
        )
      ) {
        return new Response("Forbidden", { status: 403 });
      }

      let update: unknown;
      try {
        update = await request.json();
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }
      if (typeof update !== "object" || update === null || Array.isArray(update)) {
        return new Response("Invalid update", { status: 400 });
      }

      try {
        await updateHandler(update, env, dependenciesFactory(env));
      } catch {
        console.error(JSON.stringify({ event: "telegram_webhook_update_failed" }));
        return new Response("Command processing failed", { status: 502 });
      }
      return new Response(null, { status: 204 });
    },
    async scheduled(controller, env, _context) {
      if (controller.cron === OAKHOUSE_CRON) {
        await runScheduled(
          "oakhouse",
          () => runner(env, dependenciesFactory(env)),
        );
      } else if (controller.cron === AYNTEC_CRON) {
        const runs = [
          runScheduled(
            "ayntec",
            () => ayntecRunner(env, ayntecDependenciesFactory(env)),
          ),
        ];
        if (isFxDigestDue(new Date(controller.scheduledTime))) {
          runs.push(
            runScheduled(
              "fx",
              () => fxRunner(env, fxDependenciesFactory(env)),
            ),
          );
        }
        await Promise.all(runs);
      } else {
        console.warn(JSON.stringify({
          event: "scheduled_cron_ignored",
          cron: controller.cron,
        }));
      }
    },
  };
}

const worker = createWorker();
export default worker satisfies ExportedHandler<WorkerEnv>;
