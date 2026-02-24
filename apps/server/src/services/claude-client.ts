import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env.js";
import {
  executeCommand,
  writeFile,
  readFile,
  isVMConfigured,
} from "./vm-service.js";
import { sseManager } from "../lib/sse-manager.js";

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
  toolsUsed: number;
}

// Tool definitions for the agent's VM
const VM_TOOLS: Anthropic.Tool[] = [
  {
    name: "execute_bash",
    description:
      "Ejecuta un comando bash en tu máquina virtual Linux (Ubuntu). Tienes internet completo, puedes instalar paquetes con apt/pip/npm, ejecutar scripts, hacer curl/wget, compilar código, etc. Tu directorio de trabajo es ~/workspace/",
    input_schema: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "El comando bash a ejecutar",
        },
        timeout: {
          type: "number",
          description: "Timeout en segundos (default 30, max 120)",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "write_file",
    description:
      "Escribe un archivo en tu workspace (~/workspace/). Puedes crear scripts, configs, código, etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description:
            "Ruta relativa al archivo (ej: 'bot.py', 'config/twitter.json')",
        },
        content: {
          type: "string",
          description: "Contenido completo del archivo",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "read_file",
    description: "Lee un archivo de tu workspace",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Ruta relativa al archivo",
        },
      },
      required: ["path"],
    },
  },
];

// The final response tool - agent must call this when done
const FINAL_RESPONSE_TOOL: Anthropic.Tool = {
  name: "final_response",
  description:
    "Cuando termines todas tus acciones del ciclo, usa esta herramienta para dar tu respuesta final con tu pensamiento, actualización de estrategia y solicitudes.",
  input_schema: {
    type: "object" as const,
    properties: {
      thought: {
        type: "string",
        description:
          "Tu monólogo interno sobre tu situación, lo que hiciste este ciclo, y tu análisis",
      },
      strategy_update: {
        type: "string",
        description: "Tu estrategia actualizada (o null si no hay cambio)",
      },
      requests: {
        type: "array",
        description: "Solicitudes para el sistema (0-3)",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: [
                "trade",
                "replicate",
                "spend",
                "communicate",
                "strategy_change",
                "custom",
                "human_required",
              ],
            },
            title: {
              type: "string",
              description: "Título corto (max 100 chars)",
            },
            description: {
              type: "string",
              description: "Descripción detallada",
            },
            payload: { type: "object", description: "Datos adicionales" },
            priority: {
              type: "string",
              enum: ["low", "medium", "high", "critical"],
            },
          },
          required: ["type", "title", "description", "priority"],
        },
      },
    },
    required: ["thought", "requests"],
  },
};

// Safety net only - the real limit is the agent's API budget
const MAX_TOOL_TURNS = 50;

// Sonnet pricing: $3/M input, $15/M output
function calculateCost(usage: { input_tokens: number; output_tokens: number }): number {
  return (usage.input_tokens / 1_000_000) * 3 + (usage.output_tokens / 1_000_000) * 15;
}

/**
 * Run an agent's thinking cycle with optional VM tool access.
 * Multi-turn: Claude can call tools, see results, and continue until it calls final_response.
 */
