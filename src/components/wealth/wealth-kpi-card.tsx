import { type LucideIcon } from "lucide-react";

interface WealthKPICardProps {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
}

export function WealthKPICard({ label, value, hint, icon: Icon }: WealthKPICardProps) {
  return (
    <div
      className="rounded-lg border p-6"
      style={{ borderColor: "rgba(61, 35, 20, 0.1)", backgroundColor: "#FAF7F2" }}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium" style={{ color: "rgba(61, 35, 20, 0.7)" }}>
            {label}
          </p>
          <p className="text-2xl font-bold" style={{ color: "#3D2314" }}>
            {value}
          </p>
          {hint && (
            <p className="text-xs" style={{ color: "rgba(61, 35, 20, 0.5)" }}>
              {hint}
            </p>
          )}
        </div>
        <div className="rounded-lg p-2" style={{ backgroundColor: "rgba(200, 148, 26, 0.1)" }}>
          <Icon className="h-5 w-5" style={{ color: "#C8941A" }} />
        </div>
      </div>
    </div>
  );
}
