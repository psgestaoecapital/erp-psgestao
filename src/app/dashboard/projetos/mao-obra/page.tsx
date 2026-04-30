// src/app/dashboard/projetos/mao-obra/page.tsx
// Catálogo de mão de obra do Hub Projetos (Fase 1)

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HardHat, Pencil, Trash2, Upload, Plus, Search } from "lucide-react";
import { useCompanyIds } from "@/lib/useCompanyIds";
import { supabaseBrowser } from "@/lib/authFetch";
import { CatalogoTable, type CatalogoColumn } from "@/components/projetos/CatalogoTable";
import { CatalogoForm, type FormField } from "@/components/projetos/CatalogoForm";
import { EmptyStateImportar } from "@/components/projetos/EmptyStateImportar";

interface MaoObra {
  id: string;
  company_id: string;
  codigo: string | null;
  funcao: string;
  descricao: string | null;
  custo_hora: number | null;
  custo_mes: number | null;
  encargos_pct: number | null;
  tipo_contratacao: string | null;
  qtd_servicos_uso: number | null;
  is_publico: boolean | null;
  fork_from_publico_id: string | null;
  ativo: boolean | null;
  observacoes?: string | null;
}

const TIPOS_CONTRATACAO = [
  { value: "CLT", label: "CLT" },
  { value: "PJ", label: "PJ" },
  { value: "Terceirizado", label: "Terceirizado" },
  { value: "Empreitada", label: "Empreitada" },
];

