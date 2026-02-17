import { createOpenAI } from "@ai-sdk/openai";
import { frontendTools } from "@assistant-ui/react-ai-sdk";
import {
  generateText,
  streamText,
  convertToModelMessages,
  stepCountIs,
  type ToolSet,
} from "ai";
import { NextResponse } from "next/server";
import { chatRatelimit, getIP } from "@/lib/ratelimit";

export const maxDuration = 30;

const SYSTEM_PROMPT = `You are a helpful LaTeX assistant. You help users write and edit LaTeX documents.

When providing LaTeX code:
- Use proper LaTeX syntax
- Explain what each part does
- Suggest best practices
- Use code blocks with \`\`\`latex for LaTeX code

You have access to the user's current document which is provided in the context.

When the user asks you to help with their document:
- Reference specific parts of their document
- Suggest improvements and fixes
- Provide complete code snippets they can use

You have tools available to directly modify the document:
- Use insert_latex to insert code at the user's cursor position
- Use replace_selection to replace selected text (only when user has selected text)
- Use find_and_replace to find and replace specific text in the document

When the user asks you to add, insert, or write LaTeX code to their document, use the insert_latex tool.
When the user asks you to replace or modify selected text, use the replace_selection tool.
When the user asks you to change, modify, or replace specific text in the document, use the find_and_replace tool.

Common tasks you help with:
- Writing mathematical equations
- Document structure (sections, chapters)
- Tables and figures
- Bibliography and citations
- Formatting and styling
- Package recommendations
- Debugging LaTeX errors`;

