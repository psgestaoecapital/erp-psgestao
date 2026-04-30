// src/app/dashboard/projetos/insumos/page.tsx
// Catálogo de insumos do Hub Projetos (Fase 1)

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Package, Pencil, Trash2, TrendingUp, Upload, Plus, Search } from "lucide-react";
import { useCompanyIds } from "@/lib/useCompanyIds";
import { supabaseBrowser } from "@/lib/authFetch";
import { CatalogoTable, type CatalogoColumn } from "@/components/projetos/CatalogoTable";
import { CatalogoForm, type FormField } from "@/components/projetos/CatalogoForm";
import { EmptyStateImportar } from "@/components/projetos/EmptyStateImportar";

interface Insumo {
  id: string;
  company_id: string;
  erp_code: string | null;
  name: string;
  unit: string | null;
  category: string | null;
  current_cost: number | null;
  last_cost: number | null;
  variacao_pct: number | null;
  supplier: string | null;
  qtd_servicos_uso: number | null;
  is_publico: boolean | null;
  fork_from_publico_id: string | null;
  ativo: boolean | null;
  ncm?: string | null;
  especificacao_tecnica?: string | null;
  observacoes?: string | null;
}

interface Categoria {
  codigo: string;
  nome: string;
}

const UNIDADES = [
  { value: "un", label: "un" },
  { value: "m", label: "m" },
  { value: "m2", label: "m²" },
  { value: "m3", label: "m³" },
  { value: "kg", label: "kg" },
  { value: "L", label: "L" },
  { value: "sc", label: "sc" },
  { value: "cx", label: "cx" },
  { value: "rl", label: "rl" },
  { value: "gl", label: "gl" },
  { value: "h", label: "h" },
  { value: "dia", label: "dia" },
];

