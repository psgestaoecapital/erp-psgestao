// src/app/dashboard/projetos/catalogo/[id]/page.tsx
// Editor visual de BOM com cálculo em tempo real (CPU + BDI)
// 2 colunas: 60% BOM editor + 40% resumo/preview sticky

"use client";

import { useCallback, useEffect, useMemo, useState, use } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Save,
  AlertTriangle,
  CheckCircle2,
  Info,
  Package,
  HardHat,
  Wrench,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/authFetch";
import { BomEditor, type BomLinha } from "@/components/projetos/BomEditor";

interface Servico {
  id: string;
  company_id: string;
  codigo: string | null;
  nome: string;
  descricao: string | null;
  categoria: string | null;
  unidade: string | null;
  produtividade_unidade_dia: number | null;
  equipe_padrao: string | null;
  observacoes: string | null;
  ativo: boolean | null;
  is_publico: boolean | null;
  fork_from_publico_id: string | null;
  custo_unitario_total: number | null;
  custo_material: number | null;
  custo_mao_obra: number | null;
  custo_equipamento: number | null;
  qtd_itens_bom: number | null;
}

interface ConfigBdi {
  bdi_total_pct: number | null;
  bdi_lucro_pct: number | null;
  margem_minima_pct: number | null;
}

interface Preview {
  custo_material: number | null;
  custo_mao_obra: number | null;
  custo_equipamento: number | null;
  custo_total: number | null;
  preco_venda: number | null;
  bdi_aplicado_pct: number | null;
}

interface ValidacaoItem {
  severidade: "erro" | "alerta" | "info" | string;
  mensagem: string;
  campo?: string | null;
}

interface ServicoCompleto {
  servico: Servico;
  bom: BomLinha[];
  config: ConfigBdi | null;
  preview: Preview | null;
  validacao: ValidacaoItem[] | null;
}

