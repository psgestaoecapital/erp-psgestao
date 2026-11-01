// src/app/dashboard/projetos/insumos/page.tsx
// Catálogo de insumos do Hub Projetos (Fase 1)

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Package, Pencil, Trash2, TrendingUp, Upload, Plus, Search, Link2, RotateCcw, AlertTriangle } from "lucide-react";
import { useCompanyIds } from "@/lib/useCompanyIds";
import { supabaseBrowser } from "@/lib/authFetch";
import { comPrazo } from "@/lib/comPrazo";
import { CatalogoTable, type CatalogoColumn } from "@/components/projetos/CatalogoTable";
import { CatalogoForm, type FormField } from "@/components/projetos/CatalogoForm";
import { EmptyStateImportar } from "@/components/projetos/EmptyStateImportar";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";

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
  deleted_at?: string | null;
}

// Vínculo do insumo com o produto do estoque do GE integrado (RD-35): o custo vem do estoque.
interface VinculoGE {
  insumo_id: string;
  produto_id: string;
  usar_maior_custo: boolean;
  produto_codigo: string | null;
  produto_nome: string | null;
  saldo: number | null;
  custo_estoque: number | null;
}

interface ProdutoGE {
  id: string;
  codigo: string | null;
  nome: string;
  unidade: string | null;
  estoque_atual: number | null;
  custo_medio: number | null;
  ultimo_custo: number | null;
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
  const [filtroStatus, setFiltroStatus] = useState<"ativo" | "inativo" | "todos" | "excluido">("ativo");
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

  // Estoque GE
  const [vinculos, setVinculos] = useState<Record<string, VinculoGE>>({});
  const [modalGE, setModalGE] = useState<Insumo | null>(null);
  const [buscaGE, setBuscaGE] = useState("");
  const [produtosGE, setProdutosGE] = useState<ProdutoGE[]>([]);
  const [buscandoGE, setBuscandoGE] = useState(false);
  const [maiorCusto, setMaiorCusto] = useState(false);
  const [ligando, setLigando] = useState(false);

