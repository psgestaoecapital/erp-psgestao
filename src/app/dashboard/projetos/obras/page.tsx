"use client";
import { Construction } from "lucide-react";
import { PlaceholderTab } from "../_components/PlaceholderTab";

export default function ObrasPage() {
  return (
    <PlaceholderTab
      icon={Construction}
      titulo="Obras em execução"
      descricao="Acompanhamento de obras em andamento. Avanço físico, custos reais x orçado, prazos, fotos do canteiro."
      fase="Fase 6"
      funcoesFuturas={[
        "Cronograma físico-financeiro",
        "Diário de obra",
        "Apropriação de custos (linka erp_pagar)",
        "Alertas de desvio",
        "Mobile app de canteiro",
      ]}
    />
  );
}