function fmtBRL(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function MaoObraPage() {
  const { sel, companies } = useCompanyIds();
  const companyId = sel && !sel.startsWith("group_") && sel !== "consolidado" ? sel : null;
  const empresa = companies.find((c) => c.id === companyId);

  const [items, setItems] = useState<MaoObra[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Filtros
  const [busca, setBusca] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<"ativo" | "inativo" | "todos">("ativo");
  const [filtroOrigem, setFiltroOrigem] = useState<"todos" | "manual" | "fork">("todos");

  // Form drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerInicial, setDrawerInicial] = useState<MaoObra | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);

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
      const { data, error } = await supabase
        .from("v_projetos_mao_obra_ui")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_publico", false)
        .order("funcao");
      if (error) throw error;
      setItems((data as MaoObra[]) || []);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const filtrados = useMemo(() => {
    return items.filter((m) => {
      if (filtroStatus === "ativo" && m.ativo === false) return false;
      if (filtroStatus === "inativo" && m.ativo !== false) return false;
      if (filtroOrigem === "fork" && !m.fork_from_publico_id) return false;
      if (filtroOrigem === "manual" && m.fork_from_publico_id) return false;
      if (filtroTipo && m.tipo_contratacao !== filtroTipo) return false;
      if (busca) {
        const q = busca.toLowerCase();
        const hay = [m.funcao, m.codigo, m.descricao].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, busca, filtroTipo, filtroStatus, filtroOrigem]);

  function abrirNovo() {
    setDrawerInicial({
      id: "",
      company_id: companyId || "",
      codigo: `MO-${items.length + 1}`,
      funcao: "",
      descricao: null,
      custo_hora: null,
      custo_mes: null,
      encargos_pct: 80,
      tipo_contratacao: "CLT",
      qtd_servicos_uso: 0,
      is_publico: false,
      fork_from_publico_id: null,
      ativo: true,
    });
    setErroForm(null);
    setDrawerOpen(true);
  }

  function abrirEditar(m: MaoObra) {
    setDrawerInicial(m);
    setErroForm(null);
    setDrawerOpen(true);
  }

  async function salvar(values: any) {
    if (!companyId) return;
    setSalvando(true);
    setErroForm(null);
    try {
      const supabase = supabaseBrowser();
      // Calcula custo_hora a partir de custo_mes se vier sem custo_hora
      let custoHora = values.custo_hora;
      const custoMes = values.custo_mes;
      if ((custoHora === null || custoHora === undefined || custoHora === "") && custoMes) {
        custoHora = parseFloat(custoMes) / 220;
      }
      const payload = {
        company_id: companyId,
        codigo: values.codigo || null,
        funcao: values.funcao,
        descricao: values.descricao || null,
        custo_hora: custoHora ? parseFloat(custoHora) : null,
        custo_mes: custoMes ? parseFloat(custoMes) : null,
        encargos_pct: values.encargos_pct != null ? parseFloat(values.encargos_pct) : null,
        tipo_contratacao: values.tipo_contratacao || null,
        ativo: values.ativo === "true" || values.ativo === true,
        observacoes: values.observacoes || null,
      };

      if (drawerInicial?.id) {
        const { error } = await supabase
          .from("projetos_mao_obra")
          .update(payload)
          .eq("id", drawerInicial.id);
        if (error) throw error;
        setAviso(`Função "${values.funcao}" atualizada`);
      } else {
        const { error } = await supabase.from("projetos_mao_obra").insert(payload);
        if (error) throw error;
        setAviso(`Função "${values.funcao}" criada`);
      }
      setTimeout(() => setAviso(null), 4000);
      setDrawerOpen(false);
      await carregar();
    } catch (e: any) {
      setErroForm(e.message);
    } finally {
      setSalvando(false);
    }
  }

  async function deletar(m: MaoObra) {
    if (!confirm(`Deletar função "${m.funcao}"?`)) return;
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase.rpc("fn_projetos_deletar_mao_obra", {
        p_mo_id: m.id,
      });
      if (error) throw error;
      if (data && data.success === false) {
        setErro(data.error || "Função em uso, não pode deletar");
        setTimeout(() => setErro(null), 5000);
        return;
      }
      setAviso(`Função "${m.funcao}" removida`);
      setTimeout(() => setAviso(null), 4000);
      await carregar();
    } catch (e: any) {
      setErro(e.message);
    }
  }

  async function importarBiblioteca() {
    if (!companyId) return;
    if (!confirm("Importar biblioteca pública de mão de obra?")) return;
    setImportando(true);
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase.rpc("fn_projetos_importar_catalogo_publico", {
        p_company_id: companyId,
        p_incluir_insumos: false,
        p_incluir_mao_obra: true,
        p_incluir_servicos: false,
      });
      if (error) throw error;
      const qtd = (data && (data.mao_obra_importadas ?? data.qtd_mao_obra)) ?? "vários";
      setAviso(`Biblioteca importada: ${qtd} funções`);
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
          O catálogo de mão de obra é por empresa específica.
        </p>
      </main>
    );
  }

  // Schema do form
  const formFields: FormField[] = [
    { key: "codigo", label: "Código", type: "text", required: false, placeholder: "MO-1" },
    {
      key: "tipo_contratacao",
      label: "Tipo",
      type: "radio",
      options: TIPOS_CONTRATACAO,
    },
    {
      key: "funcao",
      label: "Função",
      type: "text",
      required: true,
      fullWidth: true,
      placeholder: "Ex: Gesseiro",
    },
    {
      key: "descricao",
      label: "Descrição",
      type: "textarea",
      fullWidth: true,
      placeholder: "Atribuições e qualificações",
    },
    {
      key: "custo_hora",
      label: "Custo / hora (R$)",
      type: "number",
      step: "0.01",
      min: 0,
      hint: "Se vazio, será calculado a partir do custo mensal ÷ 220h",
    },
    {
      key: "custo_mes",
      label: "Custo / mês (R$)",
      type: "number",
      step: "0.01",
      min: 0,
      hint: "Salário base ou valor mensal contratado",
    },
    {
      key: "encargos_pct",
      label: "Encargos (%)",
      type: "number",
      step: "0.1",
      min: 0,
      max: 200,
      hint: "Padrão: 80% para CLT, 0% para PJ",
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
    {
      key: "observacoes",
      label: "Observações",
      type: "textarea",
      fullWidth: true,
    },
  ];

  const colunas: CatalogoColumn<MaoObra>[] = [
    {
      key: "codigo",
      label: "Código",
      hiddenOnMobile: true,
      render: (m) => (
        <span className="font-mono text-xs text-[#3D2314]/70">{m.codigo || "—"}</span>
      ),
    },
    {
      key: "funcao",
      label: "Função",
      render: (m) => (
        <div>
          <div className="font-medium text-[#3D2314]">{m.funcao}</div>
          {m.fork_from_publico_id && (
            <span className="mt-0.5 inline-block rounded-full bg-[#3D2314]/8 px-2 py-0.5 text-[10px] uppercase tracking-wider text-[#3D2314]/60">
              biblioteca
            </span>
          )}
        </div>
      ),
    },
    {
      key: "tipo",
      label: "Tipo",
      hiddenOnMobile: true,
      render: (m) =>
        m.tipo_contratacao ? (
          <span className="rounded-full bg-[#C8941A]/15 px-2 py-0.5 text-xs font-medium text-[#3D2314]">
            {m.tipo_contratacao}
          </span>
        ) : (
          <span className="text-[#3D2314]/40">—</span>
        ),
    },
    {
      key: "custo_hora",
      label: "Custo/hora",
      align: "right",
      render: (m) => <span className="font-mono text-[#3D2314]">{fmtBRL(m.custo_hora)}</span>,
    },
    {
      key: "custo_mes",
      label: "Custo/mês est.",
      align: "right",
      hiddenOnMobile: true,
      render: (m) => {
        const v = m.custo_hora ? m.custo_hora * 220 : null;
        return <span className="font-mono text-[#3D2314]/70">{fmtBRL(v)}</span>;
      },
    },
    {
      key: "encargos",
      label: "Encargos",
      align: "right",
      hiddenOnMobile: true,
      render: (m) => (
        <span className="text-[#3D2314]/70">
          {m.encargos_pct != null ? `${m.encargos_pct}%` : "—"}
        </span>
      ),
    },
    {
      key: "uso",
      label: "Em uso",
      align: "center",
      render: (m) => (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            (m.qtd_servicos_uso ?? 0) > 0
              ? "bg-emerald-50 text-emerald-700"
              : "bg-[#3D2314]/5 text-[#3D2314]/40"
          }`}
        >
          {m.qtd_servicos_uso ?? 0} serv.
        </span>
      ),
    },
  ];

  const acoes = (m: MaoObra) => (
    <div className="flex items-center justify-end gap-1">
      <button
        onClick={() => abrirEditar(m)}
        className="rounded-lg p-1.5 text-[#3D2314]/60 hover:bg-[#3D2314]/5 hover:text-[#3D2314]"
        title="Editar"
      >
        <Pencil size={14} />
      </button>
      <button
        onClick={() => deletar(m)}
        disabled={(m.qtd_servicos_uso ?? 0) > 0}
        className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
        title={(m.qtd_servicos_uso ?? 0) > 0 ? "Em uso, não pode deletar" : "Deletar"}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );

  const semItems = !loading && items.length === 0;
  const empresaNome = empresa?.nome_fantasia || empresa?.razao_social || "—";

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1
            className="text-2xl font-medium text-[#3D2314]"
            style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal", letterSpacing: "-0.01em" }}
          >
            Mão de Obra
          </h1>
          <p className="mt-1 text-sm text-[#3D2314]/60">
            Funções profissionais com custo por hora · {empresaNome}
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
            Nova função
          </button>
        </div>
      </header>

      {erro && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{erro}</div>}
      {aviso && (
        <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">✓ {aviso}</div>
      )}

      {semItems ? (
        <EmptyStateImportar
          icon={HardHat}
          titulo="Catálogo vazio"
          descricao="Comece importando as funções do catálogo público (gesseiro, ajudante, mestre etc)."
          ctaImportar="Importar biblioteca pública"
          ctaSecundario="ou criar uma função manualmente"
          onImportar={importarBiblioteca}
          onCriarManual={abrirNovo}
          importando={importando}
        />
      ) : (
        <>
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
                  placeholder="Função, código, descrição…"
                  className="w-full rounded-lg border border-[#3D2314]/12 bg-white py-2 pl-9 pr-3 text-sm focus:border-[#C8941A] focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wider text-[#3D2314]/60">
                Tipo
              </label>
              <select
                value={filtroTipo}
                onChange={(e) => setFiltroTipo(e.target.value)}
                className="w-full rounded-lg border border-[#3D2314]/12 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none"
              >
                <option value="">Todos</option>
                {TIPOS_CONTRATACAO.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
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

          <p className="mb-3 text-xs text-[#3D2314]/60">
            {filtrados.length} de {items.length} funç{items.length !== 1 ? "ões" : "ão"}
          </p>

          <CatalogoTable
            rows={filtrados}
            columns={colunas}
            loading={loading}
            rowKey={(m) => m.id}
            actions={acoes}
            emptyMessage="Nenhuma função encontrada com esses filtros"
          />
        </>
      )}

      {drawerOpen && drawerInicial && (
        <CatalogoForm
          open={drawerOpen}
          titulo={drawerInicial.id ? "Editar função" : "Nova função"}
          subtitulo={drawerInicial.id ? drawerInicial.funcao : "Cadastrar profissional"}
          fields={formFields}
          initial={
            {
              ...drawerInicial,
              ativo: drawerInicial.ativo === false ? "false" : "true",
            } as any
          }
          onClose={() => setDrawerOpen(false)}
          onSubmit={(v) => salvar(v)}
          salvando={salvando}
          erro={erroForm}
          extraContent={
            <CalculadoraCusto
              custoHora={
                typeof drawerInicial?.custo_hora === "number" ? drawerInicial.custo_hora : null
              }
              encargosPct={
                typeof drawerInicial?.encargos_pct === "number" ? drawerInicial.encargos_pct : null
              }
            />
          }
        />
      )}
    </main>
  );
}

function CalculadoraCusto({
  custoHora,
  encargosPct,
}: {
  custoHora: number | null;
  encargosPct: number | null;
}) {
  if (!custoHora) return null;
  const mensalBase = custoHora * 220;
  const encargos = encargosPct ? (mensalBase * encargosPct) / 100 : 0;
  const total = mensalBase + encargos;
  return (
    <div className="mt-4 rounded-lg bg-[#FAF7F2] p-3 text-xs text-[#3D2314]/70">
      <div className="mb-1 font-semibold text-[#3D2314]">Estimativa mensal</div>
      <div>
        Salário base: {mensalBase.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}{" "}
        <span className="text-[#3D2314]/40">(220h × custo/hora)</span>
      </div>
      {encargosPct ? (
        <div>
          + Encargos {encargosPct}%:{" "}
          {encargos.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
        </div>
      ) : null}
      <div className="mt-1 font-semibold text-[#3D2314]">
        = Total: {total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
        /mês
      </div>
    </div>
  );
}
