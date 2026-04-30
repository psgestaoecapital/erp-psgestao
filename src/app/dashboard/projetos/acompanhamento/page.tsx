"use client";
import { TrendingUp } from "lucide-react";
import { PlaceholderTab } from "../_components/PlaceholderTab";

export default function AcompanhamentoPage() {
  return (
    <PlaceholderTab
      icon={TrendingUp}
      titulo="Orçado vs realizado"
      descricao="Análise gerencial: comparativo entre o orçamento e o custo real da obra. Curva S, margens, alertas, decisões."
      fase="Fase 6"
      funcoesFuturas={[
        "Curva S",
        "Margem real por obra",
        "Comparativo entre obras",
        "DRE divisional por obra",
        "Insights IA",
      ]}
    />
  );
}
