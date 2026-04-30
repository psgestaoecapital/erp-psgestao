"use client";
import { PlaceholderTab } from "../_components/PlaceholderTab";

export default function CatalogoPage() {
  return (
    <PlaceholderTab
      icone="📚"
      titulo="Catálogo de Serviços"
      descricao="Serviços oferecidos pela empresa com Composição de Preço Unitário (CPU). Cada serviço tem materiais + mão de obra + equipamentos."
      fase="Fase 1"
      funcoesFuturas={[
        "CPU por serviço (forro gesso m², drywall m², sanca m linear)",
        "Editor de composição",
        "Versionamento de preços",
        "Importação TCPO/SINAPI (50–100 composições essenciais)",
        "Comparativo com mercado",
      ]}
    />
  );
}
