"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, type RequestWithAgent } from "@/lib/api-client";
import {
  Check,
  X,
  GitBranch,
  ArrowRightLeft,
  DollarSign,
  MessageSquare,
  Lightbulb,
  Zap,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";

const typeIcons: Record<string, React.ReactNode> = {
  replicate: <GitBranch className="w-4 h-4" />,
  trade: <ArrowRightLeft className="w-4 h-4" />,
  spend: <DollarSign className="w-4 h-4" />,
  communicate: <MessageSquare className="w-4 h-4" />,
  strategy_change: <Lightbulb className="w-4 h-4" />,
  custom: <Zap className="w-4 h-4" />,
};

const priorityColors: Record<string, string> = {
  low: "bg-gray-500/20 text-gray-400",
  medium: "bg-blue-500/20 text-blue-400",
  high: "bg-orange-500/20 text-orange-400",
  critical: "bg-red-500/20 text-red-400",
};

export function RequestCard({
  request,
  onAction,
}: {
  request: RequestWithAgent;
  onAction?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleApprove = async () => {
    setLoading(true);
    try {
      await api.approveRequest(request.id);
      toast.success(`Approved: ${request.title}`);
      onAction?.();
    } catch {
      toast.error("Failed to approve request");
    } finally {
      setLoading(false);
    }
  };

  const handleDeny = async () => {
    setLoading(true);
    try {
      await api.denyRequest(request.id);
      toast.success(`Denied: ${request.title}`);
      onAction?.();
    } catch {
      toast.error("Failed to deny request");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {typeIcons[request.type] || <Zap className="w-4 h-4" />}
            <CardTitle className="text-sm">{request.title}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={priorityColors[request.priority]}>
              {request.priority}
            </Badge>
            <Badge variant="secondary">{request.type}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            by {request.agent?.name ?? "Unknown"} (Gen{" "}
            {request.agent?.generation ?? "?"})
          </span>
          <span>
            {new Date(request.createdAt).toLocaleString()}
          </span>
        </div>

        <p className="text-sm">{request.description}</p>

        {Object.keys(request.payload || {}).length > 0 && (
          <div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {expanded ? (
                <ChevronUp className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
              Payload
            </button>
            {expanded && (
              <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto max-h-48">
                {JSON.stringify(request.payload, null, 2)}
              </pre>
            )}
          </div>
        )}

        {request.status === "pending" && (
          <div className="flex gap-2 pt-2">
            <Button
              size="sm"
              onClick={handleApprove}
              disabled={loading}
              className="bg-green-600 hover:bg-green-700"
            >
              <Check className="w-4 h-4 mr-1" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleDeny}
              disabled={loading}
            >
              <X className="w-4 h-4 mr-1" />
              Deny
            </Button>
          </div>
        )}

        {request.status !== "pending" && (
          <Badge
            variant="outline"
            className={
              request.status === "approved"
                ? "bg-green-500/20 text-green-400"
                : "bg-red-500/20 text-red-400"
            }
          >
            {request.status}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}
