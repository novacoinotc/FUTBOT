import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env.js";

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

export interface AgentThoughtResponse {
  thought: string;
  strategy_update: string | null;
  requests: Array<{
    type: string;
    title: string;
    description: string;
    payload: Record<string, unknown>;
    priority: string;
  }>;
  apiCost: number;
}

export async function getAgentThought(
  systemPrompt: string
): Promise<AgentThoughtResponse> {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content:
          "It is now your thinking cycle. Analyze your situation and respond with your thought, strategy update, and any requests you want to make. Respond ONLY with valid JSON.",
      },
    ],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  // Parse JSON, handling potential markdown code blocks
  let jsonText = textBlock.text.trim();
  if (jsonText.startsWith("```")) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const parsed = JSON.parse(jsonText);

  // Calculate cost (Sonnet 4 pricing: $3/M input, $15/M output)
  const inputCost = (message.usage.input_tokens / 1_000_000) * 3;
  const outputCost = (message.usage.output_tokens / 1_000_000) * 15;
  const totalCost = inputCost + outputCost;

  return {
    thought: parsed.thought || "No thought provided",
    strategy_update: parsed.strategy_update || null,
    requests: Array.isArray(parsed.requests) ? parsed.requests.slice(0, 3) : [],
    apiCost: totalCost,
  };
}
