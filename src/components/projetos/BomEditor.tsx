// src/components/projetos/BomEditor.tsx
// Editor visual de BOM (Bill of Materials) com cálculo em tempo real
// Insert/update/delete em projetos_servicos_bom + refetch via fn_projetos_servico_completo

"use client";

import { useState } from "react";
import { Plus, Trash2, Package, HardHat, Wrench, ShieldCheck, Hammer, Loader2, Calculator } from "lucide-react";
import { supabaseBrowser } from "@/lib/authFetch";
import { SeletorItemModal, type ItemEscolhido, type TipoItem } from "./SeletorItemModal";
import { CalcCoeficienteModal, type CoefResultado } from "./CalcCoeficienteModal";
import { CalcProdutividadeModal, type ProdResultado } from "./CalcProdutividadeModal";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { erroAmigavel } from "@/lib/erroAmigavel";
import { parseNumBR } from "@/lib/num";

// RD-95: o "?" lê os textos da ficha do serviço (rota dinâmica → rota fixa em erp_ajuda_campo)
const ROTA_AJUDA_SERVICO = "/dashboard/projetos/catalogo/[id]";

export interface BomLinha {
  id: string;
  servico_id: string;
  tipo: TipoItem | string;
  insumo_id?: string | null;
  mao_obra_id?: string | null;
  item_nome?: string | null;
  quantidade: number | null;
  unidade: string | null;
  perda_pct: number | null;
  custo_unitario: number | null;
  custo_total: number | null;
  ordem: number | null;
  observacao?: string | null;
  periodo_valor?: number | null;
  periodo_unidade?: string | null;
  qtd_por_periodo?: number | null;
  metodo_coeficiente?: string | null;
}

interface Props {
  servicoId: string;
  companyId: string;
  bom: BomLinha[];
  onChange: () => void | Promise<void>;
  // Para a calculadora de coeficiente (consumo por unidade): dados do serviço + config da empresa.
  produtividade?: number | null; // produtividade_unidade_dia (legado, equipe/dia)
  equipePadrao?: string | null;
  unidadeServico?: string | null; // unidade da produtividade (ex.: m²)
  diasUteisMes?: number | null; // config da empresa (padrão 22)
  // Mão de obra por pessoa (CEO 26/11): parâmetros do serviço p/ a conversão automática.
  produtividadePessoa?: number | null;
  produtividadeBase?: "hora" | "dia" | null;
  equipePessoas?: number | null;
  jornadaHorasDia?: number | null;
  // CEO 26/11: ao confirmar o card de produtividade, a página grava esses valores no serviço
  // (projetos_servicos) para pré-preencher na próxima vez (fonte única).
  onProdutividadeServico?: (v: { produtividade_pessoa: number | null; produtividade_base: "hora" | "dia"; equipe_pessoas: number | null; jornada_horas_dia: number | null }) => void | Promise<void>;
}

const METODO_LABEL: Record<string, string> = {
  manual: "Direto", rendimento: "Rendimento", tecnico: "Consumo técnico",
  vida_util: "Vida útil/período", por_pessoa: "Por pessoa × tempo",
};

// Modo de custo da MÃO DE OBRA (CEO 24-25/11), inferido da própria linha (sem coluna nova):
//  • empreitada = linha manual (sem função) precificada por UNIDADE que não é hora (m², m, un, ponto…):
//    paga-se um valor por unidade feita; sem auxílio de produtividade (o custo é o valor por unidade).
//  • por_hora   = função/pessoa/equipe por hora (custo/h × horas por unidade), ou a própria unidade em horas.
const UNIDADES_HORA = ["h", "hr", "hora", "horas"];
function modoMaoObra(linha: BomLinha): "por_hora" | "empreitada" {
  const un = (linha.unidade || "").toLowerCase().replace(/\s/g, "");
  const empreitada = !linha.mao_obra_id && un !== "" && !UNIDADES_HORA.includes(un);
  return empreitada ? "empreitada" : "por_hora";
}

function tipoIcone(tipo: string | TipoItem) {
  if (tipo === "mao_obra") return HardHat;
  if (tipo === "equipamento") return Wrench;
  if (tipo === "ferramenta") return Hammer;
  if (tipo === "epi") return ShieldCheck;
  return Package;
}

function tipoLabel(tipo: string | TipoItem) {
  if (tipo === "mao_obra") return "Mão de obra";
  if (tipo === "equipamento") return "Equipamento";
  if (tipo === "ferramenta") return "Ferramentas";
  if (tipo === "epi") return "EPI";
  return "Material";
}

