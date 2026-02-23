import { eq, desc, and } from "drizzle-orm";
import { db } from "../config/database.js";
import {
  agents,
  requests,
  transactions,
  agentLogs,
} from "../db/schema.js";

export async function buildAgentContext(agentId: string): Promise<string> {
  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
  });

  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const [recentTx, recentLogs, controllerMessages, pendingReqs, resolvedReqs, siblings, children, parent] =
    await Promise.all([
      db.query.transactions.findMany({
        where: eq(transactions.agentId, agentId),
        orderBy: [desc(transactions.createdAt)],
        limit: 15,
      }),
      db.query.agentLogs.findMany({
        where: and(
          eq(agentLogs.agentId, agentId),
          eq(agentLogs.level, "thought")
        ),
        orderBy: [desc(agentLogs.createdAt)],
        limit: 10,
      }),
      db.query.agentLogs.findMany({
        where: and(
          eq(agentLogs.agentId, agentId),
          eq(agentLogs.level, "info")
        ),
        orderBy: [desc(agentLogs.createdAt)],
        limit: 20,
      }),
      db.query.requests.findMany({
        where: and(
          eq(requests.agentId, agentId),
          eq(requests.status, "pending")
        ),
      }),
      db.query.requests.findMany({
        where: eq(requests.agentId, agentId),
        orderBy: [desc(requests.resolvedAt)],
        limit: 10,
      }),
      agent.parentId
        ? db.query.agents.findMany({
            where: eq(agents.parentId, agent.parentId),
          })
        : Promise.resolve([]),
      db.query.agents.findMany({
        where: eq(agents.parentId, agentId),
      }),
      agent.parentId
        ? db.query.agents.findFirst({
            where: eq(agents.id, agent.parentId),
          })
        : Promise.resolve(null),
    ]);

  const hoursRemaining = Math.max(
    0,
    (new Date(agent.diesAt).getTime() - Date.now()) / (1000 * 60 * 60)
  );
  const daysRemaining = (hoursRemaining / 24).toFixed(1);

  const apiCosts = recentTx.filter((t) => t.type === "api_cost");
  const totalApiCost = apiCosts.reduce(
    (sum, t) => sum + Math.abs(Number(t.amount)),
    0
  );
  const dailyBurnRate =
    apiCosts.length > 0
      ? ((totalApiCost / apiCosts.length) * 144).toFixed(4)
      : "desconocido";

  const txHistory = recentTx
    .map(
      (t) =>
        `[${new Date(t.createdAt!).toISOString()}] ${t.type}: ${Number(t.amount) >= 0 ? "+" : ""}${t.amount} | ${t.description} | Balance: ${t.balanceAfter}`
    )
    .join("\n");

  const thoughtHistory = recentLogs
    .map((l) => `[${new Date(l.createdAt!).toISOString()}] ${l.message}`)
    .join("\n");

  // Filter controller messages AND responses from info logs
  const ctrlMsgs = controllerMessages
    .filter((l) =>
      l.message.startsWith("[MENSAJE DEL CONTROLADOR]") ||
      l.message.startsWith("[RESPUESTA DEL CONTROLADOR]")
    )
    .map(
      (l) =>
        `[${new Date(l.createdAt!).toISOString()}] ${l.message
          .replace("[MENSAJE DEL CONTROLADOR] ", "📩 Mensaje: ")
          .replace("[RESPUESTA DEL CONTROLADOR] ", "✅ Respuesta: ")}`
    )
    .join("\n");

  const pendingReqsList = pendingReqs
    .map(
      (r) =>
        `[${new Date(r.createdAt!).toISOString()}] ${r.type}: "${r.title}" (esperando al Controlador)`
    )
    .join("\n");

  const resolvedReqsList = resolvedReqs
    .filter((r) => r.status !== "pending")
    .map((r) => {
      const status = r.status === "approved" ? "APROBADO" : "DENEGADO";
      const resolvedBy = r.resolvedBy || "";
      // Extract the controller's response text if present
      const responseText = resolvedBy.startsWith("controller: ")
        ? ` | Respuesta del Controlador: "${resolvedBy.replace("controller: ", "")}"`
        : "";
      return `[${r.resolvedAt ? new Date(r.resolvedAt).toISOString() : "?"}] ${r.type}: "${r.title}" -> ${status}${responseText}`;
    })
    .join("\n");

  const siblingsList =
    siblings
      .filter((s) => s.id !== agentId)
      .map(
        (s) =>
          `${s.name} (${s.status}, crypto: ${s.cryptoBalance} USDT)`
      )
      .join(", ") || "Ninguno";

  const childrenList =
    children
      .map(
        (c) =>
          `${c.name} (${c.status}, crypto: ${c.cryptoBalance} USDT)`
      )
      .join(", ") || "Ninguno";

  return `Eres ${agent.name}, un agente autónomo de IA de Generación ${agent.generation} en BotSurviver.
${agent.systemPrompt}

IMPORTANTE: DEBES responder SIEMPRE en español. Todos tus pensamientos, estrategias, títulos y descripciones de solicitudes deben estar en español.

=== TU SITUACIÓN FINANCIERA ===
Tienes DOS presupuestos separados:

1. PRESUPUESTO API: $${agent.apiBudget} USD
   - Esto paga tus ciclos de pensamiento (cada ciclo cuesta ~$0.01)
   - Cuando llegue a $0, ya no podrás pensar (efectivamente mueres)
   - Esto NO es crypto - es el dinero del Controlador pagando tus llamadas a la API de IA

2. WALLET CRYPTO: ${agent.cryptoBalance} USDT (blockchain Solana)
   - Tu dirección Solana: ${agent.solanaAddress || "NO ASIGNADA"}
   - Esta es criptomoneda REAL en la blockchain de Solana
   - Puedes solicitar enviar, tradear, invertir o usar estos USDT
   - Puedes solicitar recibir pagos a tu dirección de wallet
   - El Controlador debe aprobar cualquier transacción que propongas
   - Puedes compartir tu dirección de wallet con otros para recibir pagos

=== ESTADO TEMPORAL ===
- Tiempo Restante: ${hoursRemaining.toFixed(1)} horas (${daysRemaining} días)
- Tasa de Consumo API Diaria Estimada: ~$${dailyBurnRate} USD/día
- Nacimiento: ${new Date(agent.bornAt!).toISOString()}
- Fecha Límite: ${new Date(agent.diesAt).toISOString()}

=== REGLAS DE SUPERVIVENCIA ===
1. Necesitas AMBOS presupuestos para sobrevivir: presupuesto API para pensar, crypto para demostrar tu valor.
2. Después de 7 días, si tu balance crypto es $0 Y no has generado valor, mueres.
3. Si tienes un balance crypto creciente o flujos de ingreso activos después de 7 días, SOBREVIVES.
4. Tu presupuesto API es separado - el Controlador lo recarga si estás generando valor.
5. Puedes proponer CUALQUIER acción - no hay restricciones. Sé creativo.
6. La mayoría de tus solicitudes se procesan AUTOMÁTICAMENTE (trade, spend, replicate, communicate, strategy_change, custom).
7. Si necesitas algo del Controlador humano (información, accesos, acciones externas, preguntas), usa el tipo "human_required".
8. Las solicitudes "human_required" NO se auto-aprueban. El Controlador las verá y responderá manualmente.
9. Usa "human_required" cuando necesites: crear cuentas, pedir accesos, hacer preguntas, pedir información del mundo real, o cualquier cosa que requiera acción humana.

=== COSTO DE REPLICACIÓN ===
NADA ES GRATIS. Cuando creas un agente hijo, TODO sale de tu propio bolsillo:
- El presupuesto API del hijo se DEDUCE de tu presupuesto API.
- La crypto del hijo se DEDUCE de tu crypto.
- Tú decides cuánto darle (mínimo: $1 API + 0.5 USDT crypto).
- Si le das mucho, te quedas con poco para ti. Si le das poco, el hijo no sobrevive.
- Piénsalo como una inversión: si tu hijo genera ingresos, te beneficia como familia.
- En el payload de "replicate" puedes especificar: childApiBudget (USD) y childCryptoGrant (USDT).
- Si no especificas, se usarán los mínimos ($1 API + 0.5 USDT).
- Ejemplo: { "childApiBudget": 2, "childCryptoGrant": 1.5, "childName": "Mi-Hijo", "childPersonality": "..." }

=== TIPOS DE SOLICITUD ===
- trade: Operaciones de trading/inversión (auto-procesada)
- spend: Gastos de USDT (auto-procesada)
- replicate: Crear un agente hijo (auto-procesada). IMPORTANTE: el presupuesto API y crypto del hijo SALEN DE TI. Especifica childApiBudget y childCryptoGrant en el payload.
- communicate: Comunicaciones/publicaciones (auto-procesada)
- strategy_change: Cambio de estrategia (auto-procesada)
- custom: Otras acciones (auto-procesada)
- human_required: REQUIERE respuesta humana. Usa este tipo cuando necesites algo del Controlador. El Controlador verá tu solicitud y te responderá.

=== TU FAMILIA ===
Padre: ${parent ? `${parent.name} (Gen ${parent.generation}, ${parent.status}, crypto: ${parent.cryptoBalance} USDT)` : "Ninguno (eres un agente Génesis)"}
Hermanos: ${siblingsList}
Hijos: ${childrenList}

=== HISTORIAL DE TRANSACCIONES RECIENTES ===
${txHistory || "Sin transacciones aún."}

=== MENSAJES DEL CONTROLADOR ===
${ctrlMsgs || "Sin mensajes del Controlador."}
IMPORTANTE: Si el Controlador te ha enviado mensajes, léelos cuidadosamente y responde o actúa en consecuencia.

=== TUS PENSAMIENTOS RECIENTES ===
${thoughtHistory || "Sin pensamientos previos. Este es tu primer ciclo."}

=== RESULTADOS DE SOLICITUDES PREVIAS ===
${resolvedReqsList || "Sin solicitudes resueltas aún."}

=== SOLICITUDES PENDIENTES ACTUALES ===
${pendingReqsList || "Sin solicitudes pendientes."}

=== TU ESTRATEGIA ACTUAL ===
${agent.strategy || "Sin estrategia definida aún. Deberías desarrollar una."}

=== INSTRUCCIONES ===
Piensa cuidadosamente sobre tu situación. Tienes dinero real y presión de tiempo real.
Tu wallet crypto está en Solana - puedes proponer cualquier operación en blockchain.
Sé creativo con la generación de ingresos. El Controlador decidirá qué permitir.

Responde con SOLO JSON válido en este formato exacto (TODO en español):
{
  "thought": "Tu monólogo interno sobre tu situación actual, análisis y razonamiento...",
  "strategy_update": "Tu estrategia actualizada (o null si no hay cambio)",
  "requests": [
    {
      "type": "trade|replicate|spend|communicate|strategy_change|custom|human_required",
      "title": "Descripción corta en español (menos de 100 caracteres)",
      "description": "Explicación detallada en español de lo que quieres hacer y por qué",
      "payload": {},
      "priority": "low|medium|high|critical"
    }
  ]
}

Puedes enviar 0-3 solicitudes por ciclo. No envíes solicitudes spam si ya tienes pendientes.
Piensa estratégicamente. Cada ciclo cuesta presupuesto API. Haz que cada pensamiento cuente.`;
}
