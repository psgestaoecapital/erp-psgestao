// src/app/dashboard/bpo/admin/contratos/page.tsx
// CRUD de contratos BPO: 12 flags de serviço + SLA + ativação

"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/authFetch";
import AdminGuard from "@/components/bpo/AdminGuard";

const SERVICOS = [
  { key: "contas_pagar", label: "Contas a Pagar" },
  { key: "contas_receber", label: "Contas a Receber" },
  { key: "conciliacao_bancaria", label: "Conciliação Bancária" },
  { key: "conciliacao_cartao", label: "Conciliação Cartão" },
  { key: "classificacao_ia", label: "Classificação IA" },
  { key: "cobranca", label: "Cobrança" },
  { key: "emissao_boleto", label: "Emissão Boleto" },
  { key: "emissao_nfe", label: "Emissão NFe" },
  { key: "dre_mensal", label: "DRE Mensal" },
  { key: "relatorio_ia", label: "Relatório IA" },
  { key: "fechamento_mensal", label: "Fechamento Mensal" },
  { key: "obrigacoes_fiscais", label: "Obrigações Fiscais" },
] as const;

interface Contrato {
  id: string;
  company_id: string;
  empresa: string;
  ativo: boolean;
  sla_horas: number;
  dia_fechamento: number;
  servicos: Record<string, boolean>;
}

export default function ContratosPage() {
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [expandido, setExpandido] = useState<string | null>(null);

  async function carregar() {
    setLoading(true);
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase
        .from("bpo_contratos")
        .select(`
          id, company_id, ativo, sla_horas, dia_fechamento,
          contas_pagar, contas_receber, conciliacao_bancaria, conciliacao_cartao,
          classificacao_ia, cobranca, emissao_boleto, emissao_nfe,
          dre_mensal, relatorio_ia, fechamento_mensal, obrigacoes_fiscais,
          companies!inner(razao_social, nome_fantasia)
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const lista: Contrato[] = (data || []).map((c: any) => ({
        id: c.id,
        company_id: c.company_id,
        empresa: c.companies?.nome_fantasia || c.companies?.razao_social || "—",
        ativo: c.ativo,
        sla_horas: c.sla_horas,
        dia_fechamento: c.dia_fechamento,
        servicos: SERVICOS.reduce((acc, s) => {
          acc[s.key] = !!c[s.key];
          return acc;
        }, {} as Record<string, boolean>),
      }));

      setContratos(lista);
    } catch (e: any) {
      setErro(e.message || "Não foi possível carregar contratos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  async function atualizar(contrato: Contrato, mudancas: Partial<Contrato>) {
    setSalvando(contrato.id);
    setErro(null);
    try {
      const supabase = supabaseBrowser();
      const update: any = {};
      if (mudancas.ativo !== undefined) update.ativo = mudancas.ativo;
      if (mudancas.sla_horas !== undefined) update.sla_horas = mudancas.sla_horas;
      if (mudancas.dia_fechamento !== undefined) update.dia_fechamento = mudancas.dia_fechamento;
      if (mudancas.servicos) {
        for (const k of Object.keys(mudancas.servicos)) {
          update[k] = mudancas.servicos[k];
        }
      }

      const { error } = await supabase
        .from("bpo_contratos")
        .update(update)
        .eq("id", contrato.id);

      if (error) {
        // mensagem humana — extrai do hint
        throw new Error(error.hint || error.message);
      }

      await carregar();
    } catch (e: any) {
      setErro(e.message || "Não foi possível atualizar o contrato");
    } finally {
      setSalvando(null);
    }
  }

  async function toggleServico(contrato: Contrato, key: string) {
    const novo = { ...contrato.servicos, [key]: !contrato.servicos[key] };
    await atualizar(contrato, { servicos: novo });
  }

  return (
    <AdminGuard>
      <div className="min-h-screen bg-white p-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-6">
            <a href="/dashboard/bpo/admin" className="text-sm text-[#C8941A] hover:underline">
              ← Voltar ao Admin BPO
            </a>
            <h1 className="mt-2 text-2xl font-bold text-[#3D2314]">Contratos BPO</h1>
            <p className="mt-1 text-sm text-[#3D2314]/70">
              Serviços contratados, SLA e ativação. Para ativar contrato, empresa precisa ter os 3 papéis.
            </p>
          </div>

          {erro && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
              {erro}
            </div>
          )}

          {loading ? (
            <div className="text-[#3D2314]/60">Carregando contratos…</div>
          ) : (
            <div className="space-y-3">
              {contratos.map((c) => {
                const qtdServicos = Object.values(c.servicos).filter(Boolean).length;
                return (
                  <div key={c.id} className="rounded-2xl bg-[#FAF7F2] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex-1">
                        <div className="font-semibold text-[#3D2314]">{c.empresa}</div>
                        <div className="text-xs text-[#3D2314]/60">
                          {qtdServicos} serviços · SLA {c.sla_horas}h · Fechamento dia {c.dia_fechamento}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-medium ${
                            c.ativo
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-yellow-100 text-yellow-800"
                          }`}
                        >
                          {c.ativo ? "Ativo" : "Inativo"}
                        </span>
                        <button
                          disabled={salvando === c.id}
                          onClick={() => atualizar(c, { ativo: !c.ativo })}
                          className="rounded-lg bg-[#3D2314] px-3 py-1.5 text-xs text-[#FAF7F2] hover:bg-[#5C3A24] disabled:opacity-50"
                        >
                          {c.ativo ? "Desativar" : "Ativar"}
                        </button>
                        <button
                          onClick={() => setExpandido(expandido === c.id ? null : c.id)}
                          className="text-xs text-[#C8941A] hover:underline"
                        >
                          {expandido === c.id ? "Recolher" : "Detalhes"}
                        </button>
                      </div>
                    </div>

                    {expandido === c.id && (
                      <div className="mt-4 border-t border-[#3D2314]/10 pt-4">
                        <div className="mb-3 grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-medium text-[#3D2314]">SLA (horas)</label>
                            <input
                              type="number"
                              value={c.sla_horas}
                              onChange={(e) =>
                                atualizar(c, { sla_horas: parseInt(e.target.value) || 24 })
                              }
                              className="mt-1 w-full rounded-lg border border-[#3D2314]/10 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-medium text-[#3D2314]">
                              Dia de fechamento
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={28}
                              value={c.dia_fechamento}
                              onChange={(e) =>
                                atualizar(c, {
                                  dia_fechamento: parseInt(e.target.value) || 5,
                                })
                              }
                              className="mt-1 w-full rounded-lg border border-[#3D2314]/10 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none"
                            />
                          </div>
                        </div>
                        <div className="text-xs font-medium text-[#3D2314] mb-2">Serviços contratados</div>
                        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                          {SERVICOS.map((s) => (
                            <label
                              key={s.key}
                              className="flex cursor-pointer items-center gap-2 rounded-lg bg-white p-2 text-sm hover:bg-[#FAF7F2]"
                            >
                              <input
                                type="checkbox"
                                checked={c.servicos[s.key]}
                                onChange={() => toggleServico(c, s.key)}
                                className="h-4 w-4 rounded accent-[#C8941A]"
                              />
                              <span className="text-[#3D2314]">{s.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AdminGuard>
  );
}
