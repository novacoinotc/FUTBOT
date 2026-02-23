"use client";

import { useState } from "react";
import { useRequests } from "@/hooks/use-requests";
import { RequestCard } from "@/components/requests/request-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { Check, X } from "lucide-react";

export default function RequestsPage() {
  const [filter, setFilter] = useState<string | undefined>("pending");
  const { data, mutate } = useRequests(
    filter ? { status: filter } : undefined
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const requests = data?.data ?? [];

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkAction = async (action: "approve" | "deny") => {
    if (selected.size === 0) return;
    try {
      await api.bulkAction(Array.from(selected), action);
      toast.success(
        `${action === "approve" ? "Approved" : "Denied"} ${selected.size} requests`
      );
      setSelected(new Set());
      mutate();
    } catch {
      toast.error("Bulk action failed");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Request Queue</h1>
          <p className="text-muted-foreground text-sm">
            Review and manage agent requests
          </p>
        </div>

        {selected.size > 0 && filter === "pending" && (
          <div className="flex gap-2">
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700"
              onClick={() => handleBulkAction("approve")}
            >
              <Check className="w-4 h-4 mr-1" />
              Approve {selected.size}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => handleBulkAction("deny")}
            >
              <X className="w-4 h-4 mr-1" />
              Deny {selected.size}
            </Button>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        {["pending", "approved", "denied", undefined].map((s) => (
          <Button
            key={s ?? "all"}
            variant={filter === s ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(s)}
          >
            {s ?? "All"}
            {s === "pending" && data && (
              <Badge variant="secondary" className="ml-1">
                {data.total}
              </Badge>
            )}
          </Button>
        ))}
      </div>

      <div className="space-y-3">
        {requests.map((request) => (
          <div key={request.id} className="flex gap-2 items-start">
            {filter === "pending" && (
              <input
                type="checkbox"
                checked={selected.has(request.id)}
                onChange={() => toggleSelect(request.id)}
                className="mt-4 accent-green-500"
              />
            )}
            <div className="flex-1">
              <RequestCard request={request} onAction={() => mutate()} />
            </div>
          </div>
        ))}

        {requests.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            No {filter} requests
          </div>
        )}
      </div>
    </div>
  );
}
