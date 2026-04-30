// src/app/dashboard/projetos/catalogo/page.tsx
// Catálogo de Serviços do Hub Projetos (Fase 1)
// Lista projetos_servicos com cálculo de preço de venda baseado no BDI da empresa

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpenText,
  Pencil,
  Trash2,
  Copy,
  Plus,
  Search,
  Upload,
} from "lucide-react";
import { useCompanyIds } from "@/lib/useCompanyIds";
import { supabaseBrowser } from "@/lib/authFetch";
import { CatalogoTable, type CatalogoColumn } from "@/components/projetos/CatalogoTable";
import { EmptyStateImportar } from "@/components/projetos/EmptyStateImportar";

interface Servico {
  id: string;
  company_id: string;
  codigo: string | null;
  nome: string;
  categoria: string | null;
  unidade: string | null;
  custo_unitario_total: number | null;
  custo_material: number | null;
  custo_mao_obra: number | null;
  custo_equipamento: number | null;
  produtividade_unidade_dia: number | null;
  qtd_itens_bom: number | null;
  is_publico: boolean | null;
  fork_from_publico_id: string | null;
  ativo: boolean | null;
}

interface ConfigBdi {
  bdi_total_pct: number | null;
  bdi_lucro_pct: number | null;
  margem_minima_pct?: number | null;
}

