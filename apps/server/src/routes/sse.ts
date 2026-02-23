import { Router } from "express";
import { sseManager } from "../lib/sse-manager.js";

const router = Router();

router.get("/events", (req, res) => {
  sseManager.addClient(res);
});

export default router;
