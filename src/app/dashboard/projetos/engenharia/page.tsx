"use client";
import { PlaceholderTab } from "../_components/PlaceholderTab";

export default function EngenhariaPage() {
  return (
    <PlaceholderTab
      icone="📐"
      titulo="Engenharia / Take-off"
      descricao="Engenheiro recebe demanda, define ambientes, áreas e serviços. Sistema gera lista de materiais (BOM) e horas de mão de obra automaticamente."
      fase="Fase 3"
      funcoesFuturas={[
        "Take-off por ambiente",
        "BOM auto-gerado",
        "Versionamento de projeto",
        "Importação Excel/CSV",
        "Integração BIM (futuro)",
      ]}
    />
  );
}
