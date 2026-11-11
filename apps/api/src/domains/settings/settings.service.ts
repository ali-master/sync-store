import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { corsOptions } from "../../cors";
import { Database, InjectDatabase } from "../../modules/db";
import { ssoConfig } from "../admin/sso.service";
import {
  applyOverrides,
  currentOverrides,
  effectiveEnv,
  SETTINGS,
  type SettingDefinition,
  settingNames,
} from "./settings.store";

const COLLECTION = "installation_settings";
const DOCUMENT_ID = "installation";
/** How quickly a change saved on one replica reaches the others. */
const REFRESH_MS = 5_000;

const defaults: Record<string, string> = {
  API_URL: "http://localhost:3000",
  CORS_ALLOWED_ORIGINS: "*",
  HISTORY_RETENTION_DAYS: "30",
  SSO_SCOPES: "openid email profile",
  SSO_PROVIDER_NAME: "SSO",
  SSO_SESSION_MINUTES: "480",
};

interface SettingsDocument {
  _id: string;
  values: Record<string, string>;
  revision: number;
  updatedAt: Date;
  updatedBy: string;
}

/** Turn one submitted value into its stored form, or explain why it cannot be stored. */
export function normalizeSetting(definition: SettingDefinition, input: unknown): string {
  const value = typeof input === "number" && definition.type === "integer" ? String(input) : input;
  if (typeof value !== "string")
    throw new BadRequestException(`${definition.label}: expected text`);
  const text = value.trim();
  if (text.length > 2000 || [...text].some((char) => char.charCodeAt(0) < 32))
    throw new BadRequestException(`${definition.label}: too long or contains control characters`);
  if (definition.type === "integer") {
    const number = Number(text);
    if (
      !/^\d+$/.test(text) ||
      number < (definition.min ?? 0) ||
      number > (definition.max ?? Number.MAX_SAFE_INTEGER)
    )
      throw new BadRequestException(
        `${definition.label}: enter a whole number from ${definition.min} to ${definition.max}`,
      );
    return String(number);
  }
  if (text === "") return "";
  if (definition.type === "url") {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      throw new BadRequestException(`${definition.label}: enter a full http(s) URL`);
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new BadRequestException(
        `${definition.label}: enter an http(s) URL without credentials`,
      );
    let trimmed = text;
    while (trimmed.endsWith("/")) trimmed = trimmed.slice(0, -1);
    return trimmed;
  }
  if (definition.type === "list")
    return text
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .join(", ");
  if (definition.max && text.length > definition.max)
    throw new BadRequestException(`${definition.label}: at most ${definition.max} characters`);
  if (definition.type === "secret" && definition.min && text.length < definition.min)
    throw new BadRequestException(`${definition.label}: at least ${definition.min} characters`);
  return text;
}

/** Check the settings together, as the application will read them, before anything is saved. */
export function validateEffective(env: Record<string, string | undefined>) {
  try {
    corsOptions(env.CORS_ALLOWED_ORIGINS);
    ssoConfig(env);
  } catch (error) {
    throw new BadRequestException((error as Error).message);
  }
}

/** Database-first installation settings, cached in memory and refreshed from MongoDB. */
@Injectable()
export class SettingsService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger("Settings");
  private timer?: ReturnType<typeof setInterval>;
  private meta: { revision: number; updatedAt: Date | null; updatedBy: string | null } = {
    revision: 0,
    updatedAt: null,
    updatedBy: null,
  };

  constructor(@InjectDatabase() private readonly db: Database) {}

  private get collection() {
    return this.db.native.collection<SettingsDocument>(COLLECTION);
  }

  /** Load before requests are served; an invalid combination stops the boot, as the environment does. */
  async onModuleInit() {
    await this.refresh();
    validateEffective(effectiveEnv());
  }

  onApplicationBootstrap() {
    this.timer = setInterval(() => {
      this.refresh().catch((error) => this.logger.warn("Could not refresh settings: " + error));
    }, REFRESH_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async refresh() {
    const document = await this.collection.findOne({ _id: DOCUMENT_ID });
    applyOverrides(document?.values ?? {});
    this.meta = {
      revision: document?.revision ?? 0,
      updatedAt: document?.updatedAt ?? null,
      updatedBy: document?.updatedBy ?? null,
    };
  }

  /** Every setting with where its value comes from; secrets report only whether they are set. */
  view() {
    const overrides = currentOverrides();
    return {
      revision: this.meta.revision,
      updatedAt: this.meta.updatedAt,
      updatedBy: this.meta.updatedBy,
      settings: SETTINGS.map((definition) => {
        const stored = Object.hasOwn(overrides, definition.env);
        const environment = process.env[definition.env] || undefined;
        const value = stored ? overrides[definition.env] || undefined : environment;
        const secret = definition.type === "secret";
        return {
          ...definition,
          source: stored ? "database" : environment ? "environment" : "default",
          set: value !== undefined,
          value: secret ? null : (value ?? defaults[definition.env] ?? null),
          environmentValue: secret ? null : (environment ?? null),
          environmentSet: environment !== undefined,
          defaultValue: defaults[definition.env] ?? null,
        };
      }),
    };
  }

  /**
   * Save the submitted values. A string overrides the environment (an empty string sets it to
   * empty), null removes the override. Omitted settings, including secrets, are left as they are.
   */
  async update(body: unknown, actor: string) {
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new BadRequestException("Expected { values, revision? }");
    const { values, revision } = body as { values?: unknown; revision?: unknown };
    if (!values || typeof values !== "object" || Array.isArray(values))
      throw new BadRequestException("values must be an object");
    if (revision !== undefined && !Number.isInteger(revision))
      throw new BadRequestException("revision must be an integer");
    const set: Record<string, string> = {};
    const unset: string[] = [];
    for (const [name, input] of Object.entries(values)) {
      const definition = SETTINGS.find((setting) => setting.env === name);
      if (!definition || !settingNames.has(name))
        throw new BadRequestException("Unknown setting: " + name);
      if (input === null) unset.push(name);
      else set[name] = normalizeSetting(definition, input);
    }
    if (!Object.keys(set).length && !unset.length)
      throw new BadRequestException("Nothing to change");

    const next = { ...currentOverrides(), ...set };
    for (const name of unset) delete next[name];
    validateEffective({ ...process.env, ...next });

    const result = await this.collection
      .findOneAndUpdate(
        revision === undefined
          ? { _id: DOCUMENT_ID }
          : { _id: DOCUMENT_ID, revision: revision as number },
        {
          $set: {
            ...Object.fromEntries(
              Object.entries(set).map(([name, value]) => ["values." + name, value]),
            ),
            updatedAt: new Date(),
            updatedBy: actor,
          },
          ...(unset.length
            ? { $unset: Object.fromEntries(unset.map((name) => ["values." + name, ""])) }
            : {}),
          $inc: { revision: 1 },
        },
        { upsert: revision === undefined || revision === 0, returnDocument: "after" },
      )
      .catch((error) => {
        // A revision guard on a missing document upserts a duplicate _id: someone else saved first.
        if ((error as { code?: number }).code === 11000) return null;
        throw error;
      });
    if (!result)
      throw new ConflictException("Settings changed since you loaded them. Reload and try again.");
    applyOverrides(result.values ?? {});
    this.meta = { revision: result.revision, updatedAt: result.updatedAt, updatedBy: actor };
    return { changed: [...Object.keys(set), ...unset], ...this.view() };
  }
}
