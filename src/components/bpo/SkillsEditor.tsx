// src/components/bpo/SkillsEditor.tsx
// Editor de skills do operador: 6 categorias x 4 níveis (+ remover)

"use client";

import { useState } from "react";
import { rpc } from "@/lib/authFetch";

const CATEGORIAS = [
  { key: "conciliacao", nome: "Conciliação", desc: "Conciliação bancária e cartão" },
  { key: "classificacao", nome: "Classificação", desc: "Classificação IA + revisão" },
  { key: "fechamento", nome: "Fechamento", desc: "Fechamento mensal" },
  { key: "dre", nome: "DRE", desc: "Análise DRE" },
  { key: "fiscal", nome: "Fiscal", desc: "Obrigações fiscais" },
  { key: "cobranca", nome: "Cobrança", desc: "Cobrança e aging" },
] as const;

const NIVEIS = [
  { key: "remover", nome: "—", cor: "bg-[#FAF7F2] text-[#3D2314]/40" },
  { key: "iniciante", nome: "Iniciante", cor: "bg-yellow-100 text-yellow-800" },
  { key: "intermediario", nome: "Intermed.", cor: "bg-blue-100 text-blue-800" },
  { key: "avancado", nome: "Avançado", cor: "bg-emerald-100 text-emerald-800" },
  { key: "expert", nome: "Expert", cor: "bg-[#C8941A]/20 text-[#3D2314]" },
] as const;

type SkillsMap = Record<string, string>;

export default function SkillsEditor({
  userId,
  skills,
  onChange,
}: {
  userId: string;
  skills: SkillsMap;
  onChange?: (novas: SkillsMap) => void;
}) {
  const [estado, setEstado] = useState<SkillsMap>(skills);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(categoria: string, nivel: string) {
    setSalvando(categoria);
    setErro(null);
    try {
      await rpc("fn_bpo_admin_set_skill", {
        p_user_id: userId,
        p_categoria: categoria,
        p_nivel: nivel,
      });
      const novo = { ...estado };
      if (nivel === "remover") delete novo[categoria];
      else novo[categoria] = nivel;
      setEstado(novo);
      onChange?.(novo);
    } catch (e: any) {
      setErro(e.message || "Não foi possível salvar a skill");
    } finally {
      setSalvando(null);
    }
  }

  return (
    <div className="space-y-3">
      {erro && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {erro}
        </div>
      )}
      <div className="space-y-2">
        {CATEGORIAS.map((cat) => {
          const nivelAtual = estado[cat.key] || "remover";
          const isSalvando = salvando === cat.key;
          return (
            <div key={cat.key} className="rounded-lg bg-[#FAF7F2] p-3">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-[#3D2314]">
                    {cat.nome}
                  </div>
                  <div className="text-xs text-[#3D2314]/60">{cat.desc}</div>
                </div>
                {isSalvando && (
                  <div className="text-xs text-[#C8941A]">salvando…</div>
                )}
              </div>
              <div className="flex gap-1">
                {NIVEIS.map((n) => {
                  const ativo = nivelAtual === n.key;
                  return (
                    <button
                      key={n.key}
                      disabled={isSalvando}
                      onClick={() => salvar(cat.key, n.key)}
                      className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${
                        ativo
                          ? n.cor + " ring-2 ring-[#3D2314]"
                          : "bg-white text-[#3D2314]/60 hover:bg-[#FAF7F2]"
                      }`}
                    >
                      {n.nome}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
