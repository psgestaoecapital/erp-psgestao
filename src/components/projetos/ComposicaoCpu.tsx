// src/components/projetos/ComposicaoCpu.tsx
// Composição de Preço Unitário (CPU) — padrão de mercado (SINAPI/TCPO/ORSE), genérica p/ qualquer construtora.
// Nível 1 (sempre): Tipo · Código · Item · Un · Coeficiente · Custo unit. (estoque) · Custo no serviço.
// Nível 2 (expandir "ver impostos" · RD-51 profundidade opcional): Capado · Impostos · Margem · Preço final,
// dirigidos pelo regime via config de precificação (nunca alíquota fixa). Fonte única: fn_servico_composicao_detalhe.
"use client";

import { useCallback, useEffect, useState } from "react";
import { Package, HardHat, Wrench, ChevronDown, ChevronRight, Loader2, Info } from "lucide-react";
import { supabaseBrowser } from "@/lib/authFetch";

type Tipo = "material" | "mao_obra" | "equipamento";
interface CpuItem {
  tipo: Tipo;
  codigo: string | null;
  descricao: string | null;
  unidade: string | null;
  coeficiente: number;
  perda_pct: number;
  custo_unitario: number;
  custo_no_servico: number;
  custo_capado: number | null;
  impostos: number | null;
  margem: number | null;
  preco_final: number | null;
}
interface CpuHeader {
  custo_material: number;
  custo_mao_obra: number;
  custo_equipamento: number;
  custo_total: number;
  preco_venda: number | null;
  margem_rs: number | null;
  margem_pct: number | null;
  bdi_pct: number | null;
}
interface CpuConfig {
  creditos_pct: number | null;
  icms_pct: number | null;
  pis_cofins_pct: number | null;
  margem_material_pct: number | null;
  imposto_mo_pct: number | null;
  margem_mo_pct: number | null;
  comissao_pct: number | null;
}
interface CpuResp {
  ok: boolean;
  erro?: string;
  regime_tributario: string | null;
  sem_config: boolean;
  config: CpuConfig | null;
  itens: CpuItem[];
  header: CpuHeader;
}

const REGIME_LABEL: Record<string, string> = {
  simples: "Simples Nacional",
  presumido: "Lucro Presumido",
  real: "Lucro Real",
  mei: "MEI",
};

function brl(v: number | null | undefined, casas = 2) {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: casas, maximumFractionDigits: casas });
}
function num(v: number | null | undefined, casas = 2) {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: Math.max(casas, 4) });
}
function pct(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return `${v.toFixed(2)}%`;
}

const TIPO_META: Record<Tipo, { label: string; icon: typeof Package; chip: string }> = {
  material: { label: "Material", icon: Package, chip: "bg-emerald-50 text-emerald-700" },
  mao_obra: { label: "Mão de obra", icon: HardHat, chip: "bg-blue-50 text-blue-700" },
  equipamento: { label: "Equipamento", icon: Wrench, chip: "bg-purple-50 text-purple-700" },
};

