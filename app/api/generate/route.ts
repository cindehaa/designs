import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { layoutSpecSchema, type LayoutSpec } from "@/lib/layoutSchema";
import { buildSystemPrompt, buildUserPrompt } from "@/lib/anthropicPrompt";
import { buildFallbackLayout } from "@/lib/fallbackLayout";

// Vision-capable current model id for this environment.
const MODEL = "claude-sonnet-5";

// Media types the Anthropic vision API accepts for image blocks.
const ALLOWED_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

type AllowedMediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

/** Request body: base64-encoded image + its media type. */
const requestSchema = z.object({
  imageBase64: z.string().min(1),
  mediaType: z.enum(ALLOWED_MEDIA_TYPES),
});

/** Response shape returned to the frontend. */
interface GenerateResponse {
  layout: LayoutSpec;
  degraded: boolean;
}

/**
 * Strip a leading `data:...;base64,` URL prefix and any surrounding
 * whitespace, so callers can hand us either a raw base64 string or a full
 * data URL.
 */
function normalizeBase64(input: string): string {
  const trimmed = input.trim();
  const comma = trimmed.indexOf(",");
  if (trimmed.startsWith("data:") && comma !== -1) {
    return trimmed.slice(comma + 1);
  }
  return trimmed;
}

/** Concatenate all text blocks from a Messages API response. */
function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

/**
 * Parse the model's text as JSON, tolerating an accidental ```json fence even
 * though the prompt forbids it. Throws on unparseable text.
 */
function parseModelJson(text: string): unknown {
  let candidate = text.trim();
  if (candidate.startsWith("```")) {
    // Drop the opening fence (optionally ```json) and the closing fence.
    candidate = candidate
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  }
  return JSON.parse(candidate);
}

/**
 * One call to Claude's vision API. Returns the raw text response for parsing.
 */
async function callClaude(
  client: Anthropic,
  imageBase64: string,
  mediaType: AllowedMediaType,
  zodError?: string,
): Promise<string> {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: buildSystemPrompt(),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: imageBase64,
            },
          },
          { type: "text", text: buildUserPrompt(zodError) },
        ],
      },
    ],
  });

  return extractText(message);
}

/**
 * Try to obtain a validated LayoutSpec from a raw model response. Returns the
 * parsed spec on success, or a formatted Zod/JSON error string on failure.
 */
function validateResponse(
  text: string,
): { ok: true; layout: LayoutSpec } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = parseModelJson(text);
  } catch {
    return {
      ok: false,
      error: "Response was not valid JSON. Return a single raw JSON object.",
    };
  }

  const result = layoutSpecSchema.safeParse(json);
  if (result.success) {
    return { ok: true, layout: result.data };
  }

  // Compact, human-readable list of validation problems for self-correction.
  const error = result.error.issues
    .map((issue) => `- ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  return { ok: false, error };
}

export async function POST(request: Request): Promise<NextResponse> {
  // 1. API key must be configured.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server is missing the ANTHROPIC_API_KEY environment variable." },
      { status: 500 },
    );
  }

  // 2. Parse and validate the request body.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsedBody = requestSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error:
          "Invalid request. Expected { imageBase64: string, mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' }.",
      },
      { status: 400 },
    );
  }

  const imageBase64 = normalizeBase64(parsedBody.data.imageBase64);
  const mediaType = parsedBody.data.mediaType;
  if (!imageBase64) {
    return NextResponse.json(
      { error: "imageBase64 was empty after normalization." },
      { status: 400 },
    );
  }

  const client = new Anthropic({ apiKey });

  // 3-5. Call Claude, validate, retry once on failure, then fall back.
  try {
    // First attempt.
    const firstText = await callClaude(client, imageBase64, mediaType);
    const first = validateResponse(firstText);
    if (first.ok) {
      const payload: GenerateResponse = { layout: first.layout, degraded: false };
      return NextResponse.json(payload);
    }

    // Second attempt: feed the validation error back so the model self-corrects.
    const secondText = await callClaude(
      client,
      imageBase64,
      mediaType,
      first.error,
    );
    const second = validateResponse(secondText);
    if (second.ok) {
      const payload: GenerateResponse = { layout: second.layout, degraded: false };
      return NextResponse.json(payload);
    }

    // Both attempts failed validation — degrade gracefully.
    const payload: GenerateResponse = {
      layout: buildFallbackLayout(),
      degraded: true,
    };
    return NextResponse.json(payload);
  } catch (error) {
    // Surface auth/rate-limit/other API errors clearly, but never leak internals.
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json(
        { error: "The configured ANTHROPIC_API_KEY was rejected by the API." },
        { status: 500 },
      );
    }
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: "The image service is rate limited. Please try again shortly." },
        { status: 503 },
      );
    }
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: `Image service error (${error.status ?? "unknown"}).` },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: "Unexpected error while generating the layout." },
      { status: 500 },
    );
  }
}
