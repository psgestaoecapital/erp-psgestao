// src/components/projetos/SeletorItemModal.tsx
// Modal "Adicionar item ao BOM" com 4 abas: Material / Mão de obra / Equipamento / EPI.
// Material/Equipamento/EPI puxam do ESTOQUE REAL (erp_produtos) via fn_bom_estoque_fontes, com filtro por LOCAL de
// estoque (Decisão CEO 18/11 opção A: EPI vem do estoque, no local dos EPIs). Mão de obra vem de projetos_mao_obra.
// Entrada MANUAL em qualquer aba (nome+unidade+custo, sem cadastro). Produto sem local NUNCA some ("Sem local").

"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, X, Package, HardHat, Wrench, ShieldCheck, Pencil, Hammer } from "lucide-react";
import { supabaseBrowser } from "@/lib/authFetch";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { erroAmigavel } from "@/lib/erroAmigavel";
import { parseNumBR } from "@/lib/num";

// RD-95: abre dentro da ficha do serviço (rota dinâmica) → textos do "?" na rota fixa dela
const ROTA_AJUDA_SERVICO = "/dashboard/projetos/catalogo/[id]";

export type TipoItem = "insumo" | "mao_obra" | "equipamento" | "epi" | "ferramenta";

export interface ItemEscolhido {
  tipo: TipoItem;
  item_id: string; // mao_obra_id (MO) · produto_id (estoque) · "" (manual)
  produto_id?: string | null;
  local_id?: string | null;
  manual?: boolean;
  nome: string;
  unidade: string | null;
  custo: number | null;
}

interface ProdutoRow {
  id: string;
  codigo: string | null;
  nome: string;
  unidade: string | null;
  custo: number | null;
}

interface MoRow {
  id: string;
  funcao: string;
  custo_hora: number | null;
}

// Mão de obra da EMPRESA no BOM (Diego/FC 24/11): além da FUNÇÃO (projetos_mao_obra, vínculo vivo via mao_obra_id),
// PESSOA (projetos_equipe_membro) e EQUIPE (projetos_equipe, custo médio/h ou efetivo/h). Pessoa e equipe não têm
// coluna própria no BOM → gravam CONGELADOS (manual: nome+custo+unidade), nunca de outra empresa.
interface EquipeRow {
  id: string;
  nome: string;
  custo_medio_hora: number | null;
  custo_hora_efetivo: number | null;
}
interface PessoaRow {
  id: string;
  equipe_id: string | null;
  nome_pessoa: string | null;
  funcao_nome: string | null;
  custo_hora: number | null;
}

interface LocalRow {
  id: string;
  nome: string;
  ativo: boolean;
}

const ABAS: Array<{ tipo: TipoItem; label: string; icon: typeof Package }> = [
  { tipo: "insumo", label: "Material", icon: Package },
  { tipo: "mao_obra", label: "Mão de obra", icon: HardHat },
  { tipo: "equipamento", label: "Equipamento", icon: Wrench },
  { tipo: "ferramenta", label: "Ferramentas", icon: Hammer },
  { tipo: "epi", label: "EPI", icon: ShieldCheck },
];

const TODOS = "todos";
const SEM_LOCAL = "sem_local";

