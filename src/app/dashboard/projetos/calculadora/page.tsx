"use client";

// Hub · HB2 — Calculadora de Obra PS (fatia 2: tela). Motor em src/lib/calculadora/motor.ts (regras como dado).
// Parede simples e forro F530. "Ver a conta" em cada item; unidade de compra + quantidade real; "?" em todo campo (RD-95).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Calculator, AlertTriangle } from "lucide-react";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import EditorRegras from "./EditorRegras";
import { supabaseBrowser } from "@/lib/authFetch";
import { useCompanyIds } from "@/lib/useCompanyIds";
import { custearItens, sugerirVinculos, type ProdutoEstoque } from "@/lib/calculadora/depara";
import { itensParaOrcamento, listaDeCompra, linkWhatsApp, listaDeCompraCsv, listaDeCompraHtml } from "@/lib/calculadora/saida";
import { precoComMargem } from "@/lib/calculadora/margem";
import { mesclarRegras } from "@/lib/calculadora/regras-empresa";
import { RESUMO_VALIDACAO } from "@/lib/calculadora/referencia-validacao";
import { CheckCircle2 } from "lucide-react";
import {
  REGRAS_FORRO_ARAMADO, REGRAS_FORRO_F530, REGRAS_PAREDE_SIMPLES_ST, REGRAS_PAREDE_SEPARATIVA, REGRAS_PAREDE_CORTA_FOGO, REGRAS_REVESTIMENTO_COLADO, calcularRevestimentoColado, REGRAS_REVESTIMENTO_ESTRUTURADO, calcularRevestimentoEstruturado, calcularForroAramado, calcularForroF530, calcularParede, type Resultado,
} from "@/lib/calculadora/motor";

type Sistema = "parede" | "separativa" | "cortafogo" | "forro" | "aramado" | "revestimento" | "estruturado";
const n = (v: string) => Number((v || "0").replace(",", ".")) || 0
// Formatação pt-BR determinística (idêntica no servidor e no navegador). Usar toLocaleString aqui
// causava erro de hidratação React #418 ao abrir a tela: o separador de milhar/moeda do pt-BR
// depende da versão do ICU, que difere entre o Node do servidor e o navegador (ex.: espaço comum
// vs. U+00A0 depois do "R$"), então o HTML do SSR não batia com o primeiro render do cliente.
const agrupaMilhar = (inteiro: string) => inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
const fmtBRL = (v: number) => {
  if (!Number.isFinite(v)) return "R$ 0,00"
  const [int, dec] = Math.abs(v).toFixed(2).split(".")
  return `${v < 0 ? "-" : ""}R$ ${agrupaMilhar(int)},${dec}`
}
const fmt = (v: number) => {
  if (!Number.isFinite(v)) return "0"
  const [int, dec] = Math.abs(v).toFixed(2).split(".")
  const decSemZero = dec.replace(/0+$/, "")
  return `${v < 0 ? "-" : ""}${agrupaMilhar(int)}${decSemZero ? "," + decSemZero : ""}`
}
const inCls = "w-full rounded-lg border border-[#3D2314]/12 bg-white px-3 py-2 text-right font-mono text-sm text-[#3D2314] focus:border-[#C8941A] focus:outline-none";
const lbCls = "mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wider text-[#3D2314]/55";

function Campo({ rotulo, chave, valor, set, testid }: { rotulo: string; chave: string; valor: string; set: (v: string) => void; testid: string }) {
  return (
    <label className="block">
      <span className={lbCls}>{rotulo}<AjudaCampo chave={chave} rota="/dashboard/projetos/calculadora" /></span>
      <input inputMode="decimal" value={valor} data-testid={testid} onChange={(e) => set(e.target.value.replace(/[^\d.,]/g, ""))} className={inCls} />
    </label>
  );
}

