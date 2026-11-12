import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { McpExecutionContext, type McpContextType } from "@nestjs/mcp";
import { isCallToolResult, isInputRequiredResult } from "@modelcontextprotocol/server";
import { decode, encode } from "@toon-format/toon";
import { map } from "rxjs";

export const TOON_MIME_TYPE = "text/toon";

/** Where `@Tool`, `@Resource` and `@ResourceTemplate` keep their options on the method (`@nestjs/mcp` 0.0.4). */
const PRIMITIVE_METADATA = "nestjs:mcp:primitive";

/**
 * A rough token count: both formats carry the same words and numbers, so what differs is punctuation
 * (each mark counted as a token) and whitespace (each run counted as one).
 */
function tokens(text: string): number {
  return text.match(/[A-Za-z]+|\d+|\s+|[^A-Za-z\d\s]/g)?.length ?? 0;
}

/**
 * The text a model reads for a result: TOON (https://toonformat.dev) when it takes fewer tokens than
 * compact JSON and decodes back to exactly the same value, else that JSON. Objects lose their quotes
 * and braces, and uniform lists of records become one header and one row per record.
 */
export function modelText(data: unknown): { text: string; mimeType: string } {
  const json = JSON.stringify(data);
  try {
    const toon = encode(data);
    if (tokens(toon) < tokens(json) && JSON.stringify(decode(toon)) === json)
      return { text: toon, mimeType: TOON_MIME_TYPE };
  } catch {
    // A value TOON cannot carry stays JSON.
  }
  return { text: json, mimeType: "application/json" };
}

/** Text, nothing, bytes and finished protocol results are left to `@nestjs/mcp` as they are. */
function finished(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    typeof value === "string" ||
    value instanceof Uint8Array ||
    isInputRequiredResult(value) ||
    isCallToolResult(value) ||
    Array.isArray((value as { contents?: unknown })?.contents)
  );
}

/**
 * Encodes what every MCP tool and resource returns, in one place: the primitives return plain values
 * and never format them. `structuredContent` stays JSON for tools with an output schema, which the
 * SDK validates and programmatic clients read; the model reads the text block.
 */
@Injectable()
export class ToonInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    if (context.getType<McpContextType>() !== "mcp") return next.handle();
    const mcp = McpExecutionContext.create(context);
    const kind = mcp.getKind();
    if (kind !== "tool" && kind !== "resource") return next.handle();

    const primitive = Reflect.getMetadata(PRIMITIVE_METADATA, context.getHandler());
    // Without readable metadata, keep structuredContent: the SDK refuses a schema'd result without it.
    const structured = !primitive || primitive.options?.outputSchema !== undefined;
    return next.handle().pipe(
      map((value: unknown) => {
        if (finished(value)) return value;
        // One normalization (dates, BSON counters, toJSON) for both the text and structuredContent.
        const data = JSON.parse(JSON.stringify(value));
        const { text, mimeType } = modelText(data);
        if (kind === "resource")
          return { contents: [{ uri: mcp.getContext().uri!.href, mimeType, text }] };
        return {
          content: [{ type: "text", text }],
          ...(structured && { structuredContent: data }),
        };
      }),
    );
  }
}