function fmtBRL(v: number | null) {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function parseNum(s: string): number | null {
  // parseNumBR: vírgula decimal e ponto de milhar (pt-BR); não zera "398.0" como o replace antigo.
  return parseNumBR(s);
}

export function SeletorItemModal({
  open,
  companyId,
  onClose,
  onSelect,
}: {
  open: boolean;
  companyId: string;
  onClose: () => void;
  onSelect: (item: ItemEscolhido) => void;
}) {
  const [aba, setAba] = useState<TipoItem>("insumo");
  const [busca, setBusca] = useState("");
  const [produtos, setProdutos] = useState<ProdutoRow[]>([]);
  const [mos, setMos] = useState<MoRow[]>([]);
  const [equipes, setEquipes] = useState<EquipeRow[]>([]);
  const [pessoas, setPessoas] = useState<PessoaRow[]>([]);
  const [locais, setLocais] = useState<LocalRow[]>([]);
  const [produtoLocais, setProdutoLocais] = useState<Record<string, string[]>>({});
  const [localSel, setLocalSel] = useState<string>(TODOS);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Entrada manual
  const [manualOn, setManualOn] = useState(false);
  const [manNome, setManNome] = useState("");
  const [manUnidade, setManUnidade] = useState("");
  const [manCusto, setManCusto] = useState("");

  const estoqueAba = aba !== "mao_obra";

  useEffect(() => {
    if (!open || !companyId) return;
    let cancel = false;
    (async () => {
      setLoading(true);
      setErro(null);
      try {
        const supabase = supabaseBrowser();
        const [fontesR, moR, equipeR, pessoaR] = await Promise.all([
          supabase.rpc("fn_bom_estoque_fontes", { p_company_id: companyId }),
          supabase
            .from("projetos_mao_obra")
            .select("id, funcao, custo_hora")
            .eq("company_id", companyId)
            .eq("ativo", true)
            .order("funcao")
            .limit(300),
          supabase
            .from("projetos_equipe")
            .select("id, nome, custo_medio_hora, custo_hora_efetivo")
            .eq("company_id", companyId)
            .eq("ativo", true)
            .order("nome")
            .limit(200),
          supabase
            .from("projetos_equipe_membro")
            .select("id, equipe_id, nome_pessoa, funcao_nome, custo_hora")
            .eq("company_id", companyId)
            .order("nome_pessoa")
            .limit(500),
        ]);
        if (cancel) return;
        const f = (fontesR.data as { produtos?: ProdutoRow[]; locais?: LocalRow[]; produto_locais?: Record<string, string[]> } | null) ?? null;
        // Robustez (#5513): uma fonte que falha não derruba a outra aba.
        setProdutos(!fontesR.error && f ? f.produtos ?? [] : []);
        setLocais(!fontesR.error && f ? f.locais ?? [] : []);
        setProdutoLocais(!fontesR.error && f ? f.produto_locais ?? {} : {});
        setMos(!moR.error ? ((moR.data as MoRow[]) || []) : []);
        setEquipes(!equipeR.error ? ((equipeR.data as EquipeRow[]) || []) : []);
        setPessoas(!pessoaR.error ? ((pessoaR.data as PessoaRow[]) || []) : []);
        // Só o estoque (fontes) e as funções derrubam a aba com erro visível; equipe/pessoa falham em silêncio (a busca
        // de função + manual seguem valendo — empresa sem equipe/pessoa cai no caminho padrão).
        const err = fontesR.error || moR.error;
        setErro(err ? erroAmigavel(err) : null);
      } catch (e: any) {
        if (!cancel) setErro(erroAmigavel(e));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [open, companyId]);

  // Linha da lista: selo (Função/Pessoa/Equipe) + o ItemEscolhido limpo que vai no escolher().
  type Linha = { key: string; selo: string | null; item: ItemEscolhido };
  const itensFiltrados = useMemo<Linha[]>(() => {
    const q = busca.toLowerCase().trim();
    if (aba === "mao_obra") {
      const out: Linha[] = [];
      // FUNÇÃO — vínculo vivo (mao_obra_id); custo acompanha o cadastro.
      for (const m of mos) {
        if (q && !m.funcao.toLowerCase().includes(q)) continue;
        out.push({ key: `f:${m.id}`, selo: "Função", item: { tipo: "mao_obra", item_id: m.id, produto_id: null, local_id: null, manual: false, nome: m.funcao, unidade: "h", custo: m.custo_hora } });
      }
      // PESSOA — congelada (sem coluna de pessoa no BOM): nome + custo/h do membro da equipe.
      for (const p of pessoas) {
        const nome = (p.nome_pessoa || "").trim();
        if (!nome) continue;
        const rotulo = p.funcao_nome ? `${nome} · ${p.funcao_nome}` : nome;
        if (q && !rotulo.toLowerCase().includes(q)) continue;
        out.push({ key: `p:${p.id}`, selo: "Pessoa", item: { tipo: "mao_obra", item_id: "", produto_id: null, local_id: null, manual: true, nome: rotulo, unidade: "h", custo: p.custo_hora } });
      }
      // EQUIPE — 3 opções na hora, com rótulo claro (congeladas):
      //  • TOTAL/h = soma do custo/h de todas as pessoas da equipe (equipe inteira em 1h) → PADRÃO sugerido (vem 1º);
      //  • MÉDIO/h = média por pessoa;  • EFETIVO/h = o fixado da equipe.
      // Coerência do coeficiente: total/h → horas de EQUIPE por unidade; médio/efetivo → horas-PESSOA (ver o "?").
      for (const e of equipes) {
        if (q && !e.nome.toLowerCase().includes(q)) continue;
        const totalH = pessoas.filter((p) => p.equipe_id === e.id).reduce((s, p) => s + (Number(p.custo_hora) || 0), 0);
        if (totalH > 0) out.push({ key: `e:${e.id}:tot`, selo: "Equipe · total/h", item: { tipo: "mao_obra", item_id: "", produto_id: null, local_id: null, manual: true, nome: `Equipe ${e.nome} (total/h — equipe inteira)`, unidade: "h", custo: Math.round(totalH * 100) / 100 } });
        if (e.custo_medio_hora != null) out.push({ key: `e:${e.id}:med`, selo: "Equipe · médio", item: { tipo: "mao_obra", item_id: "", produto_id: null, local_id: null, manual: true, nome: `Equipe ${e.nome} (médio/pessoa)`, unidade: "h", custo: e.custo_medio_hora } });
        if (e.custo_hora_efetivo != null) out.push({ key: `e:${e.id}:ef`, selo: "Equipe · efetivo", item: { tipo: "mao_obra", item_id: "", produto_id: null, local_id: null, manual: true, nome: `Equipe ${e.nome} (efetivo/pessoa)`, unidade: "h", custo: e.custo_hora_efetivo } });
      }
      return out;
    }
    const localItem = localSel !== TODOS && localSel !== SEM_LOCAL ? localSel : null;
    return produtos
      .filter((p) => {
        if (q) {
          const hay = `${p.nome} ${p.codigo || ""}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        const locs = produtoLocais[p.id] || [];
        if (localSel === SEM_LOCAL) return locs.length === 0; // produto sem movimentação em local algum
        if (localItem) return locs.includes(localItem);
        return true; // "Todos": nunca esconde produto por falta de local
      })
      .map((p) => ({
        key: p.id,
        selo: null,
        item: {
          tipo: aba,
          item_id: p.id,
          produto_id: p.id,
          local_id: localItem,
          manual: false,
          nome: p.nome,
          unidade: p.unidade,
          custo: p.custo,
        } as ItemEscolhido,
      }));
  }, [aba, busca, produtos, mos, equipes, pessoas, localSel, produtoLocais]);

  function escolher(it: ItemEscolhido) {
    onSelect(it);
  }

  function adicionarManual() {
    if (manNome.trim().length < 2) return;
    escolher({ tipo: aba, item_id: "", produto_id: null, local_id: null, manual: true, nome: manNome.trim(), unidade: manUnidade.trim() || null, custo: parseNum(manCusto) });
    setManNome("");
    setManUnidade("");
    setManCusto("");
    setManualOn(false);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#3D2314]/60 p-4" onClick={onClose}>
      <div className="flex h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#3D2314]/8 p-5">
          <div>
            <h2 className="text-lg font-semibold text-[#3D2314]" style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}>Adicionar item ao BOM</h2>
            <p className="mt-1 text-xs text-[#3D2314]/60">Material, mão de obra, equipamento ou EPI — do estoque ou digitado à mão</p>
          </div>
          <button onClick={onClose} className="text-[#3D2314]/60 hover:text-[#3D2314]"><X size={18} /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#3D2314]/8 bg-[#FAF7F2]">
          {ABAS.map((a) => {
            const Icon = a.icon;
            const ativa = aba === a.tipo;
            return (
              <button
                key={a.tipo}
                onClick={() => { setAba(a.tipo); setBusca(""); setManualOn(false); }}
                className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-3 text-sm font-medium transition-colors ${ativa ? "border-[#C8941A] bg-white text-[#3D2314]" : "border-transparent text-[#3D2314]/60 hover:bg-[#3D2314]/5 hover:text-[#3D2314]"}`}
              >
                <Icon size={16} />
                {a.label}
              </button>
            );
          })}
        </div>

        {/* Busca + Local + Manual */}
        <div className="space-y-3 border-b border-[#3D2314]/8 p-4">
          <label className="flex items-center gap-2">
            <span className="sr-only">Buscar item</span>
            <span className="relative block flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3D2314]/40" />
              <input type="text" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome…" autoFocus
                className="w-full rounded-lg !border !border-[#3D2314]/12 !bg-white py-2 pl-9 pr-3 text-sm !text-[#3D2314] placeholder:!text-[#3D2314]/40 focus:!border-[#C8941A] focus:outline-none focus:ring-2 focus:ring-[#C8941A]/20 transition-colors" />
            </span>
            <AjudaCampo chave="projetos.catalogo.seletor.busca" rota={ROTA_AJUDA_SERVICO} />
          </label>

          {estoqueAba && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-[#3D2314]/70 whitespace-nowrap">Local de estoque</span>
              <select value={localSel} onChange={(e) => setLocalSel(e.target.value)} data-testid="bom-seletor-local"
                className="flex-1 rounded-lg !border !border-[#3D2314]/12 !bg-white px-3 py-2 text-sm !text-[#3D2314] focus:!border-[#C8941A] focus:outline-none">
                <option value={TODOS}>Todos os locais</option>
                {locais.map((l) => <option key={l.id} value={l.id}>{l.nome}{l.ativo ? "" : " (inativo)"}</option>)}
                <option value={SEM_LOCAL}>Sem local</option>
              </select>
              <AjudaCampo chave="projetos.catalogo.seletor.local" rota={ROTA_AJUDA_SERVICO} />
            </label>
          )}

          {aba === "mao_obra" && (
            <div data-ajuda="projetos.catalogo.bom.mo_modo" className="flex items-start gap-1 rounded-lg bg-[#C8941A]/[0.06] px-3 py-2 text-xs text-[#3D2314]/70" data-testid="bom-mo-modos">
              <span>
                <strong className="text-[#3D2314]">Por hora</strong> (equipe própria): escolha a função, pessoa ou equipe na lista — o custo é por hora × horas por unidade.{" "}
                <strong className="text-[#3D2314]">Empreitada</strong>: use “Digitar item manual”, informe a <strong>unidade</strong> (m², metro, un, ponto…) e o valor pago por unidade à equipe.
              </span>
              <AjudaCampo chave="projetos.catalogo.bom.mo_modo" rota={ROTA_AJUDA_SERVICO} />
            </div>
          )}

          <button onClick={() => setManualOn((v) => !v)} data-testid="bom-seletor-manual-toggle"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#C8941A] hover:text-[#B07F12]">
            <Pencil size={13} /> {manualOn ? "Cancelar entrada manual" : "Digitar item manual"}
          </button>

          {manualOn && aba === "mao_obra" && (
            <div className="flex items-center gap-1.5 text-xs text-[#3D2314]/70" data-testid="bom-manual-unidades-mo">
              <span>Unidade:</span>
              {["h", "m²", "verba"].map((u) => (
                <button key={u} type="button" onClick={() => setManUnidade(u)}
                  className={`rounded-full border px-2 py-0.5 ${manUnidade === u ? "border-[#C8941A] bg-[#C8941A]/12 text-[#B07F12]" : "border-[#3D2314]/15 hover:bg-[#3D2314]/5"}`}>{u}</button>
              ))}
              <span className="text-[#3D2314]/40">ou digite abaixo</span>
            </div>
          )}
          {manualOn && (
            <div className="grid grid-cols-1 gap-2 rounded-lg border border-[#3D2314]/10 bg-[#FAF7F2] p-3 sm:grid-cols-[1fr_90px_110px_auto]" data-testid="bom-seletor-manual">
              <label className="flex flex-col gap-1 text-xs"><span className="flex items-center text-[#3D2314]/70">Nome<AjudaCampo chave="projetos.catalogo.seletor.manual_nome" rota={ROTA_AJUDA_SERVICO} /></span>
                <input value={manNome} onChange={(e) => setManNome(e.target.value)} data-testid="bom-manual-nome" placeholder="Parafuso bucha 8mm"
                  className="rounded !border !border-[#3D2314]/12 !bg-white px-2 py-1.5 text-sm !text-[#3D2314] focus:!border-[#C8941A] focus:outline-none" /></label>
              <label className="flex flex-col gap-1 text-xs"><span className="flex items-center text-[#3D2314]/70">Unidade<AjudaCampo chave="projetos.catalogo.seletor.manual_unidade" rota={ROTA_AJUDA_SERVICO} /></span>
                <input value={manUnidade} onChange={(e) => setManUnidade(e.target.value)} data-testid="bom-manual-unidade" placeholder="un"
                  className="rounded !border !border-[#3D2314]/12 !bg-white px-2 py-1.5 text-sm !text-[#3D2314] focus:!border-[#C8941A] focus:outline-none" /></label>
              <label className="flex flex-col gap-1 text-xs"><span className="flex items-center text-[#3D2314]/70">Custo R$<AjudaCampo chave="projetos.catalogo.seletor.manual_custo" rota={ROTA_AJUDA_SERVICO} /></span>
                <input value={manCusto} onChange={(e) => setManCusto(e.target.value)} inputMode="decimal" data-testid="bom-manual-custo" placeholder="12,50"
                  className="rounded !border !border-[#3D2314]/12 !bg-white px-2 py-1.5 text-right text-sm !text-[#3D2314] focus:!border-[#C8941A] focus:outline-none" /></label>
              <button onClick={adicionarManual} disabled={manNome.trim().length < 2} data-testid="bom-manual-add"
                className="self-end rounded-lg bg-[#3D2314] px-3 py-2 text-sm font-medium text-[#FAF7F2] hover:bg-[#3D2314]/90 disabled:opacity-40">Adicionar</button>
            </div>
          )}
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto p-2">
          {erro && <div className="m-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">{erro}</div>}
          {loading ? (
            <div className="p-6 text-center text-sm text-[#3D2314]/60">Carregando…</div>
          ) : itensFiltrados.length === 0 ? (
            <div className="p-6 text-center text-sm text-[#3D2314]/60">
              {busca || (estoqueAba && localSel !== TODOS) ? "Nenhum item encontrado — tente outro local ou digite manual" : "Catálogo vazio nessa aba — use “Digitar item manual”"}
            </div>
          ) : (
            <ul className="divide-y divide-[#3D2314]/8">
              {itensFiltrados.map((row) => (
                <li key={row.key}>
                  <button onClick={() => escolher(row.item)} className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-[#3D2314]/5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {row.selo && <span className="shrink-0 rounded bg-[#C8941A]/12 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#B07F12]">{row.selo}</span>}
                        <span className="truncate font-medium text-[#3D2314]">{row.item.nome}</span>
                      </div>
                      <div className="text-xs text-[#3D2314]/60">{row.item.unidade && <span>Unidade: {row.item.unidade}</span>}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm text-[#3D2314]">{fmtBRL(row.item.custo)}</div>
                      {aba === "mao_obra" && <div className="text-xs text-[#3D2314]/50">/ h</div>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[#3D2314]/8 p-4 text-center text-xs text-[#3D2314]/50">
          {itensFiltrados.length} item{itensFiltrados.length !== 1 ? "s" : ""} disponíve{itensFiltrados.length !== 1 ? "is" : "l"}
        </div>
      </div>
    </div>
  );
}