export function ComposicaoCpu({
  servicoId,
  companyId,
  reloadKey = 0,
}: {
  servicoId: string;
  companyId: string;
  reloadKey?: number;
}) {
  const [data, setData] = useState<CpuResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [verImpostos, setVerImpostos] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const supabase = supabaseBrowser();
      const { data: resp, error } = await supabase.rpc("fn_servico_composicao_detalhe", {
        p_company_id: companyId,
        p_servico_id: servicoId,
      });
      if (error) throw error;
      const r = (Array.isArray(resp) ? resp[0] : resp) as CpuResp | null;
      if (!r || !r.ok) throw new Error(r?.erro === "sem_acesso" ? "Sem acesso a esta empresa." : r?.erro || "Falha ao carregar a composição.");
      setData(r);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [companyId, servicoId]);

  useEffect(() => {
    void carregar();
  }, [carregar, reloadKey]);

  const semImpostos = !data || data.sem_config;

  return (
    <div className="mt-6 rounded-2xl border border-[#3D2314]/8 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2
            className="text-base font-medium text-[#3D2314]"
            style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}
          >
            Composição de Preço Unitário (CPU)
          </h2>
          <p className="text-xs text-[#3D2314]/60">
            Padrão de mercado (SINAPI/TCPO) · coeficiente = consumo por unidade do serviço · custo do estoque
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data?.regime_tributario && (
            <span className="rounded-full bg-[#3D2314]/8 px-2.5 py-1 text-[10px] uppercase tracking-wider text-[#3D2314]/70">
              {REGIME_LABEL[data.regime_tributario] ?? data.regime_tributario}
            </span>
          )}
          <button
            onClick={() => setVerImpostos((v) => !v)}
            disabled={semImpostos}
            title={semImpostos ? "Configure a precificação para ver impostos e margem" : undefined}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#3D2314]/12 px-3 py-1.5 text-xs font-medium text-[#3D2314] hover:bg-[#3D2314]/5 disabled:opacity-40"
          >
            {verImpostos ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {verImpostos ? "Ocultar impostos" : "Ver impostos e margem"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-10 text-center">
          <Loader2 className="mx-auto animate-spin text-[#C8941A]" size={22} />
          <p className="mt-2 text-sm text-[#3D2314]/60">Carregando composição…</p>
        </div>
      ) : erro ? (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{erro}</div>
      ) : !data || data.itens.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#3D2314]/15 bg-[#FAF7F2] p-8 text-center">
          <Package className="mx-auto text-[#3D2314]/30" size={26} />
          <p className="mt-2 text-sm font-medium text-[#3D2314]">Composição vazia</p>
          <p className="mt-1 text-xs text-[#3D2314]/60">
            Adicione itens na composição (BOM) acima — material, mão de obra e equipamento. Cada item vira uma
            linha da CPU com seu coeficiente e o custo vindo do estoque.
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-[#3D2314]/10 text-left text-[11px] uppercase tracking-wider text-[#3D2314]/55">
                  <th className="py-2 pr-3 font-medium">Tipo</th>
                  <th className="py-2 pr-3 font-medium">Código</th>
                  <th className="py-2 pr-3 font-medium">Item</th>
                  <th className="py-2 pr-3 font-medium">Un</th>
                  <th className="py-2 pr-3 text-right font-medium">Coeficiente</th>
                  <th className="py-2 pr-3 text-right font-medium">Custo unit. (estoque)</th>
                  <th className="py-2 pr-3 text-right font-medium">Custo no serviço</th>
                  {verImpostos && (
                    <>
                      <th className="py-2 pr-3 text-right font-medium">Custo capado</th>
                      <th className="py-2 pr-3 text-right font-medium">Impostos</th>
                      <th className="py-2 pr-3 text-right font-medium">Margem</th>
                      <th className="py-2 pl-3 text-right font-medium">Preço c/ imp. + margem</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {data.itens.map((it, i) => {
                  const meta = TIPO_META[it.tipo];
                  const Icon = meta.icon;
                  return (
                    <tr key={i} className="border-b border-[#3D2314]/6 last:border-0">
                      <td className="py-2 pr-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.chip}`}>
                          <Icon size={11} /> {meta.label}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs text-[#3D2314]/70">{it.codigo || "—"}</td>
                      <td className="py-2 pr-3 text-[#3D2314]">{it.descricao || "—"}</td>
                      <td className="py-2 pr-3 text-[#3D2314]/70">{it.unidade || "—"}</td>
                      <td className="py-2 pr-3 text-right font-mono text-[#3D2314]">
                        {num(it.coeficiente, 3)}
                        {it.perda_pct > 0 && (
                          <span className="ml-1 text-[10px] text-[#3D2314]/45">+{it.perda_pct}%</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-[#3D2314]/80">{brl(it.custo_unitario, it.custo_unitario < 1 ? 4 : 2)}</td>
                      <td className="py-2 pr-3 text-right font-mono font-medium text-[#3D2314]">{brl(it.custo_no_servico)}</td>
                      {verImpostos && (
                        <>
                          <td className="py-2 pr-3 text-right font-mono text-[#3D2314]/70">{brl(it.custo_capado)}</td>
                          <td className="py-2 pr-3 text-right font-mono text-[#3D2314]/70">{brl(it.impostos)}</td>
                          <td className="py-2 pr-3 text-right font-mono text-[#3D2314]/70">{brl(it.margem)}</td>
                          <td className="py-2 pl-3 text-right font-mono font-medium text-[#C8941A]">{brl(it.preco_final)}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Rodapé — custo direto por categoria + preço de venda */}
          <div className="mt-4 grid grid-cols-1 gap-4 border-t border-[#3D2314]/8 pt-4 md:grid-cols-2">
            <div className="space-y-1.5 text-sm">
              <Rodape label="Custo material" valor={data.header.custo_material} />
              <Rodape label="Custo mão de obra" valor={data.header.custo_mao_obra} />
              <Rodape label="Custo equipamento" valor={data.header.custo_equipamento} />
              <div className="flex items-center justify-between border-t border-[#3D2314]/8 pt-1.5">
                <span className="text-sm font-medium text-[#3D2314]">Custo total (direto)</span>
                <span className="font-mono text-base font-medium text-[#3D2314]">{brl(data.header.custo_total)}</span>
              </div>
            </div>
            <div className="rounded-xl border border-[#C8941A]/30 bg-gradient-to-br from-white to-[#C8941A]/5 p-4">
              {data.sem_config ? (
                <div className="flex items-start gap-2 text-xs text-[#3D2314]/70">
                  <Info size={14} className="mt-0.5 shrink-0 text-[#C8941A]" />
                  <span>
                    Sem configuração de precificação para esta linha — mostrando só o custo direto (CPU padrão).
                    Configure impostos/margem em <b>Projetos · Configurações · Precificação</b> para o preço de venda.
                  </span>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between text-sm text-[#3D2314]/70">
                    <span>BDI (markup s/ custo)</span>
                    <span className="font-mono">{pct(data.header.bdi_pct)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-sm text-[#3D2314]/70">
                    <span>Margem</span>
                    <span className="font-mono">{brl(data.header.margem_rs)} · {pct(data.header.margem_pct)}</span>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between border-t border-[#C8941A]/20 pt-2">
                    <span className="text-sm font-medium text-[#3D2314]">Preço de venda</span>
                    <span
                      className="font-mono text-2xl font-medium text-[#3D2314]"
                      style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}
                    >
                      {brl(data.header.preco_venda)}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          {verImpostos && data.config && (
            <p className="mt-3 text-[11px] text-[#3D2314]/50">
              Impostos por regime (da config): créditos {pct(data.config.creditos_pct)} · ICMS {pct(data.config.icms_pct)} ·
              PIS/COFINS {pct(data.config.pis_cofins_pct)} · imposto MO {pct(data.config.imposto_mo_pct)} · margem material {pct(data.config.margem_material_pct)} · margem MO {pct(data.config.margem_mo_pct)}.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Rodape({ label, valor }: { label: string; valor: number }) {
  return (
    <div className="flex items-center justify-between text-[#3D2314]/75">
      <span>{label}</span>
      <span className="font-mono">{brl(valor)}</span>
    </div>
  );
}