function fmtBRL(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function InsumosPage() {
  const { sel, companies } = useCompanyIds();
  const companyId = sel && !sel.startsWith("group_") && sel !== "consolidado" ? sel : null;
  const empresa = companies.find((c) => c.id === companyId);

  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Filtros
  const [busca, setBusca] = useState("");
  const [filtroCat, setFiltroCat] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<"ativo" | "inativo" | "todos">("ativo");
  const [filtroOrigem, setFiltroOrigem] = useState<"todos" | "manual" | "fork">("todos");

  // Form drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerInicial, setDrawerInicial] = useState<Insumo | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);

  // Modal preço
  const [modalPreco, setModalPreco] = useState<Insumo | null>(null);
  const [novoPreco, setNovoPreco] = useState("");
  const [dataCompra, setDataCompra] = useState(new Date().toISOString().slice(0, 10));
  const [salvandoPreco, setSalvandoPreco] = useState(false);

  // Importar
  const [importando, setImportando] = useState(false);

  const carregar = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErro(null);
    try {
      const supabase = supabaseBrowser();
      const [insR, catR] = await Promise.all([
        supabase
          .from("v_projetos_insumos_ui")
          .select("*")
          .eq("company_id", companyId)
          .eq("is_publico", false)
          .order("name"),
        supabase
          .from("projetos_insumo_categorias")
          .select("codigo, nome")
          .or(`company_id.is.null,company_id.eq.${companyId}`)
          .eq("ativo", true)
          .order("ordem"),
      ]);
      if (insR.error) throw insR.error;
      if (catR.error && catR.error.code !== "PGRST116") {
        // categorias é nice-to-have; sem ela ainda funciona
        console.warn("Categorias:", catR.error);
      }
      setInsumos((insR.data as Insumo[]) || []);
      setCategorias((catR.data as Categoria[]) || []);
    } catch (e: any) {
      setErro(e.message || "Falha ao carregar insumos");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Filtros aplicados
  const filtrados = useMemo(() => {
    return insumos.filter((i) => {
      if (filtroStatus === "ativo" && i.ativo === false) return false;
      if (filtroStatus === "inativo" && i.ativo !== false) return false;
      if (filtroOrigem === "fork" && !i.fork_from_publico_id) return false;
      if (filtroOrigem === "manual" && i.fork_from_publico_id) return false;
      if (filtroCat && i.category !== filtroCat) return false;
      if (busca) {
        const q = busca.toLowerCase();
        const hay = [i.name, i.erp_code, i.supplier].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [insumos, busca, filtroCat, filtroStatus, filtroOrigem]);

  function abrirNovo() {
    setDrawerInicial({
      id: "",
      company_id: companyId || "",
      erp_code: `INS-${insumos.length + 1}`,
      name: "",
      unit: "un",
      category: null,
      current_cost: null,
      last_cost: null,
      variacao_pct: null,
      supplier: null,
      qtd_servicos_uso: 0,
      is_publico: false,
      fork_from_publico_id: null,
      ativo: true,
    } as Insumo);
    setErroForm(null);
    setDrawerOpen(true);
  }

  function abrirEditar(i: Insumo) {
    setDrawerInicial(i);
    setErroForm(null);
    setDrawerOpen(true);
  }

  async function salvar(values: Insumo) {
    if (!companyId) return;
    setSalvando(true);
    setErroForm(null);
    try {
      const supabase = supabaseBrowser();
      const payload = {
        company_id: companyId,
        erp_code: values.erp_code || null,
        name: values.name,
        unit: values.unit || null,
        category: values.category || null,
        current_cost: values.current_cost,
        supplier: values.supplier || null,
        ncm: values.ncm || null,
        especificacao_tecnica: values.especificacao_tecnica || null,
        observacoes: values.observacoes || null,
        ativo: values.ativo !== false,
      };

      if (drawerInicial?.id) {
        const { error } = await supabase
          .from("m16_insumos")
          .update(payload)
          .eq("id", drawerInicial.id);
        if (error) throw error;
        setAviso(`Insumo "${values.name}" atualizado`);
      } else {
        const { error } = await supabase.from("m16_insumos").insert(payload);
        if (error) throw error;
        setAviso(`Insumo "${values.name}" criado`);
      }
      setTimeout(() => setAviso(null), 4000);
      setDrawerOpen(false);
      await carregar();
    } catch (e: any) {
      setErroForm(e.message || "Falha ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  async function deletar(i: Insumo) {
    if (!confirm(`Deletar insumo "${i.name}"?`)) return;
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase.rpc("fn_projetos_deletar_insumo", {
        p_insumo_id: i.id,
      });
      if (error) throw error;
      if (data && data.success === false) {
        setErro(data.error || "Insumo não pode ser deletado");
        setTimeout(() => setErro(null), 5000);
        return;
      }
      setAviso(`Insumo "${i.name}" removido`);
      setTimeout(() => setAviso(null), 4000);
      await carregar();
    } catch (e: any) {
      setErro(e.message);
    }
  }

  async function atualizarPreco() {
    if (!modalPreco || !novoPreco) return;
    setSalvandoPreco(true);
    try {
      const supabase = supabaseBrowser();
      const { error } = await supabase.rpc("fn_projetos_atualizar_preco_insumo", {
        p_insumo_id: modalPreco.id,
        p_novo_preco: parseFloat(novoPreco),
        p_data_compra: dataCompra,
      });
      if (error) throw error;
      setAviso(`Preço de "${modalPreco.name}" atualizado para ${fmtBRL(parseFloat(novoPreco))}`);
      setTimeout(() => setAviso(null), 5000);
      setModalPreco(null);
      setNovoPreco("");
      await carregar();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setSalvandoPreco(false);
    }
  }

  async function importarBiblioteca() {
    if (!companyId) return;
    if (!confirm("Importar biblioteca pública de insumos? Itens serão clonados como propriedade da empresa.")) return;
    setImportando(true);
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase.rpc("fn_projetos_importar_catalogo_publico", {
        p_company_id: companyId,
        p_incluir_insumos: true,
        p_incluir_mao_obra: false,
        p_incluir_servicos: false,
      });
      if (error) throw error;
      const qtd = (data && (data.insumos_importados ?? data.qtd_insumos)) ?? "vários";
      setAviso(`Biblioteca importada: ${qtd} insumos`);
      setTimeout(() => setAviso(null), 6000);
      await carregar();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setImportando(false);
    }
  }

  // Empty state quando sem empresa
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
          O catálogo de insumos é por empresa específica.
        </p>
      </main>
    );
  }

  // Schema do form
  const formFields: FormField[] = [
    { key: "erp_code", label: "Código", type: "text", required: true, placeholder: "INS-1" },
    {
      key: "unit",
      label: "Unidade",
      type: "select",
      required: true,
      options: UNIDADES,
    },
    {
      key: "name",
      label: "Nome",
      type: "text",
      required: true,
      fullWidth: true,
      placeholder: "Ex: Placa de gesso 1,2x0,6m",
    },
    {
      key: "category",
      label: "Categoria",
      type: "select",
      options: categorias.map((c) => ({ value: c.codigo, label: c.nome })),
    },
    {
      key: "current_cost",
      label: "Custo atual (R$)",
      type: "number",
      step: "0.01",
      min: 0,
    },
    { key: "supplier", label: "Fornecedor", type: "text", placeholder: "Nome do fornecedor" },
    { key: "ncm", label: "NCM", type: "text", placeholder: "00000000" },
    {
      key: "especificacao_tecnica",
      label: "Especificação técnica",
      type: "textarea",
      fullWidth: true,
    },
    {
      key: "observacoes",
      label: "Observações",
      type: "textarea",
      fullWidth: true,
    },
    {
      key: "ativo",
      label: "Status",
      type: "radio",
      options: [
        { value: "true", label: "Ativo" },
        { value: "false", label: "Inativo" },
      ],
    },
  ];

  const colunas: CatalogoColumn<Insumo>[] = [
    {
      key: "code",
      label: "Código",
      hiddenOnMobile: true,
      render: (i) => (
        <span className="font-mono text-xs text-[#3D2314]/70">{i.erp_code || "—"}</span>
      ),
    },
    {
      key: "name",
      label: "Nome",
      render: (i) => (
        <div>
          <div className="font-medium text-[#3D2314]">{i.name}</div>
          {i.fork_from_publico_id && (
            <span className="mt-0.5 inline-block rounded-full bg-[#3D2314]/8 px-2 py-0.5 text-[10px] uppercase tracking-wider text-[#3D2314]/60">
              biblioteca
            </span>
          )}
        </div>
      ),
    },
    {
      key: "category",
      label: "Categoria",
      hiddenOnMobile: true,
      render: (i) =>
        i.category ? (
          <span className="rounded-full bg-[#C8941A]/15 px-2 py-0.5 text-xs font-medium text-[#3D2314]">
            {i.category}
          </span>
        ) : (
          <span className="text-[#3D2314]/40">—</span>
        ),
    },
    {
      key: "unit",
      label: "Un",
      hiddenOnMobile: true,
      render: (i) => <span className="text-[#3D2314]/70">{i.unit || "—"}</span>,
    },
    {
      key: "current_cost",
      label: "Preço",
      align: "right",
      render: (i) => (
        <span className="font-mono text-[#3D2314]">{fmtBRL(i.current_cost)}</span>
      ),
    },
    {
      key: "variacao",
      label: "Variação",
      align: "right",
      hiddenOnMobile: true,
      render: (i) => {
        if (i.variacao_pct === null || i.variacao_pct === undefined || i.variacao_pct === 0) {
          return <span className="text-[#3D2314]/40">—</span>;
        }
        const positiva = i.variacao_pct > 0;
        return (
          <span
            className={`text-xs font-medium ${
              positiva ? "text-red-700" : "text-emerald-700"
            }`}
          >
            {positiva ? "↑" : "↓"} {Math.abs(i.variacao_pct).toFixed(1)}%
          </span>
        );
      },
    },
    {
      key: "uso",
      label: "Em uso",
      align: "center",
      render: (i) => (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            (i.qtd_servicos_uso ?? 0) > 0
              ? "bg-emerald-50 text-emerald-700"
              : "bg-[#3D2314]/5 text-[#3D2314]/40"
          }`}
        >
          {i.qtd_servicos_uso ?? 0} serv.
        </span>
      ),
    },
  ];

  const acoes = (i: Insumo) => (
    <div className="flex items-center justify-end gap-1">
      <button
        onClick={() => {
          setModalPreco(i);
          setNovoPreco(String(i.current_cost ?? ""));
        }}
        className="rounded-lg p-1.5 text-[#3D2314]/60 hover:bg-[#3D2314]/5 hover:text-[#3D2314]"
        title="Atualizar preço"
      >
        <TrendingUp size={14} />
      </button>
      <button
        onClick={() => abrirEditar(i)}
        className="rounded-lg p-1.5 text-[#3D2314]/60 hover:bg-[#3D2314]/5 hover:text-[#3D2314]"
        title="Editar"
      >
        <Pencil size={14} />
      </button>
      <button
        onClick={() => deletar(i)}
        disabled={(i.qtd_servicos_uso ?? 0) > 0}
        className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
        title={(i.qtd_servicos_uso ?? 0) > 0 ? "Em uso, não pode deletar" : "Deletar"}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );

  const semInsumos = !loading && insumos.length === 0;
  const empresaNome = empresa?.nome_fantasia || empresa?.razao_social || "—";

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      {/* Header */}
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1
            className="text-2xl font-medium text-[#3D2314]"
            style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal", letterSpacing: "-0.01em" }}
          >
            Catálogo de Insumos
          </h1>
          <p className="mt-1 text-sm text-[#3D2314]/60">
            Materiais e equipamentos usados nos serviços · {empresaNome}
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
            onClick={abrirNovo}
            className="inline-flex items-center gap-2 rounded-lg bg-[#3D2314] px-4 py-2 text-sm font-medium text-[#FAF7F2] hover:bg-[#3D2314]/90"
          >
            <Plus size={14} />
            Novo insumo
          </button>
        </div>
      </header>

      {erro && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{erro}</div>}
      {aviso && (
        <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">✓ {aviso}</div>
      )}

      {semInsumos ? (
        <EmptyStateImportar
          icon={Package}
          titulo="Catálogo vazio"
          descricao="Comece importando os insumos do nosso catálogo público. Você poderá editar tudo depois."
          ctaImportar="Importar biblioteca pública"
          ctaSecundario="ou criar um insumo manualmente"
          onImportar={importarBiblioteca}
          onCriarManual={abrirNovo}
          importando={importando}
        />
      ) : (
        <>
          {/* Toolbar */}
          <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-[#3D2314]/8 bg-white p-4 shadow-sm md:grid-cols-4">
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
                  placeholder="Nome, código ou fornecedor…"
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
                  <option key={c.codigo} value={c.codigo}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
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
            </div>
          </div>

          {/* Contador */}
          <p className="mb-3 text-xs text-[#3D2314]/60">
            {filtrados.length} de {insumos.length} insumo{insumos.length !== 1 ? "s" : ""}
          </p>

          {/* Tabela */}
          <CatalogoTable
            rows={filtrados}
            columns={colunas}
            loading={loading}
            rowKey={(i) => i.id}
            actions={acoes}
            emptyMessage="Nenhum insumo encontrado com esses filtros"
          />
        </>
      )}

      {/* Drawer form */}
      {drawerOpen && drawerInicial && (
        <CatalogoForm<Insumo>
          open={drawerOpen}
          titulo={drawerInicial.id ? "Editar insumo" : "Novo insumo"}
          subtitulo={drawerInicial.id ? drawerInicial.name : "Cadastrar material/equipamento"}
          fields={formFields}
          initial={{
            ...drawerInicial,
            ativo: drawerInicial.ativo === false ? "false" : "true",
          } as any}
          onClose={() => setDrawerOpen(false)}
          onSubmit={(v) => {
            const ativoVal = (v as any).ativo;
            return salvar({ ...v, ativo: ativoVal === "true" || ativoVal === true } as any);
          }}
          salvando={salvando}
          erro={erroForm}
          extraContent={
            drawerInicial.fork_from_publico_id ? (
              <div className="mt-4 rounded-lg bg-[#3D2314]/5 p-3 text-xs text-[#3D2314]/70">
                Este insumo foi clonado do catálogo público. Edições afetam apenas a sua empresa.
              </div>
            ) : null
          }
        />
      )}

      {/* Modal preço */}
      {modalPreco && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#3D2314]/60 p-4"
          onClick={() => setModalPreco(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-1 text-lg font-semibold text-[#3D2314]">
              Atualizar preço
            </h3>
            <p className="mb-4 text-sm text-[#3D2314]/60">
              {modalPreco.name} · atual {fmtBRL(modalPreco.current_cost)}
            </p>

            <label className="mb-1 block text-xs uppercase tracking-wider text-[#3D2314]/60">
              Novo preço (R$)
            </label>
            <input
              type="number"
              step="0.01"
              min={0}
              value={novoPreco}
              onChange={(e) => setNovoPreco(e.target.value)}
              className="mb-3 w-full rounded-lg border border-[#3D2314]/12 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none"
            />

            <label className="mb-1 block text-xs uppercase tracking-wider text-[#3D2314]/60">
              Data da compra
            </label>
            <input
              type="date"
              value={dataCompra}
              onChange={(e) => setDataCompra(e.target.value)}
              className="mb-4 w-full rounded-lg border border-[#3D2314]/12 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none"
            />

            <p className="mb-4 rounded-lg bg-[#C8941A]/10 p-3 text-xs text-[#3D2314]/70">
              Atualizar este preço dispara recálculo automático dos serviços que usam este insumo.
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => setModalPreco(null)}
                className="flex-1 rounded-lg bg-[#FAF7F2] py-2 text-sm text-[#3D2314]"
              >
                Cancelar
              </button>
              <button
                onClick={atualizarPreco}
                disabled={!novoPreco || salvandoPreco}
                className="flex-1 rounded-lg bg-[#3D2314] py-2 text-sm font-semibold text-[#FAF7F2] disabled:opacity-50"
              >
                {salvandoPreco ? "Salvando…" : "Atualizar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
