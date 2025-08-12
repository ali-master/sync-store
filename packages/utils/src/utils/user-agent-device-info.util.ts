import { isbot } from "isbot";
import DeviceDetector from "node-device-detector";
import ClientHints from "node-device-detector/client-hints";
// Types
import type { HeaderLike } from "./ip/types";

const deviceDetector = new DeviceDetector({
  clientIndexes: true,
  deviceIndexes: true,
  deviceAliasCode: false,
  deviceInfo: true,
  deviceTrusted: true,
  skipBotDetection: false,
  maxUserAgentSize: 500,
});
const clientHint = new ClientHints();

export const getRequestDeviceInfo = (headers: HeaderLike) => {
  const userAgent: string = headers["user-agent"] || "unknown";
  const hints = clientHint.parse(headers as any, {});
  const device = deviceDetector.detect(userAgent, hints);
  const isBot = isbot(userAgent);
  const botInfo = deviceDetector.parseBot(userAgent);

  return {
    userAgent,
    device,
    isBot,
    botInfo,
    hints,
  };
};
