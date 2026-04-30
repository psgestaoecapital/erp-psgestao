"use client";
import { Users } from "lucide-react";
import { PlaceholderTab } from "../_components/PlaceholderTab";

export default function ClientesPage() {
  return (
    <PlaceholderTab
      icon={Users}
      titulo="Clientes de obra"
      descricao="Cadastre e gerencie seus clientes finais (PF e PJ), obras associadas, histórico de propostas e relacionamento."
      fase="Fase 2"
      funcoesFuturas={[
        "Cadastro completo PF/PJ com CPF/CNPJ",
        "Múltiplas obras por cliente",
        "Histórico de propostas",
        "Pipeline visual",
        "Importação da agenda Omie",
      ]}
    />
  );
}
