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
  FileText,
} from "lucide-react";
import { useCompanyIds } from "@/lib/useCompanyIds";
import { supabaseBrowser } from "@/lib/authFetch";
import { comPrazo } from "@/lib/comPrazo";
import { CatalogoTable, type CatalogoColumn } from "@/components/projetos/CatalogoTable";
import { EmptyStateImportar } from "@/components/projetos/EmptyStateImportar";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { ComposicaoCpu } from "@/components/projetos/ComposicaoCpu";

const ROTA = "/dashboard/projetos/catalogo";

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
  qtd_insumos: number | null;
  qtd_mo: number | null;
  is_publico: boolean | null;
  // Origem do dado (RD-98 pilar 3): de onde veio este serviço.
  // source_type vem da view v_projetos_servicos_catalogo: 'fork' (copiado da biblioteca
  // pública), 'demo' (semeado para demonstração) ou 'manual' (criado pela própria empresa).
  source_type: string | null;
  source_ref: string | null;
  foi_forkado: boolean | null;
  ativo: boolean | null;
}

type OrigemInfo = { label: string; cls: string; titulo: string };

// Traduz source_type num selo visível e honesto de origem (RD-98). Antes a tela lia um
// campo inexistente (fork_from_publico_id), então nenhum selo de origem aparecia.
function origemDoServico(s: Servico): OrigemInfo {
  switch (s.source_type) {
    case "fork":
      return {
        label: "Biblioteca",
        cls: "bg-[#3D2314]/8 text-[#3D2314]/70",
        titulo: "Copiado da biblioteca pública de serviços (base SINAPI/TCPO/PS). Edite para virar um serviço próprio da empresa.",
      };
    case "demo":
      return {
        label: "Demonstração",
        cls: "bg-amber-100 text-amber-800",
        titulo: "Serviço de demonstração (dado semeado para você testar). Substitua pelos serviços reais da sua empresa.",
      };
    case "manual":
    default:
      return {
        label: "Próprio",
        cls: "bg-emerald-100 text-emerald-800",
        titulo: "Serviço criado pela sua empresa, com composição e preço próprios.",
      };
  }
}

// Preço/BDI de UMA fonte só (fn_projetos_catalogo_precos → mesma função do detalhe da composição).
interface PrecoServico {
  servico_id: string;
  custo: number | null;
  preco_venda: number | null;
  bdi_pct: number | null;
  fonte: "motor" | "bdi_empresa" | "sem_bdi";
  insumos_total: number;
  insumos_ligados_estoque: number;
}

interface InsumoEstoque {
  insumo_id: string;
  codigo: string | null;
  nome: string;
  unidade: string | null;
  produto_id: string | null;
  produto_nome: string | null;
  produto_codigo: string | null;
  estoque_atual: number | null;
}

interface ProdutoBusca {
  id: string;
  codigo: string | null;
  nome: string;
  unidade: string | null;
  estoque_atual: number | null;
}