export default function CalculadoraObraPage() {
  const [sistema, setSistema] = useState<Sistema>("parede");
  const [comp, setComp] = useState("12,5");
  const [pd, setPd] = useState("2,8");
  const [vaos, setVaos] = useState("1,68");
  const [comLa, setComLa] = useState(false);
  const [estDupla, setEstDupla] = useState(false);
  const [camadas, setCamadas] = useState(1);
  const [larg, setLarg] = useState("3");
  const [compF, setCompF] = useState("4");
  const [avancado, setAvancado] = useState(false);
  const { sel } = useCompanyIds();
  const companyId = sel && !sel.startsWith("group_") && sel !== "consolidado" ? sel : null;
  const [produtos, setProdutos] = useState<ProdutoEstoque[]>([]);
  const [vinculos, setVinculos] = useState<Record<string, string>>({});
  const [erroVinculo, setErroVinculo] = useState<string | null>(null);
  const [orcamentos, setOrcamentos] = useState<{ id: string; numero: string | null; cliente_nome: string | null }[]>([]);
  const [orcId, setOrcId] = useState("");
  const [msgSaida, setMsgSaida] = useState<{ ok: boolean; texto: string } | null>(null);
  const [margem, setMargem] = useState("20");
  const [titulo, setTitulo] = useState("");
  const [historico, setHistorico] = useState<{ id: string; titulo: string; sistema: string; entradas: any; custo_total: number; preco_venda: number; margem_pct: number; criado_em: string }[]>([]);
  const [desfazerCalc, setDesfazerCalc] = useState<string | null>(null);
  const sistemaDb = sistema === "parede" ? "parede" : sistema === "separativa" ? "parede_separativa" : sistema === "cortafogo" ? "parede_corta_fogo" : sistema === "estruturado" ? "revestimento_estruturado" : sistema === "revestimento" ? "revestimento_colado" : sistema === "aramado" ? "forro_aramado" : "forro_f530";

  const carregarEstoque = useCallback(async () => {
    if (!companyId) { setProdutos([]); setVinculos({}); setOrcamentos([]); return; }
    const sb = supabaseBrowser();
    const [p, d, o] = await Promise.all([
      sb.from("erp_produtos").select("id,nome,unidade,preco_custo_medio,preco_custo").eq("company_id", companyId).eq("ativo", true).order("nome").limit(2000),
      sb.from("erp_calc_depara").select("chave,produto_id").eq("company_id", companyId).eq("sistema", sistemaDb),
      sb.from("erp_orcamentos").select("id,numero,cliente_nome").eq("company_id", companyId).eq("status", "rascunho").order("created_at", { ascending: false }).limit(100),
    ]);
    setOrcamentos((o.data ?? []) as any);
    const h = await sb.from("erp_calc_historico").select("id,titulo,sistema,entradas,custo_total,preco_venda,margem_pct,criado_em").eq("company_id", companyId).is("excluido_em", null).order("criado_em", { ascending: false }).limit(10);
    setHistorico((h.data ?? []) as any);
    setProdutos((p.data ?? []).map((x: any) => ({ id: x.id, nome: x.nome, unidade: x.unidade, custo: Number(x.preco_custo_medio) || Number(x.preco_custo) || null })));
    setVinculos(Object.fromEntries((d.data ?? []).map((x: any) => [x.chave, x.produto_id])));
  }, [companyId, sistemaDb]);
  useEffect(() => { void carregarEstoque(); }, [carregarEstoque]);

  async function vincular(chave: string, produtoId: string) {
    if (!companyId) return;
    setErroVinculo(null);
    const sb = supabaseBrowser();
    const q = produtoId
      ? sb.from("erp_calc_depara").upsert({ company_id: companyId, sistema: sistemaDb, chave, produto_id: produtoId, atualizado_em: new Date().toISOString() }, { onConflict: "company_id,sistema,chave" })
      : sb.from("erp_calc_depara").delete().eq("company_id", companyId).eq("sistema", sistemaDb).eq("chave", chave);
    const { error } = await q;
    if (error) { setErroVinculo("Não consegui salvar o vínculo: " + error.message); return; }
    setVinculos((v) => { const n2 = { ...v }; if (produtoId) n2[chave] = produtoId; else delete n2[chave]; return n2; });
  }

  async function sugerirEVincular() {
    if (!res.ok) return;
    const sug = sugerirVinculos(res.itens, vinculos, produtos);
    const chaves = Object.keys(sug);
    if (chaves.length === 0) { setErroVinculo("Não achei produto parecido no estoque para os itens sem vínculo. Escolha à mão ou cadastre o produto."); return; }
    for (const c of chaves) await vincular(c, sug[c]);
  }

  async function mandarParaOrcamento() {
    if (!companyId || !orcId || !res.ok) return;
    setMsgSaida(null);
    const sb = supabaseBrowser();
    const { data: ult } = await sb.from("erp_orcamentos_itens").select("ordem").eq("orcamento_id", orcId).order("ordem", { ascending: false }).limit(1);
    const linhas = itensParaOrcamento(custo.linhas, orcId, companyId, Number(ult?.[0]?.ordem) || 0);
    const { error } = await sb.from("erp_orcamentos_itens").insert(linhas);
    if (!error) await salvarCalculo(orcId, true);
    setMsgSaida(error ? { ok: false, texto: "Não consegui enviar: " + error.message } : { ok: true, texto: `${linhas.length} itens enviados à proposta. Itens sem produto vinculado foram com preço zero para você completar lá.` });
  }

  // Gerar orçamento NOVO a partir do cálculo: cria um rascunho (numero vem do trigger trg_orcamento_set_numero),
  // joga os itens dentro e já deixa selecionado no seletor de proposta. Sem isso, em empresa sem rascunho aberto
  // o único caminho ("Adicionar à proposta") fica morto — foi o gap da auditoria FC (26/10).
  const [gerando, setGerando] = useState(false);
  async function gerarOrcamento() {
    if (!companyId || !res.ok || gerando) return;
    setGerando(true); setMsgSaida(null);
    try {
      const sb = supabaseBrowser();
      const nome = titulo.trim() || tituloLista();
      const { data: novo, error: e1 } = await sb.from("erp_orcamentos")
        .insert({ company_id: companyId, status: "rascunho", cliente_nome: nome })
        .select("id,numero").single();
      if (e1 || !novo) { setMsgSaida({ ok: false, texto: "Não consegui criar o orçamento: " + (e1?.message ?? "erro desconhecido") }); return; }
      const linhas = itensParaOrcamento(custo.linhas, novo.id, companyId, 0);
      const { error: e2 } = await sb.from("erp_orcamentos_itens").insert(linhas);
      if (e2) { setMsgSaida({ ok: false, texto: `Orçamento ${novo.numero ?? ""} criado, mas não consegui enviar os itens: ${e2.message}` }); return; }
      await salvarCalculo(novo.id, true);
      setOrcId(novo.id);
      await carregarEstoque();
      setMsgSaida({ ok: true, texto: `Orçamento ${novo.numero ?? "novo"} criado com ${linhas.length} ${linhas.length === 1 ? "item" : "itens"}. Abra em Orçamentos para fechar a proposta. Itens sem produto vinculado foram com preço zero.` });
    } finally { setGerando(false); }
  }

  async function salvarCalculo(orcamentoId: string | null = null, silencioso = false) {
    if (!companyId || !res.ok) return;
    const sb = supabaseBrowser();
    const { error } = await sb.from("erp_calc_historico").insert({
      company_id: companyId, sistema: sistemaDb, titulo: titulo.trim(), orcamento_id: orcamentoId,
      entradas: { sistema, comp, pd, vaos, comLa, estDupla, camadas, larg, compF },
      itens: custo.linhas.map((l) => ({ chave: l.item.chave, descricao: l.item.descricao, quantidade: l.item.quantidade, unidade: l.item.unidadeCompra, custo_unitario: l.custoUnitario, total: l.total })),
      custo_total: custo.total, margem_pct: venda?.margemPct ?? 0, preco_venda: venda?.preco ?? 0,
    });
    if (error) { if (!silencioso) setMsgSaida({ ok: false, texto: "Não consegui salvar o cálculo: " + error.message }); return; }
    if (!silencioso) setMsgSaida({ ok: true, texto: "Cálculo salvo no histórico." });
    void carregarEstoque();
  }

  // RD-98 p4: exclusão rastreável do cálculo salvo (soft-delete via RPC guardada; desfazer de 15 min por quem excluiu)
  async function excluirCalculo(id: string) {
    const sb = supabaseBrowser();
    const { data, error } = await sb.rpc("fn_calc_historico_excluir", { p_id: id });
    if (error || !(data as any)?.ok) { setMsgSaida({ ok: false, texto: "Não consegui excluir o cálculo." + ((data as any)?.erro ? " " + (data as any).erro : "") }); return; }
    setDesfazerCalc(id);
    void carregarEstoque();
  }
  async function desfazerExcluirCalculo() {
    if (!desfazerCalc) return;
    const sb = supabaseBrowser();
    const { data } = await sb.rpc("fn_calc_historico_restaurar", { p_id: desfazerCalc });
    if ((data as any)?.ok) { setDesfazerCalc(null); void carregarEstoque(); }
    else setMsgSaida({ ok: false, texto: "Não consegui desfazer: " + ((data as any)?.erro ?? "tente de novo") });
  }

  function reabrir(h: { entradas: any }) {
    const e = h.entradas ?? {};
    if (e.sistema) setSistema(e.sistema);
    if (e.comp != null) setComp(String(e.comp)); if (e.pd != null) setPd(String(e.pd)); if (e.vaos != null) setVaos(String(e.vaos));
    if (e.larg != null) setLarg(String(e.larg)); if (e.compF != null) setCompF(String(e.compF));
    setComLa(!!e.comLa); setEstDupla(!!e.estDupla); setCamadas(Number(e.camadas) || 1);
  }

  async function copiarLista() {
    if (!res.ok) return;
    const texto = listaDeCompra(custo.linhas, sistema === "parede" ? "Lista de compra — parede simples" : sistema === "separativa" ? "Lista de compra — parede separativa" : sistema === "cortafogo" ? "Lista de compra — parede corta-fogo" : sistema === "estruturado" ? "Lista de compra — revestimento estruturado" : sistema === "revestimento" ? "Lista de compra — revestimento colado" : sistema === "aramado" ? "Lista de compra — forro aramado" : "Lista de compra — forro F530");
    const ok = () => setMsgSaida({ ok: true, texto: "Lista copiada. É só colar no WhatsApp ou no e-mail." });
    try { await navigator.clipboard.writeText(texto); ok(); return; } catch { /* sem permissão da área de transferência: tenta o caminho antigo */ }
    try {
      const ta = document.createElement("textarea");
      ta.value = texto; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      const copiou = document.execCommand("copy");
      document.body.removeChild(ta);
      if (copiou) { ok(); return; }
    } catch { /* cai na mensagem manual */ }
    setMsgSaida({ ok: false, texto: "Não consegui copiar automaticamente. Selecione e copie a lista manualmente." });
  }

  function tituloLista() {
    return sistema === "parede" ? "Lista de compra — parede simples" : sistema === "separativa" ? "Lista de compra — parede separativa" : sistema === "cortafogo" ? "Lista de compra — parede corta-fogo" : sistema === "estruturado" ? "Lista de compra — revestimento estruturado" : sistema === "revestimento" ? "Lista de compra — revestimento colado" : sistema === "aramado" ? "Lista de compra — forro aramado" : "Lista de compra — forro F530";
  }
  function enviarWhatsApp() {
    if (!res.ok) return;
    window.open(linkWhatsApp(listaDeCompra(custo.linhas, tituloLista())), "_blank", "noopener");
  }
  function baixarExcel() {
    if (!res.ok) return;
    const url = URL.createObjectURL(new Blob([listaDeCompraCsv(custo.linhas)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = "lista-de-compra.csv"; a.click();
    URL.revokeObjectURL(url);
    setMsgSaida({ ok: true, texto: "Planilha baixada. Abre direto no Excel." });
  }

  function imprimirPdf() {
    if (!res.ok) return;
    const w = window.open("", "_blank");
    if (!w) { setMsgSaida({ ok: false, texto: "O navegador bloqueou a janela. Libere pop-ups e tente de novo." }); return; }
    w.document.write(listaDeCompraHtml(custo.linhas, tituloLista()));
    w.document.close(); w.focus(); w.print();
    setMsgSaida({ ok: true, texto: "Na janela de impressão, escolha “Salvar como PDF”." });
  }

  const [regraSalva, setRegraSalva] = useState<unknown>(null);
  const [recarga, setRecarga] = useState(0);
  useEffect(() => {
    setRegraSalva(null);
    if (!companyId) return;
    void supabaseBrowser().from("erp_calc_regra").select("regras").eq("company_id", companyId).eq("sistema", sistemaDb).maybeSingle()
      .then(({ data }) => setRegraSalva(data?.regras ?? null));
  }, [companyId, sistemaDb, recarga]);
  const regrasParede = useMemo(() => mesclarRegras(REGRAS_PAREDE_SIMPLES_ST, sistema === "parede" ? regraSalva : null), [regraSalva, sistema]);
  const regrasSep = useMemo(() => mesclarRegras(REGRAS_PAREDE_SEPARATIVA, sistema === "separativa" ? regraSalva : null), [regraSalva, sistema]);
  const regrasCF = useMemo(() => mesclarRegras(REGRAS_PAREDE_CORTA_FOGO, sistema === "cortafogo" ? regraSalva : null), [regraSalva, sistema]);
  const regrasForro = useMemo(() => mesclarRegras(REGRAS_FORRO_F530, sistema === "forro" ? regraSalva : null), [regraSalva, sistema]);
  const regrasAramado = useMemo(() => mesclarRegras(REGRAS_FORRO_ARAMADO, sistema === "aramado" ? regraSalva : null), [regraSalva, sistema]);
  const regrasRevest = useMemo(() => mesclarRegras(REGRAS_REVESTIMENTO_COLADO, sistema === "revestimento" ? regraSalva : null), [regraSalva, sistema]);
  const regrasEstrut = useMemo(() => mesclarRegras(REGRAS_REVESTIMENTO_ESTRUTURADO, sistema === "estruturado" ? regraSalva : null), [regraSalva, sistema]);
  const res: Resultado = useMemo(() => sistema === "estruturado"
    ? calcularRevestimentoEstruturado(regrasEstrut, { comprimento: n(comp), peDireito: n(pd), vaos: n(vaos), camadas })
    : sistema === "revestimento"
    ? calcularRevestimentoColado(regrasRevest, { comprimento: n(comp), peDireito: n(pd), vaos: n(vaos) })
    : sistema === "parede"
    ? calcularParede(regrasParede, { comprimento: n(comp), peDireito: n(pd), vaos: n(vaos), comLa, camadas, estruturaDupla: estDupla })
    : sistema === "separativa" || sistema === "cortafogo"
    ? calcularParede(sistema === "separativa" ? regrasSep : regrasCF, { comprimento: n(comp), peDireito: n(pd), vaos: n(vaos), comLa, estruturaDupla: sistema === "separativa" && estDupla })
    : sistema === "aramado"
      ? calcularForroAramado(regrasAramado, { largura: n(larg), comprimento: n(compF) })
      : calcularForroF530(regrasForro, { largura: n(larg), comprimento: n(compF) }), [sistema, comp, pd, vaos, comLa, camadas, estDupla, larg, compF, regrasParede, regrasSep, regrasCF, regrasForro, regrasAramado, regrasRevest, regrasEstrut]);

  const custo = useMemo(() => res.ok ? custearItens(res.itens, vinculos, new Map(produtos.map((p) => [p.id, p]))) : { linhas: [], total: 0, semCusto: 0 }, [res, vinculos, produtos]);
  const venda = useMemo(() => precoComMargem(custo.total, n(margem)), [custo.total, margem]);
  const custoPorChave = useMemo(() => Object.fromEntries(custo.linhas.map((l) => [l.item.chave, l])), [custo]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex items-start gap-3">
        <div className="rounded-2xl bg-[#3D2314]/8 p-2.5"><Calculator size={20} className="text-[#C8941A]" /></div>
        <div>
          <h1 className="text-2xl font-medium text-[#3D2314]">Calculadora de Obra</h1>
          <p className="mt-0.5 text-sm text-[#3D2314]/60">Informe as medidas e veja quanto comprar, com a conta de cada item aberta.</p>
        </div>
      </header>

      <section className="mb-5 rounded-2xl border border-[#3D2314]/8 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center gap-2" role="tablist">
          <span className="text-[11px] uppercase tracking-wider text-[#3D2314]/55">Sistema<AjudaCampo chave="projetos.calculadora.sistema" rota="/dashboard/projetos/calculadora" /></span>
          {([["parede", "Parede simples (drywall)"], ["separativa", "Parede separativa"], ["cortafogo", "Parede corta-fogo"], ["forro", "Forro de gesso F530"], ["aramado", "Forro aramado"], ["revestimento", "Revestimento colado"], ["estruturado", "Revestimento estruturado"]] as const).map(([k, t]) => (
            <button key={k} role="tab" aria-selected={sistema === k} data-testid={`calc-sistema-${k}`} onClick={() => setSistema(k)}
              className={`rounded-full px-3 py-1.5 text-sm ${sistema === k ? "bg-[#3D2314] text-white" : "bg-[#3D2314]/5 text-[#3D2314]"}`}>{t}</button>
          ))}
        </div>
        {sistema === "parede" || sistema === "separativa" || sistema === "cortafogo" || sistema === "revestimento" || sistema === "estruturado" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Campo rotulo="Comprimento (m)" chave="projetos.calculadora.comprimento" valor={comp} set={setComp} testid="calc-comprimento" />
            <Campo rotulo="Pé-direito (m)" chave="projetos.calculadora.pe_direito" valor={pd} set={setPd} testid="calc-pe-direito" />
            <Campo rotulo="Vãos a descontar (m²)" chave="projetos.calculadora.vaos" valor={vaos} set={setVaos} testid="calc-vaos" />
            {sistema === "estruturado" && (
            <label className="flex items-center gap-2 text-sm text-[#3D2314] sm:col-span-3">
              Chapas na face
              <select value={camadas} onChange={(e) => setCamadas(Number(e.target.value))} data-testid="calc-camadas" className="rounded-lg border border-[#E8E2D6] px-2 py-1">
                <option value={1}>1 chapa</option><option value={2}>2 chapas</option>
              </select>
              <AjudaCampo chave="projetos.calculadora.camadas" rota="/dashboard/projetos/calculadora" />
            </label>)}
            {(sistema === "separativa" || sistema === "cortafogo") && (<>
            {sistema === "separativa" && (
            <label className="flex items-center gap-2 text-sm text-[#3D2314] sm:col-span-3">
              <input type="checkbox" checked={estDupla} onChange={(e) => setEstDupla(e.target.checked)} data-testid="calc-estrutura-dupla" />
              Estrutura dupla (dois quadros independentes)<AjudaCampo chave="projetos.calculadora.estrutura_dupla" rota="/dashboard/projetos/calculadora" />
            </label>)}
            <label className="flex items-center gap-2 text-sm text-[#3D2314] sm:col-span-3">
              <input type="checkbox" checked={comLa} onChange={(e) => setComLa(e.target.checked)} data-testid="calc-la" />
              Com lã mineral no miolo<AjudaCampo chave="projetos.calculadora.la" rota="/dashboard/projetos/calculadora" />
            </label>
            </>)}
            {sistema === "parede" && (<>
            <label className="flex items-center gap-2 text-sm text-[#3D2314] sm:col-span-3">
              Camadas de chapa por face
              <select value={camadas} onChange={(e) => setCamadas(Number(e.target.value))} data-testid="calc-camadas" className="rounded-lg border border-[#E8E2D6] px-2 py-1">
                <option value={1}>1 (simples)</option><option value={2}>2 (dupla / corta-fogo)</option>
              </select>
              <AjudaCampo chave="projetos.calculadora.camadas" rota="/dashboard/projetos/calculadora" />
            </label>
            <label className="flex items-center gap-2 text-sm text-[#3D2314] sm:col-span-3">
              <input type="checkbox" checked={estDupla} onChange={(e) => setEstDupla(e.target.checked)} data-testid="calc-estrutura-dupla" />
              Estrutura dupla (parede separativa)<AjudaCampo chave="projetos.calculadora.estrutura_dupla" rota="/dashboard/projetos/calculadora" />
            </label>
            <label className="flex items-center gap-2 text-sm text-[#3D2314] sm:col-span-3">
              <input type="checkbox" checked={comLa} onChange={(e) => setComLa(e.target.checked)} data-testid="calc-la" />
              Com lã mineral no miolo<AjudaCampo chave="projetos.calculadora.la" rota="/dashboard/projetos/calculadora" />
            </label>
            </>)}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo rotulo="Largura (m)" chave="projetos.calculadora.largura" valor={larg} set={setLarg} testid="calc-largura" />
            <Campo rotulo="Comprimento (m)" chave="projetos.calculadora.comprimento" valor={compF} set={setCompF} testid="calc-comprimento-forro" />
          </div>
        )}
        <button className="mt-4 text-sm text-[#3D2314]/70 underline" onClick={() => setAvancado(!avancado)} data-testid="calc-avancado">
          {avancado ? "Esconder" : "Mostrar"} parâmetros avançados<AjudaCampo chave="projetos.calculadora.avancado" rota="/dashboard/projetos/calculadora" />
        </button>
        {avancado && (
          companyId ? <EditorRegras companyId={companyId} sistema={sistemaDb} regraSalva={regraSalva} aoSalvar={() => setRecarga((x) => x + 1)} /> : (
            <p className="mt-2 rounded-lg bg-[#FAF7F2] p-3 text-sm text-[#3D2314]/70">Escolha uma empresa para editar as regras. Referência de mercado, <b>a validar com o fabricante</b>.</p>
          )
        )}
      </section>

      {!res.ok ? (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800" data-testid="calc-erro"><AlertTriangle className="mb-0.5 mr-1 inline" size={15} />{res.erro}</div>
      ) : (
        <section className="rounded-2xl border border-[#3D2314]/8 bg-white p-5 shadow-sm" data-testid="calc-resultado">
          <h2 className="mb-3 text-base font-medium text-[#3D2314]">O que comprar <span className="text-sm text-[#3D2314]/50">· área {fmt(res.area)} m² · {res.itens.length} {res.itens.length === 1 ? "item" : "itens"}</span><AjudaCampo chave="projetos.calculadora.resultado" rota="/dashboard/projetos/calculadora" /></h2>
          {companyId && (
            <p className="mb-3 text-sm text-[#3D2314]/70" data-testid="calc-custo-total">
              Custo estimado: <b>{custo.linhas.length > 0 && custo.semCusto === custo.linhas.length ? "sem custo — vincule os itens ao estoque" : fmtBRL(custo.total)}</b><AjudaCampo chave="projetos.calculadora.custo_total" rota="/dashboard/projetos/calculadora" />
              {custo.semCusto > 0 && <span className="ml-2 text-amber-700">{custo.semCusto} item(ns) sem custo — fora do total</span>}
            </p>
          )}
          {/* Estado de validação das fórmulas: com as regras de referência, o cálculo é travado no build contra a suíte de
              referência (gate check-calc-formulas). Quando a empresa edita as regras no avançado, passa a "a validar". */}
          <div className="mb-3 flex flex-wrap items-center gap-1 text-xs" data-testid="calc-validacao">
            {regraSalva == null ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-600/30 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800">
                <CheckCircle2 size={13} aria-hidden />Fórmula validada contra a referência ({RESUMO_VALIDACAO.norma} · {RESUMO_VALIDACAO.total} casos)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-50 px-2 py-0.5 font-medium text-amber-800">
                <AlertTriangle size={13} aria-hidden />Regras próprias desta empresa — a validar com o fabricante
              </span>
            )}
            <AjudaCampo chave="projetos.calculadora.validacao" rota="/dashboard/projetos/calculadora" />
          </div>
          {/* Resultado em DUAS colunas: a lista "o que comprar" (com a conta de cada item) fica à ESQUERDA, no topo da área
              visível; total (acima), margem e exportação à DIREITA (grudada no topo no desktop). No celular empilha com o
              total no topo e os itens logo abaixo. Antes a lista vinha por último e o auditor (RD-38, insight 26/10) só via
              "7 itens cortados"/"rolar para ver a lista" — o que comprar é o resultado e tem de aparecer sem rolagem. */}
          <div className="grid gap-5 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-[#3D2314]/55">Itens e a conta de cada um</h3>
              <ul className="divide-y divide-[#3D2314]/8">
                {res.itens.map((i) => (
                  <li key={i.chave} className="py-2" data-testid={`calc-item-${i.chave}`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 break-words text-sm text-[#3D2314]">{i.descricao}</span>
                      <span className="shrink-0 whitespace-nowrap font-mono text-sm text-[#3D2314]"><b data-testid={`calc-qtd-${i.chave}`}>{i.quantidade}</b> × {i.unidadeCompra}</span>
                    </div>
                    {custoPorChave[i.chave]?.total != null && (
                      <div className="mt-0.5 flex items-baseline justify-between gap-3 text-xs text-[#3D2314]/60">
                        <span className="min-w-0 break-words">{fmtBRL(custoPorChave[i.chave].custoUnitario!)} × {i.quantidade}</span>
                        <span className="shrink-0 whitespace-nowrap tabular-nums">= <b className="text-[#3D2314]">{fmtBRL(custoPorChave[i.chave].total!)}</b></span>
                      </div>
                    )}
                    {companyId && custoPorChave[i.chave]?.aviso && <p className="mt-0.5 text-xs text-amber-700" data-testid={`calc-aviso-${i.chave}`}>{custoPorChave[i.chave].aviso}</p>}
                    <details className="mt-1 text-xs text-[#3D2314]/60">
                      <summary className="cursor-pointer">ver a conta e o produto<AjudaCampo chave="projetos.calculadora.ver_conta" rota="/dashboard/projetos/calculadora" /></summary>
                      <p className="mt-1">{i.conta} = {fmt(i.quantidadeBruta)} → compra {i.quantidade}</p>
                      {i.equivalente && <p className="mt-1" data-testid={`calc-equiv-${i.chave}`}>{i.equivalente}</p>}
                      {companyId && (
                        <label className="mt-1.5 flex items-center gap-2">
                          <span className="flex items-center">Produto do estoque<AjudaCampo chave="projetos.calculadora.produto" rota="/dashboard/projetos/calculadora" /></span>
                          <select value={vinculos[i.chave] ?? ""} data-testid={`calc-produto-${i.chave}`} onChange={(e) => void vincular(i.chave, e.target.value)}
                            className="min-w-0 flex-1 rounded border border-[#3D2314]/12 bg-white px-2 py-1 text-xs">
                            <option value="">Sem vínculo</option>
                            {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}{p.unidade ? ` (${p.unidade})` : ""}</option>)}
                          </select>
                        </label>
                      )}
                    </details>
                  </li>
                ))}
              </ul>
            </div>
            <div className="lg:col-span-2 lg:sticky lg:top-4 lg:self-start">
              {companyId && (
                <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-1" data-testid="calc-margem-bloco">
                  <Campo rotulo="Margem (%)" chave="projetos.calculadora.margem" valor={margem} set={setMargem} testid="calc-margem" />
                  <p className="text-sm text-[#3D2314]/70 sm:col-span-2 sm:self-end lg:col-span-1 lg:self-auto" data-testid="calc-venda">
                    {venda ? <>Preço de venda: <b>{fmtBRL(venda.preco)}</b> · Lucro: <b>{fmtBRL(venda.lucro)}</b></> : "Informe uma margem entre 0 e 95%."}
                  </p>
                </div>
              )}
              {companyId && custo.semCusto > 0 && (
                <button onClick={() => void sugerirEVincular()} data-testid="calc-sugerir-vinculos" className="mb-2 rounded-full bg-[#C8941A]/15 px-4 py-2 text-sm text-[#3D2314]">
                  Sugerir produtos do estoque<AjudaCampo chave="projetos.calculadora.sugerir_produtos" rota="/dashboard/projetos/calculadora" />
                </button>
              )}
              {erroVinculo && <p className="mb-2 text-sm text-red-700">{erroVinculo}</p>}
              <div className="flex flex-col gap-2 rounded-xl bg-[#FAF7F2] p-3" data-testid="calc-saida">
                {companyId && (
                  <button onClick={() => void gerarOrcamento()} disabled={gerando} data-testid="calc-gerar-orcamento" className="self-start rounded-full bg-[#C8941A] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                    {gerando ? "Gerando…" : "Gerar orçamento do cálculo"}<AjudaCampo chave="projetos.calculadora.gerar_orcamento" rota="/dashboard/projetos/calculadora" />
                  </button>
                )}
                <button onClick={() => void copiarLista()} data-testid="calc-copiar-lista" className="self-start rounded-full bg-[#3D2314]/5 px-4 py-2 text-sm text-[#3D2314]">
                  Copiar lista de compra<AjudaCampo chave="projetos.calculadora.lista_compra" rota="/dashboard/projetos/calculadora" />
                </button>
                <div className="flex flex-wrap gap-2">
                  <button onClick={enviarWhatsApp} data-testid="calc-whatsapp" className="rounded-full bg-[#3D2314]/5 px-4 py-2 text-sm text-[#3D2314]">
                    Enviar por WhatsApp<AjudaCampo chave="projetos.calculadora.whatsapp" rota="/dashboard/projetos/calculadora" />
                  </button>
                  <button onClick={baixarExcel} data-testid="calc-excel" className="rounded-full bg-[#3D2314]/5 px-4 py-2 text-sm text-[#3D2314]">
                    Baixar Excel<AjudaCampo chave="projetos.calculadora.excel" rota="/dashboard/projetos/calculadora" />
                  </button>
                  <button onClick={imprimirPdf} data-testid="calc-pdf" className="rounded-full bg-[#3D2314]/5 px-4 py-2 text-sm text-[#3D2314]">
                    Imprimir / PDF<AjudaCampo chave="projetos.calculadora.pdf" rota="/dashboard/projetos/calculadora" />
                  </button>
                </div>
                {companyId && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Nome do cálculo (obra, cliente…)" data-testid="calc-titulo" className="min-w-0 flex-1 rounded border border-[#3D2314]/12 bg-white px-2 py-1.5 text-sm" />
                    <AjudaCampo chave="projetos.calculadora.titulo_calculo" rota="/dashboard/projetos/calculadora" />
                    <button onClick={() => void salvarCalculo()} data-testid="calc-salvar" className="rounded-full bg-[#3D2314]/5 px-4 py-2 text-sm text-[#3D2314]">Salvar cálculo<AjudaCampo chave="projetos.calculadora.salvar_calculo" rota="/dashboard/projetos/calculadora" /></button>
                  </div>
                )}
                {companyId && (
                  <label className="flex flex-wrap items-center gap-2 text-sm text-[#3D2314]/70">
                    <span className="flex items-center">Proposta em rascunho<AjudaCampo chave="projetos.calculadora.orcamento" rota="/dashboard/projetos/calculadora" /></span>
                    <select value={orcId} onChange={(e) => setOrcId(e.target.value)} data-testid="calc-orcamento" className="min-w-0 flex-1 rounded border border-[#3D2314]/12 bg-white px-2 py-1.5 text-sm">
                      <option value="">{orcamentos.length ? "Escolha o orçamento" : "Nenhum orçamento em rascunho"}</option>
                      {orcamentos.map((o) => <option key={o.id} value={o.id}>{o.numero ?? "sem número"}{o.cliente_nome ? ` · ${o.cliente_nome}` : ""}</option>)}
                    </select>
                    <button onClick={() => void mandarParaOrcamento()} disabled={!orcId} data-testid="calc-mandar-orcamento" className="rounded-full bg-[#3D2314] px-4 py-2 text-sm text-white disabled:opacity-40">Adicionar à proposta<AjudaCampo chave="projetos.calculadora.adicionar_proposta" rota="/dashboard/projetos/calculadora" /></button>
                  </label>
                )}
                {msgSaida && <p className={`text-sm ${msgSaida.ok ? "text-emerald-700" : "text-red-700"}`} data-testid="calc-saida-msg">{msgSaida.texto}</p>}
              </div>
            </div>
          </div>
        </section>
      )}
      {companyId && (
        <section className="mt-5 rounded-2xl border border-[#3D2314]/8 bg-white p-5 shadow-sm" data-testid="calc-historico">
          <h2 className="mb-3 text-base font-medium text-[#3D2314]">Cálculos anteriores<AjudaCampo chave="projetos.calculadora.historico" rota="/dashboard/projetos/calculadora" /></h2>
          {desfazerCalc && (
            <div role="status" className="mb-3 flex items-center gap-2 rounded-lg border border-[#C8941A] bg-white px-3 py-2 text-sm text-[#3D2314]">
              Cálculo excluído.<button onClick={() => void desfazerExcluirCalculo()} data-testid="calc-historico-desfazer" className="font-medium underline">Desfazer</button>
              <AjudaCampo chave="projetos.calculadora.desfazer_calculo" rota="/dashboard/projetos/calculadora" />
            </div>
          )}
          {historico.length === 0 ? <p className="text-sm text-[#3D2314]/60">Nenhum cálculo salvo ainda. Use “Salvar cálculo” depois de calcular.</p> : (
            <ul className="divide-y divide-[#3D2314]/8">
              {historico.map((h) => (
                <li key={h.id} className="flex items-baseline gap-2">
                  <button onClick={() => reabrir(h)} data-testid="calc-historico-item" className="flex min-w-0 flex-1 items-baseline justify-between gap-3 py-2.5 text-left text-sm text-[#3D2314]">
                    <span className="min-w-0 truncate">{h.titulo || "Sem nome"} <span className="text-xs text-[#3D2314]/50">· {new Date(h.criado_em).toLocaleDateString("pt-BR")}</span></span>
                    <span className="shrink-0 font-mono text-xs">{fmtBRL(Number(h.preco_venda) || Number(h.custo_total))}</span>
                  </button>
                  <span className="flex shrink-0 items-center gap-0.5">
                    <button onClick={() => void excluirCalculo(h.id)} data-testid="calc-historico-excluir" className="text-xs text-red-700 underline opacity-80 hover:opacity-100">Excluir</button>
                    <AjudaCampo chave="projetos.calculadora.excluir_calculo" rota="/dashboard/projetos/calculadora" />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
