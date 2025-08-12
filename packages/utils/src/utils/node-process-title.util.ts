import path from "node:path";
import { isNativeNumber } from "./type-guards";

// Minimal pascal case converter
function toPascalCase(str: string): string {
  return str
    .split(/[^a-zA-Z0-9]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

/**
 * Sets the Node.js process title based on either:
 *  1) A `custom title` (provided by the caller).
 *  2) Or `the basename (final folder name)` of a given project root directory (default).
 *
 * Additionally, you can include an instance ID to distinguish multiple processes
 * of the same application, and a port number to indicate which port the app is running on.
 *
 * @param projectRootDir - The filesystem path to the project's root directory
 *   (e.g. `/Users/alice/myProject`). If no `customTitle` is provided, the function
 *   will use the `basename` of this directory for the process title.
 *
 * @param options - Configuration object:
 *   - **customTitle?**: string
 *       If provided, this string overrides the default title derived from
 *       the project root directory.
 *   - **instanceId?**: number
 *       If provided, I append `#<instanceId>` to the title to distinguish
 *       multiple processes of the same app.
 *   - **port?**: number
 *       If provided, I append `[port: <port>]` to the title to specify
 *       the server port. This is helpful if you're running multiple
 *       instances on different ports.
 */
export function setNodeProcessTitle(
  projectRootDir: string,
  options?: {
    customTitle?: string;
    instanceId?: number;
    port?: number;
  },
): void {
  /**
   * If I have a customTitle, I'll use that as the base title;
   * otherwise, I default to "NodeJS - <PascalCase of directory name>".
   */
  const baseTitle: string = options?.customTitle
    ? options.customTitle
    : `NodeJS - ${toPascalCase(path.basename(projectRootDir))}`;

  /**
   * Begin building the final title.
   */
  let finalTitle = baseTitle;

  /**
   * If an instanceId is specified, I'll append it in a format like
   * "NodeJS - MyProject (#2)" or "MyCustomTitle (#3)".
   */
  if (isNativeNumber(options?.instanceId)) {
    finalTitle += ` (#${options.instanceId})`;
  }

  /**
   * If a port is provided, I append "[port: <port>]" to the title, e.g.:
   * "NodeJS - MyProject (#2) [port: 3000]"
   */
  if (isNativeNumber(options?.port)) {
    finalTitle += ` [port: ${options.port}]`;
  }

  /**
   * Now I assign the final title to process.title.
   * On macOS and Linux, you can see this title in `ps` or in Activity Monitor.
   * Windows might show partial or no effect, depending on OS constraints.
   */
  process.title = finalTitle;
}