const FONTE_BDI: Record<PrecoServico["fonte"], string> = {
  motor: "Precificação da empresa",
  bdi_empresa: "BDI padrão da empresa",
  sem_bdi: "Sem BDI configurado",
};

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
  const [filtroOrigem, setFiltroOrigem] = useState<"todos" | "manual" | "fork" | "demo">("todos");
  const [filtroStatus, setFiltroStatus] = useState<"ativo" | "inativo" | "todos">("ativo");
  const [apenasComBom, setApenasComBom] = useState(false);
  // Colunas de valor (Custo, BDI, Preço venda, Estoque) visíveis sem rolagem: por padrão recolhemos as
  // secundárias (Un, Produtividade, Origem) no computador; o toggle expande para ver todas (auditoria PDCA 01/11).
  const [colsDetalhe, setColsDetalhe] = useState(false);

  const [importando, setImportando] = useState(false);
  const [criando, setCriando] = useState(false);
  // "Gerar orçamento a partir do serviço": encurta a cadeia FC (serviço → orçamento) para 1 clique.
  const [gerandoOrc, setGerandoOrc] = useState<string | null>(null);

  // HB0 item 5 (CEO): clicar em "Novo serviço" NÃO grava mais em branco — abre o modal e só grava no "Criar serviço".
  // Detalhe da composição (material, mão de obra, equipamento, impostos e margem) aberto pelo selo de BOM, sem sair da tela.
  const [bomDe, setBomDe] = useState<Servico | null>(null);
  const [precos, setPrecos] = useState<Record<string, PrecoServico>>({});
  // Exclusão rastreável (RD-98): pede o motivo; o serviço sai da lista mas nada é apagado.
  const [excluindo, setExcluindo] = useState<Servico | null>(null);
  const [motivo, setMotivo] = useState("");
  const [excluindoOcupado, setExcluindoOcupado] = useState(false);
  // "Ligar ao estoque": insumos do serviço × produtos reais do estoque da empresa.
  const [estoqueDe, setEstoqueDe] = useState<Servico | null>(null);
  const [insumosEst, setInsumosEst] = useState<InsumoEstoque[]>([]);
  const [carregandoEst, setCarregandoEst] = useState(false);
  const [escolhendo, setEscolhendo] = useState<string | null>(null);
  const [buscaProd, setBuscaProd] = useState("");
  const [produtos, setProdutos] = useState<ProdutoBusca[]>([]);
  const [novoAberto, setNovoAberto] = useState(false);
  const [novo, setNovo] = useState({ nome: "", codigo: "", categoria: "", unidade: "m²" });

  const carregar = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErro(null);
    try {
      const supabase = supabaseBrowser();
      const [servR, cfgR, preR] = await comPrazo(() => Promise.all([
        supabase
          .from("v_projetos_servicos_catalogo")
          .select("*")
          .eq("company_id", companyId)
          .eq("is_publico", false)
          .order("codigo"),
        supabase
          .from("projetos_modulo_config")
          .select("bdi_total_pct, bdi_lucro_pct, margem_minima_pct")
          .eq("company_id", companyId)
          .maybeSingle(),
        supabase.rpc("fn_projetos_catalogo_precos", { p_company_id: companyId }),
      ]), { ms: 8000, tentativas: 1, label: 'projetos_catalogo' });
      if (servR.error) throw servR.error;
      if (cfgR.error && cfgR.error.code !== "PGRST116") throw cfgR.error;
      setServicos((servR.data as Servico[]) || []);
      setConfig((cfgR.data as ConfigBdi) || null);
      const mapa: Record<string, PrecoServico> = {};
      if (!preR.error) {
        for (const p of ((preR.data as any)?.servicos ?? []) as PrecoServico[]) mapa[p.servico_id] = p;
      }
      setPrecos(mapa);
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
      // Filtro de origem pelo source_type real da view (manual = próprio, fork = biblioteca, demo = demonstração).
      if (filtroOrigem !== "todos") {
        const st = s.source_type || "manual";
        if (filtroOrigem === "manual" && st !== "manual") return false;
        if (filtroOrigem === "fork" && st !== "fork") return false;
        if (filtroOrigem === "demo" && st !== "demo") return false;
      }
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

  // Abre o modal de criação (NÃO grava nada — correção do HB0 item 5). Sugere um código, que o usuário pode trocar.
  function abrirNovo() {
    if (!companyId) return;
    setErro(null);
    setNovo({ nome: "", codigo: `SERV-${servicos.length + 1}`, categoria: "", unidade: "m²" });
    setNovoAberto(true);
  }

  // Só AQUI grava — ao confirmar o modal, com o nome preenchido. Depois leva à edição para montar o BOM/CPU.
  async function confirmarNovo() {
    if (!companyId) return;
    const nome = novo.nome.trim();
    const unidade = novo.unidade.trim() || "m²";
    if (!nome) {
      setErro("Dê um nome ao serviço antes de criar.");
      return;
    }
    setCriando(true);
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase
        .from("projetos_servicos")
        .insert({
          company_id: companyId,
          codigo: novo.codigo.trim() || `SERV-${servicos.length + 1}`,
          nome,
          categoria: novo.categoria.trim() || null,
          unidade, // NOT NULL no banco
          ativo: true,
        })
        .select("id")
        .single();
      if (error) throw error;
      setNovoAberto(false);
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

  function pedirExclusao(s: Servico) {
    setErro(null);
    setMotivo("");
    setExcluindo(s);
  }

  async function confirmarExclusao() {
    if (!excluindo) return;
    if (motivo.trim().length < 3) {
      setErro("Informe o motivo da exclusão (mínimo 3 letras).");
      return;
    }
    setExcluindoOcupado(true);
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase.rpc("fn_projetos_deletar_servico", {
        p_servico_id: excluindo.id,
        p_motivo: motivo.trim(),
      });
      if (error) throw error;
      if (data && data.success === false) {
        setErro(data.error || "Serviço não pode ser excluído");
        return;
      }
      setAviso(`Serviço "${excluindo.nome}" excluído (fica no histórico de auditoria)`);
      setTimeout(() => setAviso(null), 4000);
      setExcluindo(null);
      await carregar();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setExcluindoOcupado(false);
    }
  }

  async function abrirEstoque(s: Servico) {
    setEstoqueDe(s);
    setEscolhendo(null);
    setBuscaProd("");
    setProdutos([]);
    setCarregandoEst(true);
    try {
      const { data, error } = await supabaseBrowser().rpc("fn_projetos_servico_insumos_estoque", { p_servico_id: s.id });
      if (error) throw error;
      setInsumosEst(((data as any)?.insumos ?? []) as InsumoEstoque[]);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregandoEst(false);
    }
  }

  async function buscarProdutos(q: string) {
    setBuscaProd(q);
    if (!companyId || q.trim().length < 2) {
      setProdutos([]);
      return;
    }
    const termo = q.trim().replace(/[%,]/g, " ");
    const { data } = await supabaseBrowser()
      .from("erp_produtos")
      .select("id, codigo, nome, unidade, estoque_atual")
      .eq("company_id", companyId)
      .eq("ativo", true)
      .or(`nome.ilike.%${termo}%,codigo.ilike.%${termo}%`)
      .order("nome")
      .limit(8);
    setProdutos((data as ProdutoBusca[]) || []);
  }

  async function ligarInsumo(insumoId: string, produtoId: string | null) {
    try {
      const { error } = await supabaseBrowser().rpc("fn_projetos_insumo_ligar_estoque", {
        p_insumo_id: insumoId,
        p_produto_id: produtoId,
      });
      if (error) throw error;
      setEscolhendo(null);
      setBuscaProd("");
      setProdutos([]);
      if (estoqueDe) await abrirEstoque(estoqueDe);
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
      ajuda: "projetos.catalogo.col_codigo",
      hiddenOnMobile: true,
      render: (s) => (
        <span className="font-mono text-xs text-[#3D2314]/70">{s.codigo || "—"}</span>
      ),
    },
    {
      key: "nome",
      label: "Nome",
      ajuda: "projetos.catalogo.col_nome",
      render: (s) => (
        <div>
          <div className="font-medium text-[#3D2314]">{s.nome}</div>
          <div className="mt-0.5 flex flex-wrap gap-1">
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
      ajuda: "projetos.catalogo.col_categoria",
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
      ajuda: "projetos.catalogo.col_unidade",
      hiddenOnMobile: true,
      secondary: true,
      render: (s) => <span className="text-[#3D2314]/70">{s.unidade || "—"}</span>,
    },
    {
      key: "rup",
      label: "Produtividade",
      ajuda: "projetos.catalogo.col_rup",
      align: "center",
      hiddenOnMobile: true,
      secondary: true,
      render: (s) =>
        s.produtividade_unidade_dia !== null && s.produtividade_unidade_dia !== undefined ? (
          <span
            className="text-[#3D2314]/70"
            title="RUP (coeficiente de produtividade): quanto a equipe produz por dia nesta unidade"
          >
            {s.produtividade_unidade_dia} {s.unidade || "un"}/dia
          </span>
        ) : (
          <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-800">
            Sem RUP
          </span>
        ),
    },
    {
      key: "origem",
      label: "Origem",
      ajuda: "projetos.catalogo.col_origem",
      secondary: true,
      render: (s) => {
        const o = origemDoServico(s);
        return (
          <span
            title={o.titulo}
            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${o.cls}`}
          >
            {o.label}
          </span>
        );
      },
    },
    {
      key: "bom",
      label: "BOM",
      ajuda: "projetos.catalogo.col_bom",
      align: "center",
      render: (s) => {
        const q = s.qtd_itens_bom ?? 0;
        if (q === 0) {
          return (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
              Sem BOM
            </span>
          );
        }
        const cls = q < 3 ? "bg-yellow-100 text-yellow-800" : "bg-emerald-100 text-emerald-800";
        const txt = q < 3 ? `BOM mínimo · ${q} ite${q !== 1 ? "ns" : "m"}` : `${q} itens`;
        return (
          <button
            type="button"
            onClick={() => setBomDe(s)}
            title="Ver a composição deste serviço"
            className={`rounded-full px-2 py-0.5 text-xs font-medium underline-offset-2 hover:underline ${cls}`}
          >
            {txt}
          </button>
        );
      },
    },
    {
      key: "custo",
      label: "Custo",
      ajuda: "projetos.catalogo.col_custo",
      align: "right",
      render: (s) => (
        <span className="whitespace-nowrap font-mono text-[#3D2314]/80">
          {fmtBRL(precos[s.id]?.custo ?? s.custo_unitario_total)}
        </span>
      ),
    },
    {
      key: "bdi",
      label: "BDI aplicado",
      ajuda: "projetos.catalogo.col_bdi",
      align: "right",
      // Largura mínima para o % e o rótulo da fonte ("Precificação da empresa"/"BDI padrão da empresa")
      // caberem inteiros, sem truncar nem sobrepor (auditoria 01/11: valor "36"/"37" e "Precific...e" cortados).
      className: "min-w-[160px]",
      render: (s) => {
        const p = precos[s.id];
        if (!p || p.bdi_pct === null) {
          return <span className="text-xs text-[#3D2314]/50" title={FONTE_BDI.sem_bdi}>Sem BDI</span>;
        }
        // Valor em destaque (uma linha, nunca quebra) e a fonte como legenda legível logo abaixo.
        return (
          <span className="inline-flex flex-col items-end leading-tight" title={`Fonte: ${FONTE_BDI[p.fonte]}`}>
            <span className="whitespace-nowrap font-mono font-medium text-[#3D2314]">
              {p.bdi_pct.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
            </span>
            <span className="whitespace-nowrap font-sans text-[10px] text-[#3D2314]/55">{FONTE_BDI[p.fonte]}</span>
          </span>
        );
      },
    },
    {
      key: "venda",
      label: "Preço venda",
      ajuda: "projetos.catalogo.col_venda",
      align: "right",
      render: (s) => (
        <span className="whitespace-nowrap font-mono font-medium text-[#3D2314]">{fmtBRL(precos[s.id]?.preco_venda ?? null)}</span>
      ),
    },
    {
      key: "estoque",
      label: "Estoque",
      ajuda: "projetos.catalogo.col_estoque",
      align: "center",
      render: (s) => {
        const p = precos[s.id];
        const total = p?.insumos_total ?? 0;
        if (total === 0) return <span className="text-xs text-[#3D2314]/40">Sem insumos</span>;
        const lig = p?.insumos_ligados_estoque ?? 0;
        const cls = lig === total ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800";
        return (
          <button
            type="button"
            onClick={() => abrirEstoque(s)}
            title="Ligar os insumos aos produtos do estoque"
            className={`rounded-full px-2 py-0.5 text-xs font-medium underline-offset-2 hover:underline ${cls}`}
          >
            {lig === 0 ? "Ligar ao estoque" : `${lig} de ${total} ligados`}
          </button>
        );
      },
    },
    // "Prod/dia" era redundante com a coluna "Produtividade" (RUP): as duas mostravam
    // produtividade_unidade_dia. Mantida só a "Produtividade", que já traz a unidade/dia,
    // o selo "Sem RUP" e a explicação do que é RUP (auditoria PDCA 01/11). 12 → 11 colunas.
  ];

  // RD-99 (cadeia FC): gera um orçamento rascunho já com este serviço dentro e abre a tela de Orçamentos.
  // Reaproveita o mesmo caminho client-side da Calculadora (RLS por empresa, sem RPC nova); preço de venda
  // do serviço vai como preço unitário (0 quando ainda sem BDI/precificação, para o usuário completar lá).
  async function gerarOrcamento(s: Servico) {
    if (!companyId || gerandoOrc) return;
    setGerandoOrc(s.id);
    setErro(null);
    setAviso(null);
    try {
      const sb = supabaseBrowser();
      const p = precos[s.id];
      const precoVenda = Number(p?.preco_venda) || 0;
      const custo = Number(p?.custo) || 0;
      const { data: novo, error: e1 } = await sb
        .from("erp_orcamentos")
        .insert({ company_id: companyId, status: "rascunho", cliente_nome: `Orçamento — ${s.nome}` })
        .select("id,numero")
        .single();
      if (e1 || !novo) {
        setErro("Não consegui criar o orçamento: " + (e1?.message ?? "erro desconhecido"));
        return;
      }
      const { error: e2 } = await sb.from("erp_orcamentos_itens").insert({
        orcamento_id: novo.id,
        company_id: companyId,
        ordem: 1,
        tipo_item: "servico",
        servico_id: s.id,
        servico_codigo: s.codigo,
        servico_descricao: s.nome,
        produto_nome: s.nome,
        unidade: s.unidade || "UN",
        quantidade: 1,
        preco_unitario: precoVenda,
        preco_custo: custo,
        subtotal: precoVenda,
      });
      if (e2) {
        setErro(`Orçamento ${novo.numero ?? ""} criado, mas não consegui incluir o serviço: ${e2.message}`);
        return;
      }
      router.push("/dashboard/orcamento");
    } finally {
      setGerandoOrc(null);
    }
  }

  const acoes = (s: Servico) => (
    <div className="flex items-center justify-end gap-1">
      <button
        onClick={() => router.push(`/dashboard/projetos/catalogo/${s.id}`)}
        className="rounded-lg p-1.5 text-[#3D2314]/60 hover:bg-[#3D2314]/5 hover:text-[#3D2314]"
        title="Editar BOM"
      >
        <Pencil size={14} />
      </button>
      <AjudaCampo chave="projetos.catalogo.acao_editar" rota={ROTA} />
      <button
        onClick={() => duplicar(s)}
        className="rounded-lg p-1.5 text-[#3D2314]/60 hover:bg-[#3D2314]/5 hover:text-[#3D2314]"
        title="Duplicar"
      >
        <Copy size={14} />
      </button>
      <AjudaCampo chave="projetos.catalogo.acao_duplicar" rota={ROTA} />
      <button
        onClick={() => gerarOrcamento(s)}
        disabled={gerandoOrc === s.id}
        className="rounded-lg p-1.5 text-[#3D2314]/60 hover:bg-[#3D2314]/5 hover:text-[#3D2314] disabled:opacity-40"
        title="Gerar orçamento com este serviço"
      >
        <FileText size={14} />
      </button>
      <AjudaCampo chave="projetos.catalogo.acao_gerar_orcamento" rota={ROTA} />
      <button
        onClick={() => pedirExclusao(s)}
        className="rounded-lg p-1.5 text-red-600 hover:bg-red-50"
        title="Excluir"
      >
        <Trash2 size={14} />
      </button>
      <AjudaCampo chave="projetos.catalogo.acao_excluir" rota={ROTA} />
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
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-[#C8941A]/15 px-2 py-0.5 text-xs font-medium text-[#C8941A]">
                BDI padrão {config.bdi_total_pct.toFixed(2)}% <span className="text-[#C8941A]/80">· vale onde não há precificação própria</span>
                <AjudaCampo chave="projetos.catalogo.bdi" rota={ROTA} />
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
            <AjudaCampo chave="projetos.catalogo.acao_importar" rota={ROTA} />
          </button>
          <button
            onClick={abrirNovo}
            className="inline-flex items-center gap-2 rounded-lg bg-[#3D2314] px-4 py-2 text-sm font-medium text-[#FAF7F2] hover:bg-[#3D2314]/90 disabled:opacity-50"
          >
            <Plus size={14} />
            Novo serviço
            <AjudaCampo chave="projetos.catalogo.acao_novo" rota={ROTA} />
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
          onCriarManual={abrirNovo}
          importando={importando}
        />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-[#3D2314]/8 bg-white p-4 shadow-sm md:grid-cols-5">
            <div data-ajuda="projetos.catalogo.busca" className="md:col-span-2">
              <label className="mb-1 flex items-center text-xs uppercase tracking-wider text-[#3D2314]/60">
                Buscar
                <AjudaCampo chave="projetos.catalogo.busca" rota={ROTA} />
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
                  className="w-full rounded-lg !border !border-[#3D2314]/12 !bg-white py-2 pl-9 pr-3 text-sm !text-[#3D2314] placeholder:!text-[#3D2314]/40 focus:!border-[#C8941A] focus:outline-none focus:ring-2 focus:ring-[#C8941A]/20 transition-colors"
                />
              </div>
            </div>
            <div data-ajuda="projetos.catalogo.filtro_categoria">
              <label className="mb-1 flex items-center text-xs uppercase tracking-wider text-[#3D2314]/60">
                Categoria
                <AjudaCampo chave="projetos.catalogo.filtro_categoria" rota={ROTA} />
              </label>
              <select
                value={filtroCat}
                onChange={(e) => setFiltroCat(e.target.value)}
                className="w-full rounded-lg !border !border-[#3D2314]/12 !bg-white px-3 py-2 text-sm !text-[#3D2314] focus:!border-[#C8941A] focus:outline-none focus:ring-2 focus:ring-[#C8941A]/20 transition-colors"
              >
                <option value="">Todas</option>
                {categorias.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div data-ajuda="projetos.catalogo.filtro_origem">
              <label className="mb-1 flex items-center text-xs uppercase tracking-wider text-[#3D2314]/60">
                Origem
                <AjudaCampo chave="projetos.catalogo.filtro_origem" rota={ROTA} />
              </label>
              <select
                value={filtroOrigem}
                onChange={(e) => setFiltroOrigem(e.target.value as any)}
                className="w-full rounded-lg !border !border-[#3D2314]/12 !bg-white px-3 py-2 text-sm !text-[#3D2314] focus:!border-[#C8941A] focus:outline-none focus:ring-2 focus:ring-[#C8941A]/20 transition-colors"
              >
                <option value="todos">Todas</option>
                <option value="manual">Próprio</option>
                <option value="fork">Biblioteca</option>
                <option value="demo">Demonstração</option>
              </select>
            </div>
            <div data-ajuda="projetos.catalogo.filtro_status">
              <label className="mb-1 flex items-center text-xs uppercase tracking-wider text-[#3D2314]/60">
                Status
                <AjudaCampo chave="projetos.catalogo.filtro_status" rota={ROTA} />
              </label>
              <select
                value={filtroStatus}
                onChange={(e) => setFiltroStatus(e.target.value as any)}
                className="w-full rounded-lg !border !border-[#3D2314]/12 !bg-white px-3 py-2 text-sm !text-[#3D2314] focus:!border-[#C8941A] focus:outline-none focus:ring-2 focus:ring-[#C8941A]/20 transition-colors"
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
              <AjudaCampo chave="projetos.catalogo.apenas_bom" rota={ROTA} />
            </label>
            <div className="flex items-center gap-3">
              {/* No computador, mostrar/ocultar as colunas secundárias (Un, Produtividade, Origem) para que
                  Custo, BDI e Preço venda fiquem visíveis sem rolagem horizontal (auditoria PDCA 01/11). */}
              <button
                type="button"
                onClick={() => setColsDetalhe((v) => !v)}
                aria-pressed={colsDetalhe}
                title={colsDetalhe
                  ? "Ocultar as colunas Un, Produtividade e Origem para ver custo e preço sem rolar"
                  : "Mostrar as colunas Un, Produtividade e Origem"}
                className="hidden items-center gap-1.5 rounded-lg border border-[#3D2314]/12 bg-white px-3 py-1.5 text-xs font-medium text-[#3D2314]/70 transition-colors hover:border-[#C8941A] hover:text-[#3D2314] md:inline-flex"
              >
                {colsDetalhe ? "Menos colunas" : "Mais colunas"}
              </button>
              <p className="text-xs text-[#3D2314]/60">
                {filtrados.length} de {servicos.length} serviço{servicos.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>

          <CatalogoTable
            rows={filtrados}
            columns={colunas}
            loading={loading}
            rowKey={(s) => s.id}
            actions={acoes}
            collapseSecondary={!colsDetalhe}
            onRowClick={(s) => router.push(`/dashboard/projetos/catalogo/${s.id}`)}
            emptyMessage="Nenhum serviço encontrado com esses filtros"
          />
        </>
      )}

      {novoAberto && (
        <div
          className="fixed inset-0 z-[120] flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4"
          onClick={() => !criando && setNovoAberto(false)}
          data-testid="catalogo-novo-modal"
        >
          <div
            className="w-full max-w-lg rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              className="text-lg font-medium text-[#3D2314]"
              style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal", letterSpacing: "-0.01em" }}
            >
              Novo serviço
            </h2>
            <p className="mt-1 text-sm text-[#3D2314]/60">
              Dê um nome ao serviço. O serviço só é criado ao confirmar — depois você monta a composição (BOM/CPU).
            </p>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div data-ajuda="projetos.catalogo.novo.nome" className="sm:col-span-2">
                <label className="mb-1 flex items-center text-xs uppercase tracking-wider text-[#3D2314]/60">
                  Nome do serviço
                  <AjudaCampo chave="projetos.catalogo.novo.nome" rota={ROTA} />
                </label>
                <input
                  type="text"
                  autoFocus
                  value={novo.nome}
                  onChange={(e) => setNovo((n) => ({ ...n, nome: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") confirmarNovo(); }}
                  placeholder="Ex.: Forro de gesso acartonado"
                  className="w-full rounded-lg !border !border-[#3D2314]/12 !bg-white px-3 py-2 text-sm !text-[#3D2314] placeholder:!text-[#3D2314]/40 focus:!border-[#C8941A] focus:outline-none focus:ring-2 focus:ring-[#C8941A]/20 transition-colors"
                />
              </div>
              <div data-ajuda="projetos.catalogo.novo.codigo">
                <label className="mb-1 flex items-center text-xs uppercase tracking-wider text-[#3D2314]/60">
                  Código
                  <AjudaCampo chave="projetos.catalogo.novo.codigo" rota={ROTA} />
                </label>
                <input
                  type="text"
                  value={novo.codigo}
                  onChange={(e) => setNovo((n) => ({ ...n, codigo: e.target.value }))}
                  placeholder="SERV-1"
                  className="w-full rounded-lg !border !border-[#3D2314]/12 !bg-white px-3 py-2 text-sm !text-[#3D2314] placeholder:!text-[#3D2314]/40 focus:!border-[#C8941A] focus:outline-none focus:ring-2 focus:ring-[#C8941A]/20 transition-colors"
                />
              </div>
              <div data-ajuda="projetos.catalogo.novo.unidade">
                <label className="mb-1 flex items-center text-xs uppercase tracking-wider text-[#3D2314]/60">
                  Unidade
                  <AjudaCampo chave="projetos.catalogo.novo.unidade" rota={ROTA} />
                </label>
                <input
                  type="text"
                  value={novo.unidade}
                  onChange={(e) => setNovo((n) => ({ ...n, unidade: e.target.value }))}
                  placeholder="m²"
                  className="w-full rounded-lg !border !border-[#3D2314]/12 !bg-white px-3 py-2 text-sm !text-[#3D2314] placeholder:!text-[#3D2314]/40 focus:!border-[#C8941A] focus:outline-none focus:ring-2 focus:ring-[#C8941A]/20 transition-colors"
                />
              </div>
              <div data-ajuda="projetos.catalogo.novo.categoria" className="sm:col-span-2">
                <label className="mb-1 flex items-center text-xs uppercase tracking-wider text-[#3D2314]/60">
                  Categoria
                  <AjudaCampo chave="projetos.catalogo.novo.categoria" rota={ROTA} />
                </label>
                <input
                  type="text"
                  value={novo.categoria}
                  onChange={(e) => setNovo((n) => ({ ...n, categoria: e.target.value }))}
                  placeholder="Forros (opcional)"
                  className="w-full rounded-lg !border !border-[#3D2314]/12 !bg-white px-3 py-2 text-sm !text-[#3D2314] placeholder:!text-[#3D2314]/40 focus:!border-[#C8941A] focus:outline-none focus:ring-2 focus:ring-[#C8941A]/20 transition-colors"
                />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => setNovoAberto(false)}
                disabled={criando}
                className="rounded-lg border border-[#3D2314]/12 bg-white px-4 py-2 text-sm font-medium text-[#3D2314] hover:bg-[#3D2314]/5 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarNovo}
                disabled={criando || !novo.nome.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-[#3D2314] px-4 py-2 text-sm font-medium text-[#FAF7F2] hover:bg-[#3D2314]/90 disabled:opacity-50"
                data-testid="catalogo-novo-criar"
              >
                <Plus size={14} />
                {criando ? "Criando…" : "Criar serviço"}
              </button>
            </div>
          </div>
        </div>
      )}
      {excluindo && (
        <div
          className="fixed inset-0 z-[120] flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4"
          onClick={() => !excluindoOcupado && setExcluindo(null)}
          data-testid="catalogo-excluir-modal"
        >
          <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-medium text-[#3D2314]">Excluir "{excluindo.nome}"?</h2>
            <p className="mt-1 text-sm text-[#3D2314]/60">
              O serviço sai da lista, mas nada é apagado: ficam registrados quem excluiu, quando e o motivo.
            </p>
            <div data-ajuda="projetos.catalogo.motivo_exclusao" className="mt-4">
            <label className="mb-1 flex items-center text-xs uppercase tracking-wider text-[#3D2314]/60">
              Motivo da exclusão
              <AjudaCampo chave="projetos.catalogo.motivo_exclusao" rota={ROTA} />
            </label>
            <input
              type="text"
              autoFocus
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirmarExclusao(); }}
              placeholder="Ex.: criado em duplicidade"
              className="w-full rounded-lg !border !border-[#3D2314]/12 !bg-white px-3 py-2 text-sm !text-[#3D2314] focus:!border-[#C8941A] focus:outline-none focus:ring-2 focus:ring-[#C8941A]/20"
            />
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => setExcluindo(null)}
                disabled={excluindoOcupado}
                className="rounded-lg border border-[#3D2314]/12 bg-white px-4 py-2 text-sm font-medium text-[#3D2314] hover:bg-[#3D2314]/5 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarExclusao}
                disabled={excluindoOcupado || motivo.trim().length < 3}
                className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
                data-testid="catalogo-excluir-confirmar"
              >
                {excluindoOcupado ? "Excluindo…" : "Excluir serviço"}
              </button>
            </div>
          </div>
        </div>
      )}
      {estoqueDe && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          onClick={() => setEstoqueDe(null)}
          data-testid="catalogo-estoque-modal"
        >
          <div
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-[#FAF7F2] p-4 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center text-lg font-medium text-[#3D2314]">
                  Ligar ao estoque · {estoqueDe.nome}
                  <AjudaCampo chave="projetos.catalogo.ligar_estoque" rota={ROTA} />
                </h2>
                <p className="text-xs text-[#3D2314]/60">
                  Escolha, para cada insumo, o produto real do estoque de {empresaNome}. Sem ligação, o insumo segue genérico.
                </p>
              </div>
              <button type="button" onClick={() => setEstoqueDe(null)} className="rounded-lg px-3 py-1.5 text-sm text-[#3D2314]/70 hover:bg-[#3D2314]/5">
                Fechar
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {carregandoEst && <p className="text-sm text-[#3D2314]/50">Carregando…</p>}
              {!carregandoEst && insumosEst.length === 0 && (
                <p className="rounded-lg bg-white p-4 text-sm text-[#3D2314]/60">Este serviço não tem insumos de material na composição.</p>
              )}
              {insumosEst.map((i) => (
                <div key={i.insumo_id} className="rounded-xl border border-[#3D2314]/8 bg-white p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-[#3D2314]">{i.nome}</div>
                      <div className="text-xs text-[#3D2314]/60">{i.codigo || "sem código"} · {i.unidade || "—"}</div>
                    </div>
                    {i.produto_id ? (
                      <div className="text-right text-xs">
                        <div className="font-medium text-emerald-800">{i.produto_nome}</div>
                        <div className="text-[#3D2314]/60">
                          Saldo em estoque: {(i.estoque_atual ?? 0).toLocaleString("pt-BR")}
                        </div>
                        <button type="button" onClick={() => ligarInsumo(i.insumo_id, null)} className="mt-1 text-[#3D2314]/60 underline">
                          Desligar
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setEscolhendo(i.insumo_id); setBuscaProd(""); setProdutos([]); }}
                        className="rounded-lg bg-[#3D2314] px-3 py-1.5 text-xs font-medium text-[#FAF7F2]"
                      >
                        Ligar ao estoque
                      </button>
                    )}
                  </div>
                  {escolhendo === i.insumo_id && (
                    <div className="mt-3 border-t border-[#3D2314]/8 pt-3" data-ajuda="projetos.catalogo.ligar_estoque">
                      <input
                        type="text"
                        autoFocus
                        value={buscaProd}
                        onChange={(e) => buscarProdutos(e.target.value)}
                        placeholder="Digite o nome ou código do produto (mín. 2 letras)"
                        className="w-full rounded-lg !border !border-[#3D2314]/12 !bg-white px-3 py-2 text-sm !text-[#3D2314] focus:!border-[#C8941A] focus:outline-none"
                      />
                      <ul className="mt-2 space-y-1">
                        {produtos.map((p) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              onClick={() => ligarInsumo(i.insumo_id, p.id)}
                              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-[#3D2314]/5"
                            >
                              <span>{p.nome} <span className="text-xs text-[#3D2314]/50">{p.codigo || ""} · {p.unidade || "—"}</span></span>
                              <span className="text-xs text-[#3D2314]/60">saldo {(p.estoque_atual ?? 0).toLocaleString("pt-BR")}</span>
                            </button>
                          </li>
                        ))}
                        {buscaProd.trim().length >= 2 && produtos.length === 0 && (
                          <li className="px-3 py-2 text-xs text-[#3D2314]/50">Nenhum produto encontrado no estoque desta empresa.</li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {bomDe && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          onClick={() => setBomDe(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-t-2xl bg-[#FAF7F2] p-4 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-medium text-[#3D2314]">{bomDe.nome}</h2>
                <p className="text-xs text-[#3D2314]/60">Composição do preço unitário · {bomDe.codigo || "sem código"}</p>
              </div>
              <button
                type="button"
                onClick={() => setBomDe(null)}
                className="rounded-lg px-3 py-1.5 text-sm text-[#3D2314]/70 hover:bg-[#3D2314]/5"
              >
                Fechar
              </button>
            </div>
            <ComposicaoCpu servicoId={bomDe.id} companyId={bomDe.company_id} />
            <button
              type="button"
              onClick={() => router.push(`/dashboard/projetos/catalogo/${bomDe.id}`)}
              className="mt-4 rounded-lg bg-[#3D2314] px-4 py-2 text-sm font-medium text-[#FAF7F2]"
            >
              Editar composição
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
