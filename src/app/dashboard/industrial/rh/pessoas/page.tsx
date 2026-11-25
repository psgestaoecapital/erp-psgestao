// src/app/dashboard/industrial/rh/pessoas/page.tsx
// Indústria · RH — Cadastro de pessoas com custo completo (a mesma ficha do Hub), puxando do ponto ou digitado.
// RD-26: reusa o componente src/components/maoObra/MaoObraTela.tsx no contexto "industria".
"use client";
import { MaoObraTela } from "@/components/maoObra/MaoObraTela";

export default function IndustriaRhPessoasPage() {
  return <MaoObraTela contexto="industria" />;
}
