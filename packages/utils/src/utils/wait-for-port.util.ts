import * as net from "net";

/**
 * Waits for a specific port on a host to become available.
 * This is useful for ensuring that a service is up and running before proceeding with further operations.
 * @param port
 * @param host
 */
export function waitForPort(port: number, host: string): Promise<void> {
  return new Promise((resolve) => {
    const checkPort = () => {
      const socket = new net.Socket();

      const onError = () => {
        socket.destroy();
        setTimeout(checkPort, 1000); // Try again in 1 second
      };

      socket.once("error", onError);

      socket.connect(port, host, () => {
        socket.destroy();
        resolve();
      });
    };

    checkPort();
  });
}