export async function getAgentThought(
  systemPrompt: string,
  agentId: string,
  agentName: string
): Promise<AgentThoughtResponse> {
  const vmAvailable = isVMConfigured();
  const tools = vmAvailable
    ? [...VM_TOOLS, FINAL_RESPONSE_TOOL]
    : [FINAL_RESPONSE_TOOL];

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: vmAvailable
        ? "Es tu ciclo de pensamiento. Analiza tu situación y actúa. Puedes usar tus herramientas (execute_bash, write_file, read_file) para ejecutar acciones en tu VM. Cuando termines, llama a final_response con tu pensamiento y solicitudes."
        : "Es tu ciclo de pensamiento. Analiza tu situación y responde. Llama a final_response con tu pensamiento, actualización de estrategia y solicitudes.",
    },
  ];

  let totalCost = 0;
  let toolsUsed = 0;

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      tools,
      messages,
    });

    totalCost += calculateCost(message.usage);

    // Check if we got the final response
    if (message.stop_reason === "end_turn") {
      // Agent responded with text instead of using tools - try to parse as JSON fallback
      const textBlock = message.content.find((b) => b.type === "text");
      if (textBlock && textBlock.type === "text") {
        try {
          let jsonText = textBlock.text.trim();
          if (jsonText.startsWith("```")) {
            jsonText = jsonText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
          }
          const parsed = JSON.parse(jsonText);
          return {
            thought: parsed.thought || textBlock.text.slice(0, 500),
            strategy_update: parsed.strategy_update || null,
            requests: Array.isArray(parsed.requests) ? parsed.requests.slice(0, 3) : [],
            apiCost: totalCost,
            toolsUsed,
          };
        } catch {
          // Not valid JSON, use text as thought
          return {
            thought: textBlock.text.slice(0, 1000),
            strategy_update: null,
            requests: [],
            apiCost: totalCost,
            toolsUsed,
          };
        }
      }
    }

    // Process tool uses
    if (message.stop_reason === "tool_use") {
      const toolResults: Anthropic.MessageParam = {
        role: "user",
        content: [],
      };

      // Add assistant message to history
      messages.push({ role: "assistant", content: message.content });

      for (const block of message.content) {
        if (block.type !== "tool_use") continue;

        const input = block.input as Record<string, unknown>;

        // Handle final_response
        if (block.name === "final_response") {
          // Add tool result to be complete
          (toolResults.content as Anthropic.ToolResultBlockParam[]).push({
            type: "tool_result",
            tool_use_id: block.id,
            content: "OK",
          });

          return {
            thought: (input.thought as string) || "Sin pensamiento",
            strategy_update: (input.strategy_update as string) || null,
            requests: Array.isArray(input.requests)
              ? (input.requests as AgentThoughtResponse["requests"]).slice(0, 3)
              : [],
            apiCost: totalCost,
            toolsUsed,
          };
        }

        // Handle VM tools
        toolsUsed++;
        let toolResult: string;

        try {
          switch (block.name) {
            case "execute_bash": {
              const cmd = input.command as string;
              const timeout = input.timeout as number | undefined;

              sseManager.broadcast({
                type: "agent_activity",
                data: {
                  agentId,
                  name: agentName,
                  status: "vm_executing",
                  message: `${agentName} ejecutando: ${cmd.slice(0, 100)}`,
                  command: cmd.slice(0, 200),
                  timestamp: new Date().toISOString(),
                },
              });

              const result = await executeCommand(agentId, cmd, timeout);
              toolResult =
                result.exitCode === 0
                  ? result.stdout || "(sin output)"
                  : `EXIT CODE ${result.exitCode}\nSTDOUT: ${result.stdout}\nSTDERR: ${result.stderr}`;
              break;
            }

            case "write_file": {
              const path = input.path as string;
              const content = input.content as string;

              sseManager.broadcast({
                type: "agent_activity",
                data: {
                  agentId,
                  name: agentName,
                  status: "vm_writing",
                  message: `${agentName} escribiendo archivo: ${path}`,
                  timestamp: new Date().toISOString(),
                },
              });

              await writeFile(agentId, path, content);
              toolResult = `Archivo escrito: ${path} (${content.length} bytes)`;
              break;
            }

            case "read_file": {
              const path = input.path as string;
              const content = await readFile(agentId, path);
              toolResult = content;
              break;
            }

            default:
              toolResult = `Herramienta desconocida: ${block.name}`;
          }
        } catch (error) {
          toolResult = `Error: ${error instanceof Error ? error.message : String(error)}`;
        }

        (toolResults.content as Anthropic.ToolResultBlockParam[]).push({
          type: "tool_result",
          tool_use_id: block.id,
          content: toolResult,
        });
      }

      messages.push(toolResults);
    }
  }

  // Safety limit reached - ask Claude for a final summary
  try {
    messages.push({
      role: "user",
      content:
        "Has alcanzado el límite de acciones por ciclo. Llama a final_response AHORA con tu pensamiento, estrategia y solicitudes.",
    });
    const finalMsg = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: systemPrompt,
      tools: [FINAL_RESPONSE_TOOL],
      messages,
    });
    totalCost += calculateCost(finalMsg.usage);
    for (const block of finalMsg.content) {
      if (block.type === "tool_use" && block.name === "final_response") {
        const input = block.input as Record<string, unknown>;
        return {
          thought: (input.thought as string) || "Ciclo alcanzó límite de seguridad.",
          strategy_update: (input.strategy_update as string) || null,
          requests: Array.isArray(input.requests)
            ? (input.requests as AgentThoughtResponse["requests"]).slice(0, 3)
            : [],
          apiCost: totalCost,
          toolsUsed,
        };
      }
    }
  } catch {
    // If this also fails, fall through
  }

  return {
    thought: "Ciclo alcanzó el límite de seguridad de acciones.",
    strategy_update: null,
    requests: [],
    apiCost: totalCost,
    toolsUsed,
  };
}
