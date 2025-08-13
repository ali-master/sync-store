import { waitForPort } from "@root/utils/wait-for-port.util";
import killPort from "kill-port";

/**
 * Kills a port if it is open.
 * This function attempts to connect to the specified port on the given host.
 * If the port is open, it will then close it using the `kill-port` package.
 * If the port is not open, it will log a message indicating that the port was not open.
 * This is useful for cleaning up resources or ensuring that a port is not left open after use.
 * @param {number} port - The port number to check and close.
 * @param {string} [host="localhost"] - The host on which to check the port. Defaults to "0.0.0.0"""
 * @returns {Promise<void>} A promise that resolves when the port is closed or if it was not open.
 * @throws Will log an error if the port could not be closed or if there was an issue checking the port.
 * @example
 * // Close port 3000 on localhost if it is open
 * await killPortIfOpen(3000);
 * @example
 * // Close port 8080 on a specific host if it is open
 * await killPortIfOpen(8080, "example.com");
 * @example
 * // Close port 5000 on localhost, handling any errors
 * try {
 *  await killPortIfOpen(5000);
 *  } catch (error) {
 *  console.error("Error closing port:", error);
 *  }
 */
export async function killPortIfOpen(port: number, host: string = "0.0.0.0"): Promise<void> {
  try {
    await waitForPort(port, host);
    await killPort(port, "tcp");
    console.log(`Port ${port} on ${host} was open and has been closed.`);
  } catch (error) {
    console.error(`Failed to close port ${port} on ${host}:`, error);
  }
}