function tipoCorChip(tipo: string | TipoItem) {
  if (tipo === "mao_obra") return "bg-blue-50 text-blue-800";
  if (tipo === "equipamento") return "bg-purple-50 text-purple-800";
  if (tipo === "ferramenta") return "bg-orange-50 text-orange-800";
  if (tipo === "epi") return "bg-amber-50 text-amber-800";
  return "bg-emerald-50 text-emerald-800";
}

function fmtBRL(v: number | null) {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function parseNumero(s: string): number | null {
  // parseNumBR: aceita vírgula decimal e ponto de milhar (pt-BR).
  return parseNumBR(s);
}

export function BomEditor({ servicoId, companyId, bom, onChange, produtividade, equipePadrao, unidadeServico, diasUteisMes, produtividadePessoa, produtividadeBase, equipePessoas, jornadaHorasDia, onProdutividadeServico }: Props) {
  const [seletorOpen, setSeletorOpen] = useState(false);
  const [salvandoLinha, setSalvandoLinha] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [calcLinha, setCalcLinha] = useState<BomLinha | null>(null);
  const [prodLinha, setProdLinha] = useState<BomLinha | null>(null);

  // Modo A (mão de obra por hora): aplica a quantidade (horas por unidade) vinda do auxílio simples de produtividade.
  // Não usa metodo_coeficiente (os 5 métodos são de material/EPI); guarda só a explicação na observação.
  async function salvarProd(linha: BomLinha, r: ProdResultado) {
    setProdLinha(null);
    setSalvandoLinha(linha.id);
    setErro(null);
    try {
      const supabase = supabaseBrowser();
      const { error } = await supabase
        .from("projetos_servicos_bom")
        .update({ quantidade: r.quantidade, observacao: r.observacao, metodo_coeficiente: null })
        .eq("id", linha.id);
      if (error) throw error;
      await supabase.rpc("fn_projetos_atualizar_cache_bom", { p_servico_id: servicoId });
      // CEO 26/11: grava os inputs no serviço p/ o card pré-preencher na próxima vez (fonte única).
      if (onProdutividadeServico) {
        await onProdutividadeServico({
          produtividade_pessoa: r.produtividade_pessoa,
          produtividade_base: r.produtividade_base,
          equipe_pessoas: r.equipe_pessoas,
          jornada_horas_dia: r.jornada_horas_dia,
        });
      }
      await onChange();
    } catch (e: any) {
      setErro(erroAmigavel(e, "Falha ao aplicar a produtividade"));
    } finally {
      setSalvandoLinha(null);
    }
  }

  async function salvarCalc(linha: BomLinha, r: CoefResultado) {
    setCalcLinha(null);
    setSalvandoLinha(linha.id);
    setErro(null);
    try {
      const supabase = supabaseBrowser();
      const { error } = await supabase
        .from("projetos_servicos_bom")
        .update({
          quantidade: r.quantidade,
          metodo_coeficiente: r.metodo_coeficiente,
          periodo_valor: r.periodo_valor,
          periodo_unidade: r.periodo_unidade,
          qtd_por_periodo: r.qtd_por_periodo,
          observacao: r.observacao || null,
        })
        .eq("id", linha.id);
      if (error) throw error;
      await supabase.rpc("fn_projetos_atualizar_cache_bom", { p_servico_id: servicoId });
      await onChange();
    } catch (e: any) {
      setErro(erroAmigavel(e, "Falha ao aplicar o cálculo"));
    } finally {
      setSalvandoLinha(null);
    }
  }

  // Edição local de quantidade/perda. Confirmamos no blur.
  const [edits, setEdits] = useState<Record<string, { qtd?: string; perda?: string }>>({});

  function setEdit(linhaId: string, key: "qtd" | "perda", valor: string) {
    setEdits((prev) => ({ ...prev, [linhaId]: { ...prev[linhaId], [key]: valor } }));
  }

  async function commitEdit(linha: BomLinha, key: "qtd" | "perda") {
    const draft = edits[linha.id]?.[key];
    if (draft === undefined) return;
    const novo = parseNumero(draft);
    const atual = key === "qtd" ? linha.quantidade : linha.perda_pct;
    if (novo === null || novo === atual) {
      // Limpa edit local se valor inválido ou igual
      setEdits((prev) => {
        const next = { ...prev };
        if (next[linha.id]) {
          delete next[linha.id][key];
          if (Object.keys(next[linha.id]).length === 0) delete next[linha.id];
        }
        return next;
      });
      return;
    }
    setSalvandoLinha(linha.id);
    setErro(null);
    try {
      const supabase = supabaseBrowser();
      const update: Record<string, number> = {};
      if (key === "qtd") update.quantidade = novo;
      else update.perda_pct = novo;
      const { error } = await supabase
        .from("projetos_servicos_bom")
        .update(update)
        .eq("id", linha.id);
      if (error) throw error;
      // Aciona recálculo do cache de custos
      await supabase.rpc("fn_projetos_atualizar_cache_bom", { p_servico_id: servicoId });
      // Limpa edit local
      setEdits((prev) => {
        const next = { ...prev };
        delete next[linha.id];
        return next;
      });
      await onChange();
    } catch (e: any) {
      setErro(erroAmigavel(e, "Falha ao salvar"));
    } finally {
      setSalvandoLinha(null);
    }
  }

  async function adicionarItem(item: ItemEscolhido) {
    setSeletorOpen(false);
    setSalvandoLinha("nova");
    setErro(null);
    try {
      const supabase = supabaseBrowser();
      const proximaOrdem = bom.reduce((max, l) => Math.max(max, l.ordem || 0), 0) + 1;
      const payload: any = {
        servico_id: servicoId,
        tipo: item.tipo,
        quantidade: 1.0,
        unidade: item.unidade,
        perda_pct: item.tipo === "mao_obra" || item.manual ? 0 : 5,
        ordem: proximaOrdem,
        local_id: item.local_id ?? null,
      };
      // Entrada manual (nome + custo digitados) vem antes do tipo: vale para qualquer aba,
      // inclusive "Mão de obra". O CHECK bom_uma_referencia exige UMA referência, e a de um
      // item manual é item_nome_manual — nunca mao_obra_id (que ficaria "" e quebrava o insert).
      if (item.manual) {
        payload.item_nome_manual = item.nome;
        payload.custo_unitario_manual = item.custo ?? 0;
      } else if (item.tipo === "mao_obra") {
        payload.mao_obra_id = item.item_id;
      } else if (item.produto_id) {
        payload.produto_id = item.produto_id; // material/equipamento/EPI do estoque real (erp_produtos)
      } else {
        payload.insumo_id = item.item_id; // legado m16_insumos (itens antigos)
      }
      // Guarda bom_uma_referencia (chamado #11035 · RD-98): o CHECK exige UMA referência não vazia.
      // Item sem id válido (manual sem nome, MO/insumo com id vazio) geraria 23514 cru ("algum valor
      // está fora do permitido"). Barramos antes com mensagem clara em vez do erro de banco.
      const ehRef = (v: unknown) => typeof v === "string" && v.trim() !== "";
      const nRefs =
        (ehRef(payload.item_nome_manual) ? 1 : 0) +
        (ehRef(payload.mao_obra_id) ? 1 : 0) +
        (ehRef(payload.produto_id) ? 1 : 0) +
        (ehRef(payload.insumo_id) ? 1 : 0);
      if (nRefs !== 1) {
        setErro("Não consegui identificar o item selecionado. Escolha o item novamente.");
        return;
      }
      const { error } = await supabase.from("projetos_servicos_bom").insert(payload);
      if (error) throw error;
      await supabase.rpc("fn_projetos_atualizar_cache_bom", { p_servico_id: servicoId });
      await onChange();
    } catch (e: any) {
      setErro(erroAmigavel(e));
    } finally {
      setSalvandoLinha(null);
    }
  }

  async function removerLinha(linha: BomLinha) {
    if (!confirm(`Remover "${linha.item_nome || "este item"}" do BOM?`)) return;
    setSalvandoLinha(linha.id);
    setErro(null);
    try {
      const supabase = supabaseBrowser();
      // RD-98 p4 (exclusão rastreável): nunca DELETE físico direto. A RPC guarda por empresa, grava
      // o snapshot em projetos_servicos_bom_excluido + audit_log_global (quem/quando/motivo) e só então
      // remove a linha viva — o trigger recalcula o custo do serviço.
      const { data, error } = await supabase.rpc("fn_projetos_bom_excluir", {
        p_bom_id: linha.id,
        p_motivo: null,
      });
      if (error) throw error;
      if (data && data.ok === false) throw new Error(data.erro || "Não foi possível remover o item.");
      await supabase.rpc("fn_projetos_atualizar_cache_bom", { p_servico_id: servicoId });
      await onChange();
    } catch (e: any) {
      setErro(erroAmigavel(e));
    } finally {
      setSalvandoLinha(null);
    }
  }

  const sortedBom = [...bom].sort((a, b) => (a.ordem || 0) - (b.ordem || 0));

  return (
    <div>
      {erro && (
        <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{erro}</div>
      )}

      <div className="overflow-x-auto rounded-xl border border-[#3D2314]/8 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-[#3D2314]/5 text-xs uppercase tracking-wider text-[#3D2314]/60">
            <tr>
              <th className="px-3 py-2 text-left">Tipo</th>
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-3 py-2 text-right">
                <span className="inline-flex items-center gap-1">Qtd <AjudaCampo chave="projetos.catalogo.bom.quantidade" rota={ROTA_AJUDA_SERVICO} /></span>
              </th>
              <th className="px-3 py-2 text-left">Un</th>
              <th className="px-3 py-2 text-right">
                <span className="inline-flex items-center gap-1">Perda % <AjudaCampo chave="projetos.catalogo.bom.perda" rota={ROTA_AJUDA_SERVICO} /></span>
              </th>
              <th className="px-3 py-2 text-right">Custo unit.</th>
              <th className="px-3 py-2 text-right">Custo total</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#3D2314]/8">
            {sortedBom.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-[#3D2314]/50">
                  Nenhum item no BOM ainda. Use o botão abaixo para adicionar.
                </td>
              </tr>
            )}
            {sortedBom.map((linha) => {
              const Icon = tipoIcone(linha.tipo);
              const editQtd = edits[linha.id]?.qtd;
              const editPerda = edits[linha.id]?.perda;
              const salvando = salvandoLinha === linha.id;
              const linhaPrincipal = () => (
                <tr key={linha.id} className={salvando ? "opacity-50" : ""}>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tipoCorChip(
                        linha.tipo
                      )}`}
                    >
                      <Icon size={11} />
                      {tipoLabel(linha.tipo)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[#3D2314]">
                    <span className="align-middle">{linha.item_nome || "—"}</span>
                    {linha.tipo === "mao_obra" && (
                      <span
                        data-ajuda="projetos.catalogo.bom.mo_modo"
                        className="ml-2 inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 align-middle text-[10px] font-medium text-blue-800"
                      >
                        {modoMaoObra(linha) === "empreitada" ? `Por ${linha.unidade} (empreitada)` : "Por hora"}
                        <AjudaCampo chave="projetos.catalogo.bom.mo_modo" rota={ROTA_AJUDA_SERVICO} />
                      </span>
                    )}
                  </td>
                  <td data-ajuda="projetos.catalogo.bom.quantidade" className="px-3 py-2 text-right">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={editQtd !== undefined ? editQtd : (linha.quantidade ?? "").toString()}
                      aria-label={`Quantidade de ${linha.item_nome ?? "item"}`}
                      onChange={(e) => setEdit(linha.id, "qtd", e.target.value)}
                      onBlur={() => commitEdit(linha, "qtd")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      disabled={salvando}
                      className="w-20 rounded !border !border-[#3D2314]/12 !bg-white px-2 py-1 text-right font-mono text-sm !text-[#3D2314] focus:!border-[#C8941A] focus:outline-none"
                    />
                  </td>
                  <td className="px-3 py-2 text-[#3D2314]/70">{linha.unidade || "—"}</td>
                  <td data-ajuda="projetos.catalogo.bom.perda" className="px-3 py-2 text-right">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={editPerda !== undefined ? editPerda : (linha.perda_pct ?? "").toString()}
                      aria-label={`Perda % de ${linha.item_nome ?? "item"}`}
                      onChange={(e) => setEdit(linha.id, "perda", e.target.value)}
                      onBlur={() => commitEdit(linha, "perda")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      disabled={salvando}
                      className="w-16 rounded !border !border-[#3D2314]/12 !bg-white px-2 py-1 text-right font-mono text-sm !text-[#3D2314] focus:!border-[#C8941A] focus:outline-none"
                    />
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[#3D2314]/70">
                    {fmtBRL(linha.custo_unitario)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-medium text-[#3D2314]">
                    {fmtBRL(linha.custo_total)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      {linha.tipo !== "mao_obra" ? (
                        // Material/EPI/equipamento/ferramenta: a calculadora dos 5 métodos (consumo/rendimento/vida útil…).
                        <button
                          onClick={() => setCalcLinha(linha)}
                          disabled={salvando}
                          title="Calcular consumo (coeficiente)"
                          className="rounded-lg p-1.5 text-[#C8941A] hover:bg-[#C8941A]/10 disabled:opacity-30"
                        >
                          <Calculator size={14} />
                        </button>
                      ) : modoMaoObra(linha) === "por_hora" ? (
                        // Mão de obra por hora: só o auxílio simples de produtividade (horas por unidade). Nada dos 5 métodos.
                        <button
                          onClick={() => setProdLinha(linha)}
                          disabled={salvando}
                          title="Horas por unidade (produtividade)"
                          className="rounded-lg p-1.5 text-[#C8941A] hover:bg-[#C8941A]/10 disabled:opacity-30"
                        >
                          <Calculator size={14} />
                        </button>
                      ) : null /* mão de obra empreitada: custo é o valor por unidade, sem coeficiente */}
                      <button
                        onClick={() => removerLinha(linha)}
                        disabled={salvando}
                        title="Remover item"
                        className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-30"
                      >
                        {salvando ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </button>
                    </div>
                  </td>
                </tr>
              );
              const temObs = (linha.observacao && linha.observacao.trim() !== "") || linha.metodo_coeficiente;
              return [linhaPrincipal(), temObs ? (
                <tr key={linha.id + "-obs"} className="bg-[#3D2314]/[0.015]">
                  <td></td>
                  <td colSpan={7} className="px-3 pb-2 pt-0 text-xs text-[#3D2314]/60">
                    {linha.metodo_coeficiente && (
                      <span className="mr-2 inline-flex items-center rounded-full bg-[#C8941A]/10 px-2 py-0.5 text-[11px] font-medium text-[#C8941A]">
                        {METODO_LABEL[linha.metodo_coeficiente] || linha.metodo_coeficiente}
                      </span>
                    )}
                    {linha.observacao && <span className="italic">{linha.observacao}</span>}
                  </td>
                </tr>
              ) : null];
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <button
          onClick={() => setSeletorOpen(true)}
          disabled={salvandoLinha === "nova"}
          className="inline-flex items-center gap-2 rounded-lg bg-[#3D2314] px-4 py-2 text-sm font-medium text-[#FAF7F2] hover:bg-[#3D2314]/90 disabled:opacity-50"
        >
          {salvandoLinha === "nova" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Plus size={14} />
          )}
          Adicionar item
        </button>
        <p className="text-xs text-[#3D2314]/50">
          {sortedBom.length} ite{sortedBom.length !== 1 ? "ns" : "m"} no BOM
        </p>
      </div>

      <SeletorItemModal
        open={seletorOpen}
        companyId={companyId}
        onClose={() => setSeletorOpen(false)}
        onSelect={adicionarItem}
      />

      {calcLinha && (
        <CalcCoeficienteModal
          open={!!calcLinha}
          onClose={() => setCalcLinha(null)}
          itemNome={calcLinha.item_nome || "item"}
          unidadeServico={unidadeServico ?? null}
          unidadeItem={calcLinha.unidade}
          custoUnitario={calcLinha.custo_unitario}
          produtividade={produtividade ?? null}
          equipePadrao={equipePadrao ?? null}
          diasUteisMes={diasUteisMes ?? 22}
          atual={{
            quantidade: calcLinha.quantidade,
            metodo_coeficiente: (calcLinha.metodo_coeficiente as CoefResultado["metodo_coeficiente"]) ?? undefined,
            periodo_valor: calcLinha.periodo_valor ?? null,
            periodo_unidade: (calcLinha.periodo_unidade as CoefResultado["periodo_unidade"]) ?? null,
            qtd_por_periodo: calcLinha.qtd_por_periodo ?? null,
            observacao: calcLinha.observacao ?? undefined,
          }}
          onConfirm={(r) => salvarCalc(calcLinha, r)}
        />
      )}

      {prodLinha && (
        <CalcProdutividadeModal
          open={!!prodLinha}
          onClose={() => setProdLinha(null)}
          itemNome={prodLinha.item_nome || "mão de obra"}
          unidadeServico={unidadeServico ?? null}
          produtividadePessoa={produtividadePessoa ?? null}
          produtividadeBase={produtividadeBase ?? null}
          equipePessoas={equipePessoas ?? null}
          jornada={jornadaHorasDia ?? 8}
          onConfirm={(r) => salvarProd(prodLinha, r)}
        />
      )}
    </div>
  );
}
