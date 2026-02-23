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
  Hand,
  Send,
} from "lucide-react";
import { toast } from "sonner";

const typeIcons: Record<string, React.ReactNode> = {
  replicate: <GitBranch className="w-4 h-4" />,
  trade: <ArrowRightLeft className="w-4 h-4" />,
  spend: <DollarSign className="w-4 h-4" />,
  communicate: <MessageSquare className="w-4 h-4" />,
  strategy_change: <Lightbulb className="w-4 h-4" />,
  custom: <Zap className="w-4 h-4" />,
  human_required: <Hand className="w-4 h-4 text-yellow-400" />,
};

const typeLabels: Record<string, string> = {
  replicate: "replicar",
  trade: "trade",
  spend: "gasto",
  communicate: "comunicar",
  strategy_change: "estrategia",
  custom: "custom",
  human_required: "requiere humano",
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
  const [responseText, setResponseText] = useState("");

  const isHumanRequired = request.type === "human_required";

  const handleApprove = async () => {
    setLoading(true);
    try {
      await api.approveRequest(
        request.id,
        isHumanRequired ? responseText || undefined : undefined
      );
      toast.success(`Aprobado: ${request.title}`);
      setResponseText("");
      onAction?.();
    } catch {
      toast.error("Error al aprobar solicitud");
    } finally {
      setLoading(false);
    }
  };

  const handleDeny = async () => {
    setLoading(true);
    try {
      const reason = isHumanRequired && responseText ? responseText : undefined;
      await api.denyRequest(request.id, reason);
      toast.success(`Denegado: ${request.title}`);
      setResponseText("");
      onAction?.();
    } catch {
      toast.error("Error al denegar solicitud");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className={isHumanRequired && request.status === "pending" ? "border-yellow-500/50 bg-yellow-500/5" : ""}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {typeIcons[request.type] || <Zap className="w-4 h-4" />}
            <CardTitle className="text-sm">{request.title}</CardTitle>
            {isHumanRequired && request.status === "pending" && (
              <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-[10px]">
                Esperando respuesta humana
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={priorityColors[request.priority]}>
              {request.priority}
            </Badge>
            <Badge variant="secondary">
              {typeLabels[request.type] || request.type}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            por {request.agent?.name ?? "Desconocido"} (Gen{" "}
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
          <div className="space-y-2 pt-2">
            {isHumanRequired && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={responseText}
                  onChange={(e) => setResponseText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleApprove();
                    }
                  }}
                  placeholder="Escribe tu respuesta para el agente..."
                  className="flex-1 bg-background border border-yellow-500/30 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500/50"
                  disabled={loading}
                />
              </div>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleApprove}
                disabled={loading}
                className="bg-green-600 hover:bg-green-700"
              >
                {isHumanRequired ? (
                  <>
                    <Send className="w-4 h-4 mr-1" />
                    Responder
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-1" />
                    Aprobar
                  </>
                )}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleDeny}
                disabled={loading}
              >
                <X className="w-4 h-4 mr-1" />
                Denegar
              </Button>
            </div>
          </div>
        )}

        {request.status !== "pending" && (
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={
                request.status === "approved"
                  ? "bg-green-500/20 text-green-400"
                  : "bg-red-500/20 text-red-400"
              }
            >
              {request.status === "approved" ? "aprobado" : "denegado"}
            </Badge>
            {request.resolvedBy && request.resolvedBy !== "controller" && request.resolvedBy !== "auto-approve" && (
              <span className="text-xs text-muted-foreground italic">
                {request.resolvedBy.replace("controller: ", "")}
              </span>
            )}
            {request.resolvedBy === "auto-approve" && (
              <span className="text-xs text-muted-foreground italic">
                auto-aprobado
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
