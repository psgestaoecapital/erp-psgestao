"use client";
import { PlaceholderTab } from "../_components/PlaceholderTab";

export default function AcompanhamentoPage() {
  return (
    <PlaceholderTab
      icone="📈"
      titulo="Orçado vs Realizado"
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
