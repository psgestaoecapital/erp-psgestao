import Link from "next/link";
import { ChevronRight, AlertCircle, CheckCircle2, Clock } from "lucide-react";

interface WealthClienteCardProps {
  id: string;
  nome: string;
  tipo: "PF" | "PJ";
  perfilRisco: string;
  status: string;
  patrimonio: number | null;
  numPositions: number;
  numConexoesAtivas: number;
  ultimoSync: string | null;
}

const perfilLabels: Record<string, string> = {
  conservador: "Conservador",
  moderado: "Moderado",
  arrojado: "Arrojado",
  agressivo: "Agressivo",
  pendente: "Suitability Pendente",
};

const perfilStyles: Record<string, { bg: string; fg: string }> = {
  conservador: { bg: "#DBEAFE", fg: "#1E40AF" },
  moderado: { bg: "#D1FAE5", fg: "#065F46" },
  arrojado: { bg: "#FEF3C7", fg: "#92400E" },
  agressivo: { bg: "#FEE2E2", fg: "#991B1B" },
  pendente: { bg: "#F3F4F6", fg: "#374151" },
};

function Badge({
  children,
  variant = "filled",
  bg,
  fg,
}: {
  children: React.ReactNode;
  variant?: "filled" | "outline";
  bg?: string;
  fg?: string;
}) {
  if (variant === "outline") {
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md border"
        style={{ borderColor: "rgba(61, 35, 20, 0.2)", color: "#3D2314" }}
      >
        {children}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md"
      style={{ backgroundColor: bg, color: fg }}
    >
      {children}
    </span>
  );
}

export function WealthClienteCard({
  id,
  nome,
  tipo,
  perfilRisco,
  status,
  patrimonio,
  numPositions,
  numConexoesAtivas,
  ultimoSync,
}: WealthClienteCardProps) {
  const formatPatrimonio = (v: number | null) => {
    if (v === null) return "Sem dados";
    return `R$ ${v.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const syncStatus = (() => {
    if (numConexoesAtivas === 0) {
      return { icon: AlertCircle, text: "Sem conexão", color: "#D97706" };
    }
    if (!ultimoSync) {
      return { icon: Clock, text: "Aguardando primeira sync", color: "#2563EB" };
    }
    const horas = Math.floor((Date.now() - new Date(ultimoSync).getTime()) / 3600000);
    if (horas < 25) {
      return { icon: CheckCircle2, text: `Atualizado há ${horas}h`, color: "#059669" };
    }
    return {
      icon: AlertCircle,
      text: `Defasado há ${Math.floor(horas / 24)} dias`,
      color: "#D97706",
    };
  })();

  const StatusIcon = syncStatus.icon;
  const perfilStyle = perfilStyles[perfilRisco] || perfilStyles.pendente;

  return (
    <Link href={`/dashboard/wealth/clientes/${id}`} className="block">
      <div
        className="rounded-lg border p-5 transition-all hover:shadow-md cursor-pointer"
        style={{
          borderColor: "rgba(61, 35, 20, 0.1)",
          backgroundColor: "#FAF7F2",
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2 flex-1 min-w-0">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold truncate" style={{ color: "#3D2314" }}>
                {nome}
              </h3>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge variant="outline">{tipo}</Badge>
                <Badge bg={perfilStyle.bg} fg={perfilStyle.fg}>
                  {perfilLabels[perfilRisco] || perfilRisco}
                </Badge>
                {status !== "ativo" && <Badge variant="outline">{status}</Badge>}
              </div>
            </div>

            <div
              className="space-y-1 pt-2 border-t"
              style={{ borderColor: "rgba(61, 35, 20, 0.1)" }}
            >
              <p className="text-2xl font-bold" style={{ color: "#3D2314" }}>
                {formatPatrimonio(patrimonio)}
              </p>
              <div className="flex items-center justify-between text-xs">
                <span style={{ color: "rgba(61, 35, 20, 0.6)" }}>
                  {numPositions} posições · {numConexoesAtivas} conexões
                </span>
                <span
                  className="flex items-center gap-1"
                  style={{ color: syncStatus.color }}
                >
                  <StatusIcon className="h-3 w-3" />
                  {syncStatus.text}
                </span>
              </div>
            </div>
          </div>

          <ChevronRight
            className="h-5 w-5 flex-shrink-0 mt-2"
            style={{ color: "rgba(61, 35, 20, 0.3)" }}
          />
        </div>
      </div>
    </Link>
  );
}