function fmtBRL(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function pct(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return `${v.toFixed(2)}%`;
}

export default function ServicoEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [data, setData] = useState<ServicoCompleto | null>(null);
  const [loading, setLoading] = useState(true);
  const [recalculando, setRecalculando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Edição inline metadados (commit no blur)
  const [edits, setEdits] = useState<Partial<Servico>>({});
  const [salvandoMeta, setSalvandoMeta] = useState(false);

  const carregar = useCallback(
    async (opts?: { soft?: boolean }) => {
      if (!id) return;
      if (opts?.soft) setRecalculando(true);
      else setLoading(true);
      setErro(null);
      try {
        const supabase = supabaseBrowser();
        const { data: rpcData, error } = await supabase.rpc(
          "fn_projetos_servico_completo",
          { p_servico_id: id }
        );
        if (error) throw error;
        if (!rpcData) throw new Error("Serviço não encontrado");

        // RPC pode devolver objeto único ou array
        const raw = Array.isArray(rpcData) ? rpcData[0] : rpcData;
        if (!raw || !raw.servico) throw new Error("Resposta inválida do servidor");
        setData(raw as ServicoCompleto);
      } catch (e: any) {
        setErro(e.message || "Falha ao carregar serviço");
      } finally {
        setLoading(false);
        setRecalculando(false);
      }
    },
    [id]
  );

  useEffect(() => {
    carregar();
  }, [carregar]);

  const servico = data?.servico ?? null;
  const bom = data?.bom ?? [];
  const config = data?.config ?? null;
  const preview = data?.preview ?? null;
  const validacao = data?.validacao ?? [];

  // Custo total (preferir preview, fallback servico)
  const custoMaterial = preview?.custo_material ?? servico?.custo_material ?? 0;
  const custoMaoObra = preview?.custo_mao_obra ?? servico?.custo_mao_obra ?? 0;
  const custoEquipamento = preview?.custo_equipamento ?? servico?.custo_equipamento ?? 0;
  const custoTotal =
    preview?.custo_total ??
    servico?.custo_unitario_total ??
    custoMaterial + custoMaoObra + custoEquipamento;

  const bdiPct = preview?.bdi_aplicado_pct ?? config?.bdi_total_pct ?? 0;
  const precoVenda = preview?.preco_venda ?? custoTotal * (1 + (bdiPct ?? 0) / 100);
  const margemMinima = config?.margem_minima_pct ?? null;

  function pctOf(v: number, total: number) {
    if (!total) return 0;
    return (v / total) * 100;
  }

  function handleEdit(key: keyof Servico, valor: any) {
    setEdits((prev) => ({ ...prev, [key]: valor }));
  }

  function valorAtual<K extends keyof Servico>(key: K): Servico[K] | undefined {
    if (key in edits) return edits[key] as Servico[K];
    return servico ? servico[key] : undefined;
  }

  async function salvarMetadados() {
    if (!servico) return;
    if (Object.keys(edits).length === 0) {
      setAviso("Nenhuma alteração para salvar");
      setTimeout(() => setAviso(null), 2000);
      return;
    }
    setSalvandoMeta(true);
    setErro(null);
    try {
      const supabase = supabaseBrowser();
      // Sanitizar valores numéricos
      const payload: Record<string, any> = { ...edits };
      if ("produtividade_unidade_dia" in payload) {
        const v = payload.produtividade_unidade_dia;
        payload.produtividade_unidade_dia =
          v === "" || v === null || v === undefined ? null : Number(v);
      }
      const { error } = await supabase
        .from("projetos_servicos")
        .update(payload)
        .eq("id", servico.id);
      if (error) throw error;
      setEdits({});
      setAviso("Alterações salvas");
      setTimeout(() => setAviso(null), 3000);
      await carregar({ soft: true });
    } catch (e: any) {
      setErro(e.message || "Falha ao salvar");
    } finally {
      setSalvandoMeta(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-20 text-center">
        <Loader2 className="mx-auto animate-spin text-[#C8941A]" size={28} />
        <p className="mt-3 text-sm text-[#3D2314]/60">Carregando serviço…</p>
      </main>
    );
  }

  if (erro && !servico) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-20">
        <div className="rounded-xl bg-red-50 p-5 text-sm text-red-800">
          <p className="font-medium">Erro ao carregar serviço</p>
          <p className="mt-1">{erro}</p>
        </div>
        <button
          onClick={() => router.push("/dashboard/projetos/catalogo")}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#3D2314] px-4 py-2 text-sm font-medium text-[#FAF7F2] hover:bg-[#3D2314]/90"
        >
          <ArrowLeft size={14} /> Voltar ao catálogo
        </button>
      </main>
    );
  }

  if (!servico) return null;

  const dirty = Object.keys(edits).length > 0;
  const isFork = !!servico.fork_from_publico_id;

  return (
    <main className="mx-auto max-w-7xl px-6 py-6">
      {/* Top bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={() => router.push("/dashboard/projetos/catalogo")}
          className="inline-flex items-center gap-2 text-sm text-[#3D2314]/60 hover:text-[#3D2314]"
        >
          <ArrowLeft size={14} /> Voltar ao catálogo
        </button>
        <div className="flex items-center gap-2">
          {recalculando && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#C8941A]/15 px-3 py-1 text-xs font-medium uppercase tracking-wider text-[#C8941A]">
              <Loader2 size={12} className="animate-spin" />
              Recalculando…
            </span>
          )}
          <button
            onClick={salvarMetadados}
            disabled={!dirty || salvandoMeta}
            className="inline-flex items-center gap-2 rounded-lg bg-[#3D2314] px-4 py-2 text-sm font-medium text-[#FAF7F2] hover:bg-[#3D2314]/90 disabled:opacity-40"
          >
            {salvandoMeta ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Salvar
          </button>
        </div>
      </div>

      {erro && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{erro}</div>
      )}
      {aviso && (
        <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          ✓ {aviso}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Coluna Esquerda: Header + BOM (60%) */}
        <div className="lg:col-span-3">
          {/* Header editável */}
          <div className="mb-5 rounded-2xl border border-[#3D2314]/8 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              {isFork && (
                <span className="rounded-full bg-[#3D2314]/8 px-2 py-0.5 text-[10px] uppercase tracking-wider text-[#3D2314]/60">
                  biblioteca
                </span>
              )}
              {servico.ativo === false && (
                <span className="rounded-full bg-[#3D2314]/8 px-2 py-0.5 text-[10px] uppercase tracking-wider text-[#3D2314]/60">
                  inativo
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wider text-[#3D2314]/60">
                  Código
                </label>
                <input
                  type="text"
                  value={(valorAtual("codigo") as string) ?? ""}
                  onChange={(e) => handleEdit("codigo", e.target.value)}
                  placeholder="SERV-001"
                  className="w-full rounded-lg border border-[#3D2314]/12 bg-white px-3 py-2 font-mono text-sm focus:border-[#C8941A] focus:outline-none"
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs uppercase tracking-wider text-[#3D2314]/60">
                  Nome do serviço
                </label>
                <input
                  type="text"
                  value={(valorAtual("nome") as string) ?? ""}
                  onChange={(e) => handleEdit("nome", e.target.value)}
                  placeholder="Ex: Forro de gesso liso 12mm"
                  className="w-full rounded-lg border border-[#3D2314]/12 bg-white px-3 py-2 text-sm font-medium text-[#3D2314] focus:border-[#C8941A] focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wider text-[#3D2314]/60">
                  Categoria
                </label>
                <input
                  type="text"
                  value={(valorAtual("categoria") as string) ?? ""}
                  onChange={(e) => handleEdit("categoria", e.target.value)}
                  placeholder="Forros"
                  className="w-full rounded-lg border border-[#3D2314]/12 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wider text-[#3D2314]/60">
                  Unidade
                </label>
                <input
                  type="text"
                  value={(valorAtual("unidade") as string) ?? ""}
                  onChange={(e) => handleEdit("unidade", e.target.value)}
                  placeholder="m²"
                  className="w-full rounded-lg border border-[#3D2314]/12 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wider text-[#3D2314]/60">
                  Produtividade /dia
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={
                    (valorAtual("produtividade_unidade_dia") as number | null) ?? ""
                  }
                  onChange={(e) =>
                    handleEdit(
                      "produtividade_unidade_dia",
                      e.target.value === "" ? null : Number(e.target.value)
                    )
                  }
                  placeholder="20"
                  className="w-full rounded-lg border border-[#3D2314]/12 bg-white px-3 py-2 text-right font-mono text-sm focus:border-[#C8941A] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wider text-[#3D2314]/60">
                  Equipe padrão
                </label>
                <input
                  type="text"
                  value={(valorAtual("equipe_padrao") as string) ?? ""}
                  onChange={(e) => handleEdit("equipe_padrao", e.target.value)}
                  placeholder="1 oficial + 1 ajudante"
                  className="w-full rounded-lg border border-[#3D2314]/12 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-3">
              <label className="mb-1 block text-xs uppercase tracking-wider text-[#3D2314]/60">
                Descrição
              </label>
              <textarea
                value={(valorAtual("descricao") as string) ?? ""}
                onChange={(e) => handleEdit("descricao", e.target.value)}
                rows={2}
                placeholder="Detalhes do serviço, especificações técnicas, condições…"
                className="w-full rounded-lg border border-[#3D2314]/12 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none"
              />
            </div>
          </div>

          {/* BOM */}
          <div className="rounded-2xl border border-[#3D2314]/8 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2
                className="text-base font-medium text-[#3D2314]"
                style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}
              >
                Composição (BOM)
              </h2>
              <p className="text-xs text-[#3D2314]/60">
                Material · Mão de obra · Equipamento
              </p>
            </div>
            <BomEditor
              servicoId={servico.id}
              companyId={servico.company_id}
              bom={bom}
              onChange={() => carregar({ soft: true })}
            />
          </div>
        </div>

        {/* Coluna Direita: Resumo sticky (40%) */}
        <aside className="lg:col-span-2">
          <div className="sticky top-6 space-y-4">
            {/* Composição de Custo */}
            <div className="rounded-2xl border border-[#3D2314]/8 bg-white p-5 shadow-sm">
              <h3
                className="mb-3 text-sm font-medium uppercase tracking-wider text-[#3D2314]/60"
                style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}
              >
                Composição de Custo
              </h3>
              <div className="space-y-2">
                <LinhaComposicao
                  icon={Package}
                  cor="emerald"
                  label="Material"
                  valor={custoMaterial}
                  pct={pctOf(custoMaterial, custoTotal)}
                />
                <LinhaComposicao
                  icon={HardHat}
                  cor="blue"
                  label="Mão de obra"
                  valor={custoMaoObra}
                  pct={pctOf(custoMaoObra, custoTotal)}
                />
                <LinhaComposicao
                  icon={Wrench}
                  cor="purple"
                  label="Equipamento"
                  valor={custoEquipamento}
                  pct={pctOf(custoEquipamento, custoTotal)}
                />
              </div>
              <div className="mt-3 border-t border-[#3D2314]/8 pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-[#3D2314]">Custo unitário</span>
                  <span className="font-mono text-base font-medium text-[#3D2314]">
                    {fmtBRL(custoTotal)}
                  </span>
                </div>
                {servico.unidade && (
                  <p className="mt-0.5 text-right text-xs text-[#3D2314]/60">
                    por {servico.unidade}
                  </p>
                )}
              </div>
            </div>

            {/* Preço de Venda */}
            <div className="rounded-2xl border border-[#C8941A]/30 bg-gradient-to-br from-white to-[#C8941A]/5 p-5 shadow-sm">
              <h3
                className="mb-3 text-sm font-medium uppercase tracking-wider text-[#3D2314]/60"
                style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}
              >
                Preço de Venda
              </h3>
              <div className="space-y-1.5 text-sm">
                <div className="flex items-center justify-between text-[#3D2314]/70">
                  <span>Custo</span>
                  <span className="font-mono">{fmtBRL(custoTotal)}</span>
                </div>
                <div className="flex items-center justify-between text-[#3D2314]/70">
                  <span>BDI aplicado</span>
                  <span className="font-mono">{pct(bdiPct)}</span>
                </div>
              </div>
              <div className="mt-3 border-t border-[#C8941A]/20 pt-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium text-[#3D2314]">Preço final</span>
                  <span
                    className="font-mono text-2xl font-medium text-[#3D2314]"
                    style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}
                  >
                    {fmtBRL(precoVenda)}
                  </span>
                </div>
                {servico.unidade && (
                  <p className="mt-0.5 text-right text-xs text-[#3D2314]/60">
                    por {servico.unidade}
                  </p>
                )}
              </div>
              {margemMinima != null && bdiPct != null && bdiPct < margemMinima && (
                <p className="mt-3 rounded-lg bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
                  BDI ({pct(bdiPct)}) abaixo da margem mínima ({pct(margemMinima)})
                </p>
              )}
            </div>

            {/* Validações */}
            <ValidacaoCard itens={validacao} />
          </div>
        </aside>
      </div>
    </main>
  );
}

