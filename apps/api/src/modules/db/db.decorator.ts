import { Inject } from "@nestjs/common";
import { Database } from "./db.client";

/** Injects the shared database connection. */
export const InjectDatabase = () => Inject(Database);