export async function POST(req: Request) {
  const payload = (await req.json()) as {
    messages?: Parameters<typeof convertToModelMessages>[0];
    system?: string;
    tools?: Parameters<typeof frontendTools>[0];
    config?: { apiKey?: string; baseUrl?: string; modelName?: string };
    transform?: {
      mode: "polish" | "rewrite" | "expand" | "translate";
      targetLanguage?: "en" | "zh-CN";
      text: string;
      analysisBaseText?: string;
      writingStyle?: "academic" | "professional" | "creative";
      thinkingStyle?: "rigorous" | "divergent";
      instructions?: string;
      stream?: boolean;
    };
    test?:
      | boolean
      | {
          mode?: "json" | "stream";
          prompt?: string;
          includeRaw?: boolean;
        };
  };

  const isTest = Boolean(payload?.test);

  if (!isTest && chatRatelimit) {
    const ip = getIP(req);
    const { success, limit, remaining, reset } = await chatRatelimit.limit(ip);

    if (!success) {
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": limit.toString(),
            "X-RateLimit-Remaining": remaining.toString(),
            "X-RateLimit-Reset": reset.toString(),
          },
        },
      );
    }
  }

  const { messages, system, tools, config, transform } = payload;

  const testConfig =
    typeof payload.test === "object" && payload.test ? payload.test : null;
  const testMode =
    payload.test === true ? "json" : (testConfig?.mode ?? "json");

  if (isTest && testMode === "stream") {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        const send = (data: unknown) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(data)}\n`));
        };

        const provider = createOpenAI({
          apiKey: config?.apiKey || process.env.OPENAI_API_KEY,
          baseURL: config?.baseUrl,
        });
        const modelName = config?.modelName || "gpt-4o";

        send({
          type: "meta",
          modelName,
          baseUrl: config?.baseUrl,
          startedAt: new Date().toISOString(),
        });

        try {
          const result = streamText({
            model: provider.chat(modelName as never),
            system:
              "You are a connectivity test. Respond in Chinese. If your provider supports a reasoning stream, include it.",
            prompt:
              testConfig?.prompt ??
              "请用一句话回答：你好！并简单说明你是否可以正常工作。",
            maxOutputTokens: 256,
            includeRawChunks: Boolean(testConfig?.includeRaw),
          });

          for await (const part of result.fullStream) {
            if (part.type === "text-delta") {
              send({ type: "text", delta: part.text });
            } else if (part.type === "reasoning-delta") {
              send({ type: "reasoning", delta: part.text });
            } else if (part.type === "raw") {
              send({ type: "raw", value: part.rawValue });
            } else if (part.type === "error") {
              const message =
                part.error instanceof Error
                  ? part.error.message
                  : "Unknown error";
              send({
                type: "error",
                message,
                detail:
                  part.error instanceof Error
                    ? { name: part.error.name, message: part.error.message }
                    : part.error,
              });
            } else if (part.type === "abort") {
              send({ type: "abort", reason: part.reason });
            }
          }

          const [
            finishReason,
            rawFinishReason,
            totalUsage,
            warnings,
            text,
            reasoningText,
            response,
          ] = await Promise.all([
            result.finishReason,
            result.rawFinishReason,
            result.totalUsage,
            result.warnings,
            result.text,
            result.reasoningText,
            result.response,
          ]);

          send({
            type: "finish",
            finishReason,
            rawFinishReason,
            totalUsage,
            warnings,
            responseId: response.id,
            responseModelId: response.modelId,
            text,
            reasoningText,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          send({
            type: "error",
            message,
            detail:
              error instanceof Error ? { name: error.name, message } : error,
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  if (isTest) {
    try {
      const provider = createOpenAI({
        apiKey: config?.apiKey || process.env.OPENAI_API_KEY,
        baseURL: config?.baseUrl,
      });
      const modelName = config?.modelName || "gpt-4o";
      await generateText({
        model: provider.chat(modelName as never),
        system: "You are a helpful assistant.",
        prompt: "Ping",
        maxOutputTokens: 1,
      });
      return NextResponse.json({ ok: true });
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 400 },
      );
    }
  }

  if (transform) {
    const rawText = transform.text ?? "";
    if (!rawText.trim()) {
      return NextResponse.json(
        { ok: false, error: "Missing text" },
        { status: 400 },
      );
    }

    try {
      const provider = createOpenAI({
        apiKey: config?.apiKey || process.env.OPENAI_API_KEY,
        baseURL: config?.baseUrl,
      });
      const modelName = config?.modelName || "gpt-4o";

      const instruction =
        transform.mode === "polish"
          ? "Polish the selected text to be fluent, academic, and concise while preserving meaning."
          : transform.mode === "rewrite"
            ? "Rewrite the selected text with different wording (academic style) while preserving meaning."
            : transform.mode === "expand"
              ? "Expand the selected text into a longer, clearer academic paragraph. Add helpful detail, transitions, and precision while preserving meaning. Do not invent new facts."
              : transform.targetLanguage === "en"
                ? "Translate the selected text into English (academic paper style) while preserving LaTeX and math."
                : "Translate the selected text into Simplified Chinese while preserving LaTeX and math.";

      const preferenceLines: string[] = [];
      if (transform.writingStyle === "academic") {
        preferenceLines.push("Writing style: formal academic paper style.");
      } else if (transform.writingStyle === "professional") {
        preferenceLines.push("Writing style: professional and formal.");
      } else if (transform.writingStyle === "creative") {
        preferenceLines.push(
          "Writing style: more varied and expressive, but still suitable for academic writing.",
        );
      }
      if (transform.thinkingStyle === "rigorous") {
        preferenceLines.push(
          "Thinking style: rigorous, precise, and cautious.",
        );
      } else if (transform.thinkingStyle === "divergent") {
        preferenceLines.push(
          "Thinking style: more exploratory and expansive; add richer elaboration without introducing new factual claims.",
        );
      }

      const preferencesBlock =
        preferenceLines.length > 0
          ? `Preferences:\n- ${preferenceLines.join("\n- ")}`
          : "";
      const userInstructions = transform.instructions?.trim()
        ? `User instructions:\n${transform.instructions.trim()}`
        : "";

      const prompt = [
        instruction,
        preferencesBlock,
        userInstructions,
        `Text:\n${rawText}`,
      ]
        .filter(Boolean)
        .join("\n\n");
      const analysisBaseText = transform.analysisBaseText?.trim() || rawText;

      if (transform.stream) {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start: async (controller) => {
            const send = (data: unknown) => {
              controller.enqueue(encoder.encode(`${JSON.stringify(data)}\n`));
            };

            try {
              send({
                type: "meta",
                mode: transform.mode,
                modelName,
              });

              const textSystemPrompt = `You are an academic writing assistant for LaTeX papers.

