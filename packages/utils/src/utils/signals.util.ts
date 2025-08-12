import { LoggerService } from "@nestjs/common";

export const signalsNames: NodeJS.Signals[] = ["SIGTERM", "SIGINT", "SIGHUP", "SIGBREAK"];
/**
 * SIGTERM and SIGINT Signals:
 * 'SIGTERM' and 'SIGINT' have default handlers on non-Windows platforms that reset the terminal mode before exiting with code 128 + signal number.
 * If one of these signals has a listener installed, its default behavior will be removed (Node.js will no longer exit).
 *
 * SIGHUP Signal:
 * 'SIGHUP' is generated on Windows when the console window is closed, and on other platforms under various similar conditions.
 * See [signal(7)](https://man7.org/linux/man-pages/man7/signal.7.html). It can have a listener installed, however Node.js will be unconditionally terminated by Windows about 10 seconds later. On non-Windows platforms, the default behavior of SIGHUP is to terminate Node.js, but once a listener has been installed its default behavior will be removed.
 *
 * SIGBREAK Signal:
 * 'SIGBREAK' is delivered on Windows when Ctrl+Break is pressed. On non-Windows platforms, it can be listened on, but there is no way to send or generate it.
 */
export function setupSignals(logger: LoggerService, callback: () => Promise<void> | void): void {
  signalsNames.forEach((signalName) =>
    process.on(signalName, async () => {
      logger.warn(`Received ${signalName} signal. Shutting down gracefully...`);

      await callback?.();

      process.exit(0);
    }),
  );
}