function fmtBRL(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function CatalogoServicosPage() {
  const router = useRouter();
  const { sel, companies } = useCompanyIds();
  const companyId = sel && !sel.startsWith("group_") && sel !== "consolidado" ? sel : null;
  const empresa = companies.find((c) => c.id === companyId);

  const [servicos, setServicos] = useState<Servico[]>([]);
  const [config, setConfig] = useState<ConfigBdi | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [busca, setBusca] = useState("");
  const [filtroCat, setFiltroCat] = useState("");
  const [filtroOrigem, setFiltroOrigem] = useState<"todos" | "manual" | "fork">("todos");
  const [filtroStatus, setFiltroStatus] = useState<"ativo" | "inativo" | "todos">("ativo");
  const [apenasComBom, setApenasComBom] = useState(false);

  const [importando, setImportando] = useState(false);
  const [criando, setCriando] = useState(false);

  const carregar = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErro(null);
    try {
      const supabase = supabaseBrowser();
      const [servR, cfgR] = await Promise.all([
        supabase
          .from("projetos_servicos")
          .select("*")
          .eq("company_id", companyId)
          .eq("is_publico", false)
          .order("nome"),
        supabase
          .from("projetos_modulo_config")
          .select("bdi_total_pct, bdi_lucro_pct, margem_minima_pct")
          .eq("company_id", companyId)
          .maybeSingle(),
      ]);
      if (servR.error) throw servR.error;
      if (cfgR.error && cfgR.error.code !== "PGRST116") throw cfgR.error;
      setServicos((servR.data as Servico[]) || []);
      setConfig((cfgR.data as ConfigBdi) || null);
    } catch (e: any) {
      setErro(e.message || "Falha ao carregar catálogo");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const categorias = useMemo(() => {
    const set = new Set<string>();
    servicos.forEach((s) => s.categoria && set.add(s.categoria));
    return Array.from(set).sort();
  }, [servicos]);

  const filtrados = useMemo(() => {
    return servicos.filter((s) => {
      if (filtroStatus === "ativo" && s.ativo === false) return false;
      if (filtroStatus === "inativo" && s.ativo !== false) return false;
      if (filtroOrigem === "fork" && !s.fork_from_publico_id) return false;
      if (filtroOrigem === "manual" && s.fork_from_publico_id) return false;
      if (filtroCat && s.categoria !== filtroCat) return false;
      if (apenasComBom && (s.qtd_itens_bom ?? 0) === 0) return false;
      if (busca) {
        const q = busca.toLowerCase();
        const hay = `${s.nome} ${s.codigo || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [servicos, busca, filtroCat, filtroOrigem, filtroStatus, apenasComBom]);

  function calcPrecoVenda(custo: number | null) {
    if (custo === null || custo === undefined) return 0;
    const bdi = config?.bdi_total_pct ?? 0;
    return custo * (1 + bdi / 100);
  }

  async function criarNovo() {
    if (!companyId) return;
    setCriando(true);
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase
        .from("projetos_servicos")
        .insert({
          company_id: companyId,
          codigo: `SERV-${servicos.length + 1}`,
          nome: "Novo serviço",
          ativo: true,
        })
        .select("id")
        .single();
      if (error) throw error;
      router.push(`/dashboard/projetos/catalogo/${data.id}`);
    } catch (e: any) {
      setErro(e.message);
      setCriando(false);
    }
  }

  async function duplicar(s: Servico) {
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase.rpc("fn_projetos_duplicar_servico", {
        p_servico_id: s.id,
        p_novo_codigo: null,
        p_novo_nome: null,
      });
      if (error) throw error;
      // RPC pode retornar uuid direto ou objeto
      const novoId = typeof data === "string" ? data : (data as any)?.id || (data as any)?.servico_id;
      setAviso(`Serviço "${s.nome}" duplicado`);
      setTimeout(() => setAviso(null), 4000);
      if (novoId) {
        router.push(`/dashboard/projetos/catalogo/${novoId}`);
      } else {
        await carregar();
      }
    } catch (e: any) {
      setErro(e.message);
    }
  }

  async function deletar(s: Servico) {
    if (!confirm(`Deletar serviço "${s.nome}"?\n\nEsta ação não pode ser desfeita.`)) return;
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase.rpc("fn_projetos_deletar_servico", {
        p_servico_id: s.id,
      });
      if (error) throw error;
      if (data && data.success === false) {
        setErro(data.error || "Serviço não pode ser deletado");
        setTimeout(() => setErro(null), 5000);
        return;
      }
      setAviso(`Serviço "${s.nome}" removido`);
      setTimeout(() => setAviso(null), 4000);
      await carregar();
    } catch (e: any) {
      setErro(e.message);
    }
  }

  async function importarBiblioteca() {
    if (!companyId) return;
    if (!confirm("Importar biblioteca pública de serviços? Inclui também insumos e mão de obra dependentes.")) return;
    setImportando(true);
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase.rpc("fn_projetos_importar_catalogo_publico", {
        p_company_id: companyId,
        p_incluir_insumos: true,
        p_incluir_mao_obra: true,
        p_incluir_servicos: true,
      });
      if (error) throw error;
      const qtd = (data && (data.servicos_importados ?? data.qtd_servicos)) ?? "vários";
      setAviso(`Biblioteca importada: ${qtd} serviços`);
      setTimeout(() => setAviso(null), 6000);
      await carregar();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setImportando(false);
    }
  }

  if (!companyId) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-20 text-center">
        <h1
          className="text-2xl font-medium text-[#3D2314]"
          style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}
        >
          Selecione uma empresa
        </h1>
        <p className="mt-2 text-sm text-[#3D2314]/60">
          O catálogo de serviços é por empresa específica.
        </p>
      </main>
    );
  }

  const colunas: CatalogoColumn<Servico>[] = [
    {
      key: "codigo",
      label: "Código",
      hiddenOnMobile: true,
      render: (s) => (
        <span className="font-mono text-xs text-[#3D2314]/70">{s.codigo || "—"}</span>
      ),
    },
    {
      key: "nome",
      label: "Nome",
      render: (s) => (
        <div>
          <div className="font-medium text-[#3D2314]">{s.nome}</div>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {s.fork_from_publico_id && (
              <span className="rounded-full bg-[#3D2314]/8 px-2 py-0.5 text-[10px] uppercase tracking-wider text-[#3D2314]/60">
                biblioteca
              </span>
            )}
            {(s.qtd_itens_bom ?? 0) === 0 && (
              <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-800">
                BOM incompleto
              </span>
            )}
            {(s.custo_unitario_total ?? 0) === 0 && (s.qtd_itens_bom ?? 0) > 0 && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-800">
                Sem CPU
              </span>
            )}
            {s.produtividade_unidade_dia === null && (
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-800">
                Sem produtividade
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "categoria",
      label: "Categoria",
      hiddenOnMobile: true,
      render: (s) =>
        s.categoria ? (
          <span className="rounded-full bg-[#C8941A]/15 px-2 py-0.5 text-xs font-medium text-[#3D2314]">
            {s.categoria}
          </span>
        ) : (
          <span className="text-[#3D2314]/40">—</span>
        ),
    },
    {
      key: "unidade",
      label: "Un",
      hiddenOnMobile: true,
      render: (s) => <span className="text-[#3D2314]/70">{s.unidade || "—"}</span>,
    },
    {
      key: "bom",
      label: "BOM",
      align: "center",
      render: (s) => (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            (s.qtd_itens_bom ?? 0) > 0
              ? "bg-[#3D2314]/8 text-[#3D2314]"
              : "bg-yellow-50 text-yellow-700"
          }`}
        >
          {s.qtd_itens_bom ?? 0} ite{(s.qtd_itens_bom ?? 0) !== 1 ? "ns" : "m"}
        </span>
      ),
    },
    {
      key: "custo",
      label: "Custo",
      align: "right",
      render: (s) => (
        <span className="font-mono text-[#3D2314]/80">
          {fmtBRL(s.custo_unitario_total)}
        </span>
      ),
    },
    {
      key: "venda",
      label: "Preço venda",
      align: "right",
      render: (s) => {
        const preco = calcPrecoVenda(s.custo_unitario_total);
        return (
          <span className="font-mono font-medium text-[#3D2314]">{fmtBRL(preco)}</span>
        );
      },
    },
    {
      key: "produtividade",
      label: "Prod/dia",
      align: "right",
      hiddenOnMobile: true,
      render: (s) =>
        s.produtividade_unidade_dia ? (
          <span className="text-[#3D2314]/70">
            {s.produtividade_unidade_dia.toLocaleString("pt-BR")} {s.unidade}
          </span>
        ) : (
          <span className="text-[#3D2314]/40">—</span>
        ),
    },
  ];

  const acoes = (s: Servico) => (
    <div className="flex items-center justify-end gap-1">
      <button
        onClick={() => router.push(`/dashboard/projetos/catalogo/${s.id}`)}
        className="rounded-lg p-1.5 text-[#3D2314]/60 hover:bg-[#3D2314]/5 hover:text-[#3D2314]"
        title="Editar BOM"
      >
        <Pencil size={14} />
      </button>
      <button
        onClick={() => duplicar(s)}
        className="rounded-lg p-1.5 text-[#3D2314]/60 hover:bg-[#3D2314]/5 hover:text-[#3D2314]"
        title="Duplicar"
      >
        <Copy size={14} />
      </button>
      <button
        onClick={() => deletar(s)}
        className="rounded-lg p-1.5 text-red-600 hover:bg-red-50"
        title="Deletar"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );

  const semServicos = !loading && servicos.length === 0;
  const empresaNome = empresa?.nome_fantasia || empresa?.razao_social || "—";

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1
            className="text-2xl font-medium text-[#3D2314]"
            style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal", letterSpacing: "-0.01em" }}
          >
            Catálogo de Serviços
          </h1>
          <p className="mt-1 text-sm text-[#3D2314]/60">
            Composição de Preço Unitário (CPU) com BDI integrado · {empresaNome}
            {config?.bdi_total_pct != null && (
              <span className="ml-2 rounded-full bg-[#C8941A]/15 px-2 py-0.5 text-xs font-medium text-[#C8941A]">
                BDI {config.bdi_total_pct.toFixed(2)}%
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={importarBiblioteca}
            disabled={importando}
            className="inline-flex items-center gap-2 rounded-lg border border-[#3D2314]/12 bg-white px-3 py-2 text-sm font-medium text-[#3D2314] hover:bg-[#3D2314]/5 disabled:opacity-50"
          >
            <Upload size={14} />
            {importando ? "Importando…" : "Importar biblioteca"}
          </button>
          <button
            onClick={criarNovo}
            disabled={criando}
            className="inline-flex items-center gap-2 rounded-lg bg-[#3D2314] px-4 py-2 text-sm font-medium text-[#FAF7F2] hover:bg-[#3D2314]/90 disabled:opacity-50"
          >
            <Plus size={14} />
            {criando ? "Criando…" : "Novo serviço"}
          </button>
        </div>
      </header>

      {erro && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{erro}</div>}
      {aviso && (
        <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">✓ {aviso}</div>
      )}

      {semServicos ? (
        <EmptyStateImportar
          icon={BookOpenText}
          titulo="Catálogo vazio"
          descricao="Importe a biblioteca pública para começar com 10 serviços prontos (forro, drywall, sanca etc), ou crie um serviço manualmente."
          ctaImportar="Importar biblioteca pública"
          ctaSecundario="ou criar um serviço manualmente"
          onImportar={importarBiblioteca}
          onCriarManual={criarNovo}
          importando={importando}
        />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-[#3D2314]/8 bg-white p-4 shadow-sm md:grid-cols-5">
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs uppercase tracking-wider text-[#3D2314]/60">
                Buscar
              </label>
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3D2314]/40"
                />
                <input
                  type="text"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Código ou nome…"
                  className="w-full rounded-lg border border-[#3D2314]/12 bg-white py-2 pl-9 pr-3 text-sm focus:border-[#C8941A] focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wider text-[#3D2314]/60">
                Categoria
              </label>
              <select
                value={filtroCat}
                onChange={(e) => setFiltroCat(e.target.value)}
                className="w-full rounded-lg border border-[#3D2314]/12 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none"
              >
                <option value="">Todas</option>
                {categorias.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wider text-[#3D2314]/60">
                Origem
              </label>
              <select
                value={filtroOrigem}
                onChange={(e) => setFiltroOrigem(e.target.value as any)}
                className="w-full rounded-lg border border-[#3D2314]/12 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none"
              >
                <option value="todos">Todas</option>
                <option value="manual">Manual</option>
                <option value="fork">Biblioteca</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wider text-[#3D2314]/60">
                Status
              </label>
              <select
                value={filtroStatus}
                onChange={(e) => setFiltroStatus(e.target.value as any)}
                className="w-full rounded-lg border border-[#3D2314]/12 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none"
              >
                <option value="ativo">Ativos</option>
                <option value="inativo">Inativos</option>
                <option value="todos">Todos</option>
              </select>
            </div>
          </div>

          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-xs text-[#3D2314]/70">
              <input
                type="checkbox"
                checked={apenasComBom}
                onChange={(e) => setApenasComBom(e.target.checked)}
                className="h-4 w-4 rounded accent-[#C8941A]"
              />
              Apenas com BOM completo
            </label>
            <p className="text-xs text-[#3D2314]/60">
              {filtrados.length} de {servicos.length} serviço{servicos.length !== 1 ? "s" : ""}
            </p>
          </div>

          <CatalogoTable
            rows={filtrados}
            columns={colunas}
            loading={loading}
            rowKey={(s) => s.id}
            actions={acoes}
            onRowClick={(s) => router.push(`/dashboard/projetos/catalogo/${s.id}`)}
            emptyMessage="Nenhum serviço encontrado com esses filtros"
          />
        </>
      )}
    </main>
  );
}
