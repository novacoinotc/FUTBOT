import {
  pgTable,
  uuid,
  text,
  timestamp,
  decimal,
  jsonb,
  integer,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Enums
export const agentStatusEnum = pgEnum("agent_status", [
  "alive",
  "dead",
  "pending",
]);

export const requestTypeEnum = pgEnum("request_type", [
  "replicate",
  "trade",
  "spend",
  "communicate",
  "strategy_change",
  "custom",
]);

export const requestStatusEnum = pgEnum("request_status", [
  "pending",
  "approved",
  "denied",
]);

export const transactionTypeEnum = pgEnum("transaction_type", [
  "income",
  "expense",
  "transfer",
  "birth_grant",
  "api_cost",
]);

export const logLevelEnum = pgEnum("log_level", [
  "thought",
  "info",
  "warn",
  "error",
]);

export const requestPriorityEnum = pgEnum("request_priority", [
  "low",
  "medium",
  "high",
  "critical",
]);

// Tables
export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentId: uuid("parent_id"),
    generation: integer("generation").notNull().default(0),
    name: text("name").notNull(),
    systemPrompt: text("system_prompt").notNull(),
    strategy: text("strategy"),
    walletBalance: decimal("wallet_balance", { precision: 18, scale: 8 })
      .notNull()
      .default("0"),
    status: agentStatusEnum("status").notNull().default("pending"),
    bornAt: timestamp("born_at", { withTimezone: true }).defaultNow(),
    diesAt: timestamp("dies_at", { withTimezone: true }).notNull(),
    lastThoughtAt: timestamp("last_thought_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  },
  (table) => [
    index("idx_agents_status").on(table.status),
    index("idx_agents_parent").on(table.parentId),
  ]
);

export const requests = pgTable(
  "requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    type: requestTypeEnum("type").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
    status: requestStatusEnum("status").notNull().default("pending"),
    priority: requestPriorityEnum("priority").notNull().default("medium"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
  },
  (table) => [
    index("idx_requests_status").on(table.status),
    index("idx_requests_agent").on(table.agentId),
    index("idx_requests_created").on(table.createdAt),
  ]
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    amount: decimal("amount", { precision: 18, scale: 8 }).notNull(),
    type: transactionTypeEnum("type").notNull(),
    description: text("description").notNull(),
    balanceAfter: decimal("balance_after", {
      precision: 18,
      scale: 8,
    }).notNull(),
    referenceId: uuid("reference_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_transactions_agent").on(table.agentId),
    index("idx_transactions_created").on(table.createdAt),
  ]
);

export const agentLogs = pgTable(
  "agent_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    level: logLevelEnum("level").notNull(),
    message: text("message").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_logs_agent").on(table.agentId),
    index("idx_logs_level").on(table.level),
  ]
);

export const agentMetrics = pgTable(
  "agent_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    metricName: text("metric_name").notNull(),
    metricValue: decimal("metric_value", {
      precision: 18,
      scale: 8,
    }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_metrics_agent_name").on(table.agentId, table.metricName),
  ]
);

// Relations
export const agentsRelations = relations(agents, ({ one, many }) => ({
  parent: one(agents, {
    fields: [agents.parentId],
    references: [agents.id],
    relationName: "parent_child",
  }),
  children: many(agents, { relationName: "parent_child" }),
  requests: many(requests),
  transactions: many(transactions),
  logs: many(agentLogs),
  metrics: many(agentMetrics),
}));

export const requestsRelations = relations(requests, ({ one }) => ({
  agent: one(agents, {
    fields: [requests.agentId],
    references: [agents.id],
  }),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  agent: one(agents, {
    fields: [transactions.agentId],
    references: [agents.id],
  }),
}));

export const agentLogsRelations = relations(agentLogs, ({ one }) => ({
  agent: one(agents, {
    fields: [agentLogs.agentId],
    references: [agents.id],
  }),
}));

export const agentMetricsRelations = relations(agentMetrics, ({ one }) => ({
  agent: one(agents, {
    fields: [agentMetrics.agentId],
    references: [agents.id],
  }),
}));
