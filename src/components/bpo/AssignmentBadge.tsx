// src/components/bpo/AssignmentBadge.tsx
// Badge mostrando os 3 papéis (titular/backup/supervisor) com semáforo

"use client";

interface Props {
  titular?: string | null;
  backup?: string | null;
  supervisor?: string | null;
  completo?: boolean;
  motivos?: string[];
  compact?: boolean;
}

export default function AssignmentBadge({
  titular,
  backup,
  supervisor,
  completo,
  motivos,
  compact,
}: Props) {
  const Slot = ({ label, email, sla }: { label: string; email?: string | null; sla: string }) => (
    <div className="flex items-center gap-1.5">
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          email ? "bg-emerald-500" : "bg-red-500"
        }`}
        title={email || sla}
      />
      {!compact && (
        <span className="text-xs">
          <span className="font-medium text-[#3D2314]">{label}:</span>{" "}
          {email ? (
            <span className="text-[#3D2314]/80">{email.split("@")[0]}</span>
          ) : (
            <span className="text-red-600">{sla}</span>
          )}
        </span>
      )}
    </div>
  );

  return (
    <div className="space-y-1">
      <div className={`flex ${compact ? "gap-2" : "flex-col gap-1"}`}>
        <Slot label="Titular" email={titular} sla="sem titular" />
        <Slot label="Backup" email={backup} sla="sem backup" />
        <Slot label="Supervisor" email={supervisor} sla="sem supervisor" />
      </div>
      {!completo && motivos && motivos.length > 0 && !compact && (
        <div className="rounded bg-red-50 px-2 py-1 text-xs text-red-800">
          ⚠ {motivos.join(" · ")}
        </div>
      )}
    </div>
  );
}
