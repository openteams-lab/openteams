import React from "react";
import { Loader2 } from "lucide-react";

interface AgentRunStatusPillProps {
  label?: string;
}

export const AgentRunStatusPill: React.FC<AgentRunStatusPillProps> = ({
  label = "正在执行",
}) => (
  <div className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary-tint)] px-2 py-1 text-[var(--primary)]">
    <Loader2 className="h-3 w-3 animate-spin" />
    <span className="font-mono text-[11px]">{label}</span>
  </div>
);
