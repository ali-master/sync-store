import { createContext, useContext } from "react";
import type { AdminRequest } from "./admin-api";

export type Confirm = {
  text: string;
  before?: string;
  after?: string;
  run: () => Promise<void>;
};

/** The one mutation pipeline and its feedback, shared by every page and inspector. */
export type ConsoleActions = {
  request: AdminRequest;
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  refresh: () => void;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
  setConfirm: (confirm: Confirm | null) => void;
  /** Close the inspector, report success and reload the console's data. */
  mutationDone: (message: string) => void;
};

const ConsoleContext = createContext<ConsoleActions | null>(null);

export const ConsoleProvider = ConsoleContext.Provider;

export function useConsole() {
  const actions = useContext(ConsoleContext);
  if (!actions) throw new Error("Missing console actions provider");
  return actions;
}