function LinhaComposicao({
  icon: Icon,
  cor,
  label,
  valor,
  pct,
}: {
  icon: typeof Package;
  cor: "emerald" | "blue" | "purple";
  label: string;
  valor: number;
  pct: number;
}) {
  const corChip =
    cor === "emerald"
      ? "bg-emerald-50 text-emerald-700"
      : cor === "blue"
        ? "bg-blue-50 text-blue-700"
        : "bg-purple-50 text-purple-700";
  const corBarra =
    cor === "emerald" ? "bg-emerald-500" : cor === "blue" ? "bg-blue-500" : "bg-purple-500";
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="inline-flex items-center gap-2 text-[#3D2314]/80">
          <span
            className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${corChip}`}
          >
            <Icon size={12} />
          </span>
          {label}
        </span>
        <span className="font-mono text-[#3D2314]">{fmtBRL(valor)}</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#3D2314]/8">
          <div
            className={`h-full ${corBarra}`}
            style={{ width: `${Math.min(100, pct).toFixed(1)}%` }}
          />
        </div>
        <span className="w-12 text-right text-xs text-[#3D2314]/50">
          {pct.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

function ValidacaoCard({ itens }: { itens: ValidacaoItem[] }) {
  if (!itens || itens.length === 0) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
        <div className="flex items-start gap-2">
          <CheckCircle2 size={18} className="mt-0.5 text-emerald-600" />
          <div>
            <h3 className="text-sm font-medium text-emerald-900">Tudo certo</h3>
            <p className="mt-0.5 text-xs text-emerald-800/80">
              Nenhum problema detectado neste serviço.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#3D2314]/8 bg-white p-5 shadow-sm">
      <h3
        className="mb-3 text-sm font-medium uppercase tracking-wider text-[#3D2314]/60"
        style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}
      >
        Validações
      </h3>
      <ul className="space-y-2">
        {itens.map((item, idx) => {
          const sev = (item.severidade || "info").toLowerCase();
          const Icon =
            sev === "erro" ? AlertTriangle : sev === "alerta" ? AlertTriangle : Info;
          const cor =
            sev === "erro"
              ? "text-red-600 bg-red-50"
              : sev === "alerta"
                ? "text-yellow-700 bg-yellow-50"
                : "text-blue-700 bg-blue-50";
          return (
            <li
              key={idx}
              className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${cor}`}
            >
              <Icon size={14} className="mt-0.5 shrink-0" />
              <span>{item.mensagem}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
