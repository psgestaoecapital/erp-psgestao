"use client";
import { Package } from "lucide-react";
import { PlaceholderTab } from "../_components/PlaceholderTab";

export default function InsumosPage() {
  return (
    <PlaceholderTab
      icon={Package}
      titulo="Insumos / Materiais"
      descricao="Cadastro de materiais utilizados em obras (placa de gesso, perfil metálico, parafuso, fita, massa). Linka com estoque do Omie."
      fase="Fase 1"
      funcoesFuturas={[
        "Cadastro completo de insumos",
        "Sincronia com estoque Omie",
        "Histórico de preços",
        "Fornecedores preferenciais",
        "Curva ABC",
      ]}
    />
  );
}
