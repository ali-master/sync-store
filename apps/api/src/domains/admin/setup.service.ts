import {
  BadRequestException,
  ConflictException,
  Injectable,
  OnApplicationBootstrap,
  UnauthorizedException,
} from "@nestjs/common";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Database, InjectDatabase } from "../../modules/db";
import { BOOTSTRAP_KEY_ID, ensureBootstrapKey } from "./bootstrap-key";

@Injectable()
export class SetupService implements OnApplicationBootstrap {
  constructor(@InjectDatabase() private readonly db: Database) {}

  /** Existing installations never reopen setup, even when their administrator is disabled. */
  async status() {
    return { required: !(await this.db.orm.api_keys.where({ id: BOOTSTRAP_KEY_ID }).first()) };
  }

  /** Keep one installation proof across restarts and replicas until the operator finishes setup. */
  async onApplicationBootstrap() {
    if (!(await this.status()).required) return;
    const collection = this.db.native.collection<{ _id: string; code: string }>(
      "installation_setup",
    );
    try {
      await collection.updateOne(
        { _id: "initial" },
        { $setOnInsert: { code: randomBytes(32).toString("hex") } },
        { upsert: true },
      );
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    const setup = await collection.findOne({ _id: "initial" });
    if (!setup) throw new Error("Unable to initialize installation setup");
    console.log(`\nFinish setup at /dashboard/\nSetup code: ${setup.code}\n`);
  }

  /** Verify server ownership before atomically issuing the first administrator credential. */
  async complete(body: unknown) {
    if (!(await this.status()).required)
      throw new ConflictException(
        "Setup is already complete. Sign in with your administrator key.",
      );
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new BadRequestException("Setup details are required");
    const { code, name } = body as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim() || name.trim().length > 100)
      throw new BadRequestException("Enter an administrator name of 1–100 characters");
    if (typeof code !== "string" || !/^[a-f0-9]{64}$/.test(code))
      throw new UnauthorizedException("Invalid setup code");
    const setup = await this.db.native
      .collection<{ _id: string; code: string }>("installation_setup")
      .findOne({ _id: "initial" });
    if (!setup || !timingSafeEqual(Buffer.from(code), Buffer.from(setup.code)))
      throw new UnauthorizedException("Invalid setup code");
    const key = await ensureBootstrapKey(this.db, name.trim());
    if (!key)
      throw new ConflictException(
        "Setup is already complete. Sign in with your administrator key.",
      );
    return { key };
  }
}