  const carregar = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErro(null);
    try {
      const supabase = supabaseBrowser();
      const [insR, catR] = await comPrazo(() => Promise.all([
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
      ]), { ms: 8000, tentativas: 1, label: 'projetos_insumos' });
      if (insR.error) throw insR.error;
      if (catR.error && catR.error.code !== "PGRST116") {
        // categorias é nice-to-have; sem ela ainda funciona
        console.warn("Categorias:", catR.error);
      }
      // A view expõe `status` ('ativo'/'inativo') e `forked_from`; a tela usa `ativo` e `fork_from_publico_id`.
      setInsumos(((insR.data as any[]) || []).map((r) => ({
        ...r,
        ativo: r.status !== "inativo",
        fork_from_publico_id: r.forked_from ?? null,
        deleted_at: r.deleted_at ?? null,
      })) as Insumo[]);
      setCategorias((catR.data as Categoria[]) || []);
      // Vínculos com o estoque do GE: complemento — se falhar, a lista segue sem a coluna preenchida.
      const vinR = await supabase.rpc("fn_hub_insumo_vinculos", { p_company_id: companyId });
      const mapa: Record<string, VinculoGE> = {};
      for (const v of ((vinR.data as any)?.vinculos as VinculoGE[]) || []) mapa[v.insumo_id] = v;
      setVinculos(mapa);
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
      const excluido = !!i.deleted_at;
      // A aba "Excluídos" mostra só os excluídos; os demais filtros nunca mostram excluídos.
      if (filtroStatus === "excluido") {
        if (!excluido) return false;
      } else {
        if (excluido) return false;
        if (filtroStatus === "ativo" && i.ativo === false) return false;
        if (filtroStatus === "inativo" && i.ativo !== false) return false;
      }
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
        // m16_insumos não tem coluna `ativo`: o estado vive em `status`.
        status: values.ativo !== false ? "ativo" : "inativo",
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
    if (!confirm(`Excluir o insumo "${i.name}"? Ele sai da lista, mas pode ser restaurado depois (filtro Status → Excluídos).`)) return;
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase.rpc("fn_projetos_deletar_insumo", {
        p_insumo_id: i.id,
      });
      if (error) throw error;
      if (data && data.success === false) {
        setErro(data.error || "Insumo não pode ser excluído");
        setTimeout(() => setErro(null), 5000);
        return;
      }
      setAviso(`Insumo "${i.name}" excluído (pode restaurar no filtro Excluídos)`);
      setTimeout(() => setAviso(null), 5000);
      await carregar();
    } catch (e: any) {
      setErro(e.message);
    }
  }

  async function restaurar(i: Insumo) {
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase.rpc("fn_projetos_restaurar_insumo", {
        p_insumo_id: i.id,
      });
      if (error) throw error;
      if (data && data.success === false) {
        setErro(data.error || "Insumo não pôde ser restaurado");
        setTimeout(() => setErro(null), 5000);
        return;
      }
      setAviso(`Insumo "${i.name}" restaurado`);
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

  // Busca (com atraso) de produtos do estoque para ligar ao insumo.
  useEffect(() => {
    if (!modalGE) return;
    const q = buscaGE.trim();
    if (q.length < 2) {
      setProdutosGE([]);
      return;
    }
    const t = setTimeout(async () => {
      setBuscandoGE(true);
      try {
        const { data, error } = await supabaseBrowser().rpc("fn_hub_insumo_buscar_produtos", {
          p_insumo_id: modalGE.id,
          p_busca: q,
          p_limite: 20,
        });
        if (error) throw error;
        setProdutosGE(((data as any)?.produtos as ProdutoGE[]) || []);
      } catch (e: any) {
        setErro(e.message);
      } finally {
        setBuscandoGE(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [buscaGE, modalGE]);

  function abrirEstoque(i: Insumo) {
    setModalGE(i);
    setBuscaGE("");
    setProdutosGE([]);
    setMaiorCusto(vinculos[i.id]?.usar_maior_custo ?? false);
  }

  // Liga o insumo ao produto e traz o custo real do estoque para o catálogo (recalcula os serviços que o usam).
  async function ligarProduto(p: ProdutoGE) {
    if (!modalGE) return;
    setLigando(true);
    try {
      const supabase = supabaseBrowser();
      const vin = await supabase.rpc("fn_hub_insumo_vincular", {
        p_insumo_id: modalGE.id,
        p_produto_id: p.id,
        p_usar_maior_custo: maiorCusto,
      });
      if (vin.error) throw vin.error;
      if ((vin.data as any)?.ok === false) throw new Error((vin.data as any).erro || "Não foi possível ligar");
      const cus = await supabase.rpc("fn_hub_insumo_custo", { p_insumo_id: modalGE.id });
      if (cus.error) throw cus.error;
      const custo = Number((cus.data as any)?.custo);
      if (Number.isFinite(custo) && custo > 0 && custo !== Number(modalGE.current_cost ?? 0)) {
        const up = await supabase.rpc("fn_projetos_atualizar_preco_insumo", {
          p_insumo_id: modalGE.id,
          p_novo_preco: custo,
          p_data_compra: new Date().toISOString().slice(0, 10),
        });
        if (up.error) throw up.error;
      }
      setAviso(`"${modalGE.name}" ligado ao estoque: ${p.nome}`);
      setTimeout(() => setAviso(null), 5000);
      setModalGE(null);
      await carregar();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setLigando(false);
    }
  }

  async function desligarProduto() {
    if (!modalGE) return;
    setLigando(true);
    try {
      const { error } = await supabaseBrowser().rpc("fn_hub_insumo_desvincular", { p_insumo_id: modalGE.id });
      if (error) throw error;
      setAviso(`"${modalGE.name}" desligado do estoque (mantém o último custo)`);
      setTimeout(() => setAviso(null), 5000);
      setModalGE(null);
      await carregar();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setLigando(false);
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
    { key: "erp_code", ajuda: "projetos.insumos.form.codigo", label: "Código", type: "text", required: true, placeholder: "INS-1" },
    {
      key: "unit",
      ajuda: "projetos.insumos.form.unidade",
      label: "Unidade",
      type: "select",
      required: true,
      options: UNIDADES,
    },
    {
      key: "name",
      ajuda: "projetos.insumos.form.nome",
      label: "Nome",
      type: "text",
      required: true,
      fullWidth: true,
      placeholder: "Ex: Placa de gesso 1,2x0,6m",
    },
    {
      key: "category",
      ajuda: "projetos.insumos.form.categoria",
      label: "Categoria",
      type: "select",
      options: categorias.map((c) => ({ value: c.codigo, label: c.nome })),
    },
    {
      key: "current_cost",
      ajuda: "projetos.insumos.form.custo",
      label: "Custo atual (R$)",
      type: "number",
      step: "0.01",
      min: 0,
    },
    { key: "supplier", ajuda: "projetos.insumos.form.fornecedor", label: "Fornecedor", type: "text", placeholder: "Nome do fornecedor" },
    { key: "ncm", ajuda: "projetos.insumos.form.ncm", label: "NCM", type: "text", placeholder: "00000000" },
    {
      key: "especificacao_tecnica",
      ajuda: "projetos.insumos.form.especificacao",
      label: "Especificação técnica",
      type: "textarea",
      fullWidth: true,
    },
    {
      key: "observacoes",
      ajuda: "projetos.insumos.form.observacoes",
      label: "Observações",
      type: "textarea",
      fullWidth: true,
    },
    {
      key: "ativo",
      ajuda: "projetos.insumos.form.status",
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
      ajuda: "projetos.insumos.col_code",
      hiddenOnMobile: true,
      render: (i) => (
        <span className="font-mono text-xs text-[#3D2314]/70">{i.erp_code || "—"}</span>
      ),
    },
    {
      key: "name",
      label: "Nome",
      ajuda: "projetos.insumos.col_name",
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
      ajuda: "projetos.insumos.col_category",
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
      ajuda: "projetos.insumos.col_unit",
      hiddenOnMobile: true,
      render: (i) => <span className="text-[#3D2314]/70">{i.unit || "—"}</span>,
    },
    {
      key: "current_cost",
      label: "Preço",
      ajuda: "projetos.insumos.col_current_cost",
      align: "right",
      render: (i) => (
        <span className="font-mono text-[#3D2314]">{fmtBRL(i.current_cost)}</span>
      ),
    },
    {
      key: "variacao",
      label: "Variação",
      ajuda: "projetos.insumos.col_variacao",
      align: "right",
      hiddenOnMobile: true,
      render: (i) => {
        if (i.variacao_pct === null || i.variacao_pct === undefined || i.variacao_pct === 0) {
          // Estado-vazio explicado: a variação compara o preço atual com o da compra anterior;
          // sem um segundo preço no histórico não há o que comparar (não é erro de leitura).
          return (
            <span
              className="text-[#3D2314]/40"
              title="Sem variação: é preciso ao menos dois preços (compra anterior e atual) para comparar"
            >
              —
            </span>
          );
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
      key: "estoque",
      label: "Estoque (GE)",
      ajuda: "projetos.insumos.estoque",
      hiddenOnMobile: true,
      render: (i) => {
        const v = vinculos[i.id];
        // Sem vínculo: nunca deixar a coluna muda — oferecer a ação de ligar ali mesmo (estado-vazio com CTA).
        if (!v) return (
          <button
            onClick={(e) => { e.stopPropagation(); abrirEstoque(i); }}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-[#C8941A] hover:bg-[#C8941A]/10"
            title="Ligar este insumo a um produto do estoque do GE para puxar o custo real"
          >
            <Link2 size={11} /> Ligar ao estoque
          </button>
        );
        // Divergência: preço do catálogo (current_cost) vs custo real do estoque. >1% = alerta.
        const cat = Number(i.current_cost ?? 0);
        const est = Number(v.custo_estoque ?? 0);
        const diverge = cat > 0 && est > 0 && Math.abs(cat - est) / est > 0.01;
        const difPct = est > 0 ? ((cat - est) / est) * 100 : 0;
        return (
          <div className="text-xs">
            <div className="font-medium text-[#3D2314]">{v.produto_codigo ? `${v.produto_codigo} · ` : ""}{v.produto_nome}</div>
            <div className="text-[#3D2314]/60">saldo {v.saldo ?? 0} · custo {fmtBRL(v.custo_estoque)}</div>
            {diverge && (
              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                <AlertTriangle size={11} />
                catálogo {difPct > 0 ? "+" : ""}{difPct.toFixed(1)}%
                <AjudaCampo chave="projetos.insumos.divergencia" />
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "uso",
      label: "Em uso",
      ajuda: "projetos.insumos.col_uso",
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

  const acoes = (i: Insumo) =>
    i.deleted_at ? (
      <div className="flex items-center justify-end gap-1">
        <button
          onClick={() => restaurar(i)}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-emerald-700 hover:bg-emerald-50"
          title="Restaurar insumo"
        >
          <RotateCcw size={14} />
          <span className="text-xs font-medium">Restaurar</span>
        </button>
        <AjudaCampo chave="projetos.insumos.restaurar" alinhar="fim" />
      </div>
    ) : (
    <div className="flex items-center justify-end gap-1">
      <button
        onClick={() => abrirEstoque(i)}
        className={`rounded-lg p-1.5 hover:bg-[#3D2314]/5 hover:text-[#3D2314] ${vinculos[i.id] ? "text-emerald-700" : "text-[#3D2314]/60"}`}
        title={vinculos[i.id] ? "Trocar produto do estoque" : "Ligar ao estoque"}
      >
        <Link2 size={14} />
      </button>
      <AjudaCampo chave="projetos.insumos.estoque" />
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
        title={(i.qtd_servicos_uso ?? 0) > 0 ? "Em uso, não pode excluir" : "Excluir"}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );

  const semInsumos = !loading && insumos.length === 0;
  const empresaNome = empresa?.nome_fantasia || empresa?.razao_social || "—";

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
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
          <AjudaCampo chave="projetos.insumos.importar" alinhar="fim" />
          <button
            onClick={abrirNovo}
            className="inline-flex items-center gap-2 rounded-lg bg-[#3D2314] px-4 py-2 text-sm font-medium text-[#FAF7F2] hover:bg-[#3D2314]/90"
          >
            <Plus size={14} />
            Novo insumo
          </button>
          <AjudaCampo chave="projetos.insumos.novo" alinhar="fim" />
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
            <label className="block md:col-span-2">
              <span className="mb-1 flex items-center gap-1 text-xs uppercase tracking-wider text-[#3D2314]/60">
                Buscar <AjudaCampo chave="projetos.insumos.busca" />
              </span>
              <span className="relative block">
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
              </span>
            </label>
            <label className="block">
              <span className="mb-1 flex items-center gap-1 text-xs uppercase tracking-wider text-[#3D2314]/60">
                Categoria <AjudaCampo chave="projetos.insumos.filtro_categoria" />
              </span>
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
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 flex items-center gap-1 text-xs uppercase tracking-wider text-[#3D2314]/60">
                  Status <AjudaCampo chave="projetos.insumos.filtro_status" />
                </span>
                <select
                  value={filtroStatus}
                  onChange={(e) => setFiltroStatus(e.target.value as any)}
                  className="w-full rounded-lg border border-[#3D2314]/12 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none"
                >
                  <option value="ativo">Ativos</option>
                  <option value="inativo">Inativos</option>
                  <option value="todos">Todos</option>
                  <option value="excluido">Excluídos</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 flex items-center gap-1 text-xs uppercase tracking-wider text-[#3D2314]/60">
                  Origem <AjudaCampo chave="projetos.insumos.filtro_origem" />
                </span>
                <select
                  value={filtroOrigem}
                  onChange={(e) => setFiltroOrigem(e.target.value as any)}
                  className="w-full rounded-lg border border-[#3D2314]/12 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none"
                >
                  <option value="todos">Todas</option>
                  <option value="manual">Manual</option>
                  <option value="fork">Biblioteca</option>
                </select>
              </label>
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

      {/* Modal estoque GE */}
      {modalGE && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[#3D2314]/60 p-0 sm:items-center sm:p-4"
          onClick={() => setModalGE(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-1 text-lg font-semibold text-[#3D2314]">Ligar ao estoque</h3>
            <p className="mb-4 text-sm text-[#3D2314]/60">
              {modalGE.name}
              {vinculos[modalGE.id] ? ` · hoje: ${vinculos[modalGE.id].produto_nome}` : " · sem ligação"}
            </p>
            <label className="block">
              <span className="mb-1 flex items-center gap-1 text-xs uppercase tracking-wider text-[#3D2314]/60">
                Buscar produto do estoque <AjudaCampo chave="projetos.insumos.estoque_busca" />
              </span>
              <input
                type="text"
                autoFocus
                value={buscaGE}
                onChange={(e) => setBuscaGE(e.target.value)}
                placeholder="Nome ou código do produto…"
                className="mb-3 w-full rounded-lg border border-[#3D2314]/12 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none"
              />
            </label>
            <label className="mb-3 flex items-center gap-2 text-sm text-[#3D2314]">
              <input type="checkbox" checked={maiorCusto} onChange={(e) => setMaiorCusto(e.target.checked)} />
              Usar o maior custo (médio × última compra)
              <AjudaCampo chave="projetos.insumos.estoque_maior" />
            </label>
            <ul className="mb-4 divide-y divide-[#3D2314]/8 rounded-lg border border-[#3D2314]/8">
              {buscandoGE && <li className="p-3 text-sm text-[#3D2314]/60">Buscando…</li>}
              {!buscandoGE && buscaGE.trim().length < 2 && produtosGE.length === 0 && (
                <li className="p-3 text-sm text-[#3D2314]/60">Digite o nome ou o código de um produto do estoque do GE para ligar. Se o estoque ainda não tem produtos cadastrados, cadastre-os no GE (Estoque) — o custo real virá de lá.</li>
              )}
              {!buscandoGE && buscaGE.trim().length >= 2 && produtosGE.length === 0 && (
                <li className="p-3 text-sm text-[#3D2314]/60">Nenhum produto do estoque bate com esse termo. Confira o cadastro no GE (Estoque) ou tente outro nome/código.</li>
              )}
              {produtosGE.map((p) => (
                <li key={p.id}>
                  <button
                    disabled={ligando}
                    onClick={() => ligarProduto(p)}
                    className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-[#FAF7F2] disabled:opacity-50"
                  >
                    <span>
                      <span className="block text-sm font-medium text-[#3D2314]">{p.nome}</span>
                      <span className="block text-xs text-[#3D2314]/60">
                        {p.codigo || "sem código"} · saldo {p.estoque_atual ?? 0} {p.unidade || ""}
                      </span>
                    </span>
                    <span className="font-mono text-sm text-[#3D2314]">{fmtBRL(p.custo_medio)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button onClick={() => setModalGE(null)} className="flex-1 rounded-lg bg-[#FAF7F2] py-2 text-sm text-[#3D2314]">
                Fechar
              </button>
              {vinculos[modalGE.id] && (
                <button
                  onClick={desligarProduto}
                  disabled={ligando}
                  className="flex-1 rounded-lg border border-red-200 py-2 text-sm text-red-700 disabled:opacity-50"
                >
                  Desligar
                </button>
              )}
            </div>
          </div>
        </div>
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

            <label className="block">
              <span className="mb-1 flex items-center gap-1 text-xs uppercase tracking-wider text-[#3D2314]/60">
                Novo preço (R$) <AjudaCampo chave="projetos.insumos.preco_novo" />
              </span>
              <input
                type="number"
                step="0.01"
                min={0}
                value={novoPreco}
                onChange={(e) => setNovoPreco(e.target.value)}
                className="mb-3 w-full rounded-lg border border-[#3D2314]/12 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="mb-1 flex items-center gap-1 text-xs uppercase tracking-wider text-[#3D2314]/60">
                Data da compra <AjudaCampo chave="projetos.insumos.preco_data" />
              </span>
              <input
                type="date"
                value={dataCompra}
                onChange={(e) => setDataCompra(e.target.value)}
                className="mb-4 w-full rounded-lg border border-[#3D2314]/12 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none"
              />
            </label>

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