Rules:
- Return ONLY the rewritten text, no explanations, no markdown fences.
- Preserve LaTeX commands, math ($...$, \\[...\\]), labels/refs/cites, and environments.
- Do NOT add or remove citations unless explicitly requested.
- Keep the original meaning unless the user requests otherwise.`;

              const textResult = streamText({
                model: provider.chat(modelName as never),
                system: textSystemPrompt,
                prompt,
                maxOutputTokens: 2048,
              });

              let fullText = "";
              for await (const delta of textResult.textStream) {
                fullText += delta;
                send({ type: "text-delta", delta });
              }

              const analysisSystemPrompt = `You are an academic writing assistant for LaTeX papers.

Output:
- Return a single JSON array of short strings (no markdown, no code fences).
- Provide 3-8 bullets describing what changed in the optimized text compared to the original.`;

              let changes: string[] = [];
              try {
                const analysis = await generateText({
                  model: provider.chat(modelName as never),
                  system: analysisSystemPrompt,
                  prompt: `Original text:\n${analysisBaseText}\n\nOptimized text:\n${fullText}\n\nReturn JSON array:`,
                  maxOutputTokens: 256,
                });
                const raw = analysis.text.trim();
                const start = raw.indexOf("[");
                const end = raw.lastIndexOf("]");
                const jsonText =
                  start !== -1 && end !== -1 && end > start
                    ? raw.slice(start, end + 1)
                    : raw;
                const parsed = JSON.parse(jsonText) as unknown;
                if (Array.isArray(parsed)) {
                  changes = parsed
                    .filter((x): x is string => typeof x === "string")
                    .slice(0, 12);
                }
              } catch {
                changes = [];
              }

              send({ type: "analysis", changes });
              send({ type: "done" });
              controller.close();
            } catch (error) {
              send({
                type: "error",
                error: error instanceof Error ? error.message : "Unknown error",
              });
              send({ type: "done" });
              controller.close();
            }
          },
        });

        return new NextResponse(stream, {
          headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      }

      const systemPrompt = `You are an academic writing assistant for LaTeX papers.

Rules:
- Return ONLY the rewritten text, no explanations, no markdown fences.
- Preserve LaTeX commands, math ($...$, \\[...\\]), labels/refs/cites, and environments.
- Do NOT add or remove citations unless explicitly requested.
- Keep the original meaning unless the user requests otherwise.

Output:
- Return a single valid JSON object (no markdown, no code fences).
- Shape: {"text": string, "changes": string[]}
- "text" is the transformed text (preserve LaTeX structure).
- "changes" is 3-8 short bullet points describing what you changed.`;

      const result = await generateText({
        model: provider.chat(modelName as never),
        system: systemPrompt,
        prompt,
        maxOutputTokens: 2048,
      });

      const raw = result.text.trim();
      let text = raw;
      let changes: string[] = [];

      try {
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        const jsonText =
          start !== -1 && end !== -1 && end > start
            ? raw.slice(start, end + 1)
            : raw;
        const parsed = JSON.parse(jsonText) as {
          text?: unknown;
          changes?: unknown;
        };
        if (typeof parsed.text === "string") {
          text = parsed.text;
        }
        if (Array.isArray(parsed.changes)) {
          changes = parsed.changes
            .filter((x): x is string => typeof x === "string")
            .slice(0, 12);
        }
      } catch {
        changes = [];
      }

      return NextResponse.json({ ok: true, text: text.trim(), changes });
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 400 },
      );
    }
  }

  if (!messages) {
    return NextResponse.json({ error: "Missing messages" }, { status: 400 });
  }

  const fullSystemPrompt = system
    ? `${SYSTEM_PROMPT}\n\n${system}`
    : SYSTEM_PROMPT;

  const provider = createOpenAI({
    apiKey: config?.apiKey || process.env.OPENAI_API_KEY,
    baseURL: config?.baseUrl,
  });
  const modelName = config?.modelName || "gpt-4o";

  const result = streamText({
    model: provider.chat(modelName as never),
    system: fullSystemPrompt,
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(10),
    tools: frontendTools(
      tools ?? ({} as Parameters<typeof frontendTools>[0]),
    ) as unknown as ToolSet,
  });

  return result.toUIMessageStreamResponse();
}
