"use client";
import { HardHat } from "lucide-react";
import { PlaceholderTab } from "../_components/PlaceholderTab";

export default function MaoObraPage() {
  return (
    <PlaceholderTab
      icon={HardHat}
      titulo="Mão de obra"
      descricao="Tipos de profissionais com custo/hora. Gesseiro, ajudante, mestre de obras, eletricista, etc. Inclui encargos."
      fase="Fase 1"
      funcoesFuturas={[
        "Cadastro de funções",
        "Custo/hora com encargos sociais",
        "Produtividade média por serviço",
        "Equipes pré-definidas",
      ]}
    />
  );
}
