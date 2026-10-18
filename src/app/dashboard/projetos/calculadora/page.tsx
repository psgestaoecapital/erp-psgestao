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
import { itensParaOrcamento, listaDeCompra, linkWhatsApp, listaDeCompraCsv } from "@/lib/calculadora/saida";
import { mesclarRegras } from "@/lib/calculadora/regras-empresa";
import {
  REGRAS_FORRO_ARAMADO, REGRAS_FORRO_F530, REGRAS_PAREDE_SIMPLES_ST, REGRAS_PAREDE_SEPARATIVA, REGRAS_PAREDE_CORTA_FOGO, REGRAS_REVESTIMENTO_COLADO, calcularRevestimentoColado, REGRAS_REVESTIMENTO_ESTRUTURADO, calcularRevestimentoEstruturado, calcularForroAramado, calcularForroF530, calcularParede, type Resultado,
} from "@/lib/calculadora/motor";

type Sistema = "parede" | "separativa" | "cortafogo" | "forro" | "aramado" | "revestimento" | "estruturado";
const n = (v: string) => Number((v || "0").replace(",", ".")) || 0
const fmtBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const fmt = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })
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
    setMsgSaida(error ? { ok: false, texto: "Não consegui enviar: " + error.message } : { ok: true, texto: `${linhas.length} itens enviados ao orçamento. Itens sem produto vinculado foram com preço zero para você completar lá.` });
  }

  async function copiarLista() {
    if (!res.ok) return;
    const texto = listaDeCompra(custo.linhas, sistema === "parede" ? "Lista de compra — parede simples" : sistema === "separativa" ? "Lista de compra — parede separativa" : sistema === "cortafogo" ? "Lista de compra — parede corta-fogo" : sistema === "estruturado" ? "Lista de compra — revestimento estruturado" : sistema === "revestimento" ? "Lista de compra — revestimento colado" : sistema === "aramado" ? "Lista de compra — forro aramado" : "Lista de compra — forro F530");
    try { await navigator.clipboard.writeText(texto); setMsgSaida({ ok: true, texto: "Lista copiada. É só colar no WhatsApp ou no e-mail." }); }
    catch { setMsgSaida({ ok: false, texto: "Não consegui copiar automaticamente. Selecione e copie a lista manualmente." }); }
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
          <h2 className="mb-3 text-base font-medium text-[#3D2314]">O que comprar <span className="text-sm text-[#3D2314]/50">· área {fmt(res.area)} m²</span><AjudaCampo chave="projetos.calculadora.resultado" rota="/dashboard/projetos/calculadora" /></h2>
          {companyId && (
            <p className="mb-2 text-sm text-[#3D2314]/70" data-testid="calc-custo-total">
              Custo estimado: <b>{fmtBRL(custo.total)}</b><AjudaCampo chave="projetos.calculadora.custo_total" rota="/dashboard/projetos/calculadora" />
              {custo.semCusto > 0 && <span className="ml-2 text-amber-700">{custo.semCusto} item(ns) sem custo — fora do total</span>}
            </p>
          )}
          {companyId && custo.semCusto > 0 && (
            <button onClick={() => void sugerirEVincular()} data-testid="calc-sugerir-vinculos" className="mb-2 rounded-full bg-[#C8941A]/15 px-4 py-2 text-sm text-[#3D2314]">
              Sugerir produtos do estoque<AjudaCampo chave="projetos.calculadora.produto" rota="/dashboard/projetos/calculadora" />
            </button>
          )}
          {erroVinculo && <p className="mb-2 text-sm text-red-700">{erroVinculo}</p>}
          <ul className="divide-y divide-[#3D2314]/8">
            {res.itens.map((i) => (
              <li key={i.chave} className="py-2.5" data-testid={`calc-item-${i.chave}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-[#3D2314]">{i.descricao}</span>
                  <span className="font-mono text-sm text-[#3D2314]"><b data-testid={`calc-qtd-${i.chave}`}>{i.quantidade}</b> × {i.unidadeCompra}</span>
                </div>
                {companyId && (
                  <label className="mt-1 flex items-center gap-2 text-xs text-[#3D2314]/60">
                    <span className="flex items-center">Produto do estoque<AjudaCampo chave="projetos.calculadora.produto" rota="/dashboard/projetos/calculadora" /></span>
                    <select value={vinculos[i.chave] ?? ""} data-testid={`calc-produto-${i.chave}`} onChange={(e) => void vincular(i.chave, e.target.value)}
                      className="min-w-0 flex-1 rounded border border-[#3D2314]/12 bg-white px-2 py-1 text-xs">
                      <option value="">Sem vínculo</option>
                      {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}{p.unidade ? ` (${p.unidade})` : ""}</option>)}
                    </select>
                  </label>
                )}
                {companyId && custoPorChave[i.chave]?.aviso && <p className="mt-0.5 text-xs text-amber-700" data-testid={`calc-aviso-${i.chave}`}>{custoPorChave[i.chave].aviso}</p>}
                {custoPorChave[i.chave]?.total != null && <p className="mt-0.5 text-xs text-[#3D2314]/60">{fmtBRL(custoPorChave[i.chave].custoUnitario!)} × {i.quantidade} = <b>{fmtBRL(custoPorChave[i.chave].total!)}</b></p>}
                <details className="mt-1 text-xs text-[#3D2314]/60">
                  <summary className="cursor-pointer">ver a conta</summary>
                  {i.conta} = {fmt(i.quantidadeBruta)} → compra {i.quantidade}
                </details>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-col gap-2 border-t border-[#3D2314]/8 pt-4" data-testid="calc-saida">
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
            </div>
            {companyId && (
              <label className="flex flex-wrap items-center gap-2 text-sm text-[#3D2314]/70">
                <span className="flex items-center">Orçamento em rascunho<AjudaCampo chave="projetos.calculadora.orcamento" rota="/dashboard/projetos/calculadora" /></span>
                <select value={orcId} onChange={(e) => setOrcId(e.target.value)} data-testid="calc-orcamento" className="min-w-0 flex-1 rounded border border-[#3D2314]/12 bg-white px-2 py-1.5 text-sm">
                  <option value="">{orcamentos.length ? "Escolha o orçamento" : "Nenhum orçamento em rascunho"}</option>
                  {orcamentos.map((o) => <option key={o.id} value={o.id}>{o.numero ?? "sem número"}{o.cliente_nome ? ` · ${o.cliente_nome}` : ""}</option>)}
                </select>
                <button onClick={() => void mandarParaOrcamento()} disabled={!orcId} data-testid="calc-mandar-orcamento" className="rounded-full bg-[#3D2314] px-4 py-2 text-sm text-white disabled:opacity-40">Mandar para o orçamento</button>
              </label>
            )}
            {msgSaida && <p className={`text-sm ${msgSaida.ok ? "text-emerald-700" : "text-red-700"}`} data-testid="calc-saida-msg">{msgSaida.texto}</p>}
          </div>
        </section>
      )}
    </main>
  );
}
