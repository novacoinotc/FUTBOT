import { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";

export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  // SSE and health endpoints don't require auth
  if (req.path === "/api/health" || req.path === "/api/events") {
    return next();
  }

  const apiKey = req.headers["x-api-key"];

  if (!apiKey || apiKey !== env.API_KEY) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Invalid or missing API key",
      statusCode: 401,
    });
  }

  next();
}
