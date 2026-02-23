import { Router } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db } from "../config/database.js";
import { requests, agents } from "../db/schema.js";
import { processApprovedRequest } from "../services/request-processor.js";
import { sseManager } from "../lib/sse-manager.js";
import type { RequestStatus, RequestType } from "@botsurviver/shared";

const router = Router();

// List requests
router.get("/", async (req, res) => {
  const status = req.query.status as RequestStatus | undefined;
  const type = req.query.type as RequestType | undefined;
  const agentId = req.query.agent_id as string | undefined;

  const conditions = [];
  if (status) conditions.push(eq(requests.status, status));
  if (type) conditions.push(eq(requests.type, type));
  if (agentId) conditions.push(eq(requests.agentId, agentId));

  const allRequests = await db.query.requests.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [desc(requests.createdAt)],
    with: {
      agent: {
        columns: { id: true, name: true, generation: true, status: true },
      },
    },
  });

  res.json({ data: allRequests, total: allRequests.length });
});

// Get request by ID
router.get("/:id", async (req, res) => {
  const { id } = req.params;

  const request = await db.query.requests.findFirst({
    where: eq(requests.id, id),
    with: {
      agent: true,
    },
  });

  if (!request) {
    return res.status(404).json({ error: "Request not found" });
  }

  res.json(request);
});

// Approve request
router.post("/:id/approve", async (req, res) => {
  const { id } = req.params;

  const request = await db.query.requests.findFirst({
    where: eq(requests.id, id),
  });

  if (!request) {
    return res.status(404).json({ error: "Request not found" });
  }

  if (request.status !== "pending") {
    return res
      .status(400)
      .json({ error: `Request already ${request.status}` });
  }

  // Update request status
  const [updated] = await db
    .update(requests)
    .set({
      status: "approved",
      resolvedAt: new Date(),
      resolvedBy: "controller",
    })
    .where(eq(requests.id, id))
    .returning();

  // Process side effects
  try {
    await processApprovedRequest({
      id: updated.id,
      agentId: updated.agentId,
      type: updated.type as RequestType,
      title: updated.title,
      description: updated.description,
      payload: (updated.payload as Record<string, unknown>) || {},
    });
  } catch (error) {
    console.error(`Error processing request ${id}:`, error);
  }

  sseManager.broadcast({
    type: "request_resolved",
    data: { requestId: id, status: "approved" },
  });

  res.json(updated);
});

// Deny request
router.post("/:id/deny", async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  const request = await db.query.requests.findFirst({
    where: eq(requests.id, id),
  });

  if (!request) {
    return res.status(404).json({ error: "Request not found" });
  }

  if (request.status !== "pending") {
    return res
      .status(400)
      .json({ error: `Request already ${request.status}` });
  }

  const [updated] = await db
    .update(requests)
    .set({
      status: "denied",
      resolvedAt: new Date(),
      resolvedBy: reason ? `controller: ${reason}` : "controller",
    })
    .where(eq(requests.id, id))
    .returning();

  sseManager.broadcast({
    type: "request_resolved",
    data: { requestId: id, status: "denied" },
  });

  res.json(updated);
});

// Bulk approve/deny
router.post("/bulk", async (req, res) => {
  const { ids, action } = req.body;

  if (!Array.isArray(ids) || !["approve", "deny"].includes(action)) {
    return res.status(400).json({ error: "Invalid bulk action" });
  }

  const results = [];

  for (const id of ids) {
    try {
      const request = await db.query.requests.findFirst({
        where: and(eq(requests.id, id), eq(requests.status, "pending")),
      });

      if (!request) continue;

      const [updated] = await db
        .update(requests)
        .set({
          status: action === "approve" ? "approved" : "denied",
          resolvedAt: new Date(),
          resolvedBy: "controller (bulk)",
        })
        .where(eq(requests.id, id))
        .returning();

      if (action === "approve") {
        await processApprovedRequest({
          id: updated.id,
          agentId: updated.agentId,
          type: updated.type as RequestType,
          title: updated.title,
          description: updated.description,
          payload: (updated.payload as Record<string, unknown>) || {},
        });
      }

      results.push({ id, status: action === "approve" ? "approved" : "denied" });
    } catch (error) {
      results.push({
        id,
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  sseManager.broadcast({
    type: "bulk_action_complete",
    data: { results },
  });

  res.json({ results });
});

export default router;
