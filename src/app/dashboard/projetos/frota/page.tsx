// src/app/dashboard/projetos/frota/page.tsx
// Hub · Controle de frota (chamado #5166, FC/FCR; evolução #5175). Uma tela só (RD-99): cards da frota com os alertas de
// manutenção, custo e documentos; cadastro do veículo com o plano preventivo (a cada quantos km) e os dados extras na
// mesma tela; dentro do veículo, as abas Custos, Documentos (IPVA, seguro, licenciamento) e Manutenções.
// Km e consumo vêm das VIAGENS (RPC fn_hub_frota_indicadores); esta tela não digita km nem litros.
// Semáforo (verde/amarelo/vermelho) e custo por km calculados no banco. Anexos no bucket privado frota-anexos.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useCompanyIds } from "@/lib/useCompanyIds";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { RelatoriosFrota } from "@/components/frota/RelatoriosFrota";

const ROTA = "/dashboard/projetos/frota";
const BUCKET_ANEXOS = "frota-anexos";
const ANEXO_MAX = 10 * 1024 * 1024;
const ANEXO_TIPOS = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const ESP = "#3D2314", BRANCO = "#FFFFFF", BD = "#E7DED3", TXM = "#6B5D4F", BG = "#F7F3EC";
const COR = { vermelho: "#B91C1C", amarelo: "#B45309", verde: "#166534", sem_plano: "#8A7D6E", sem_doc: "#8A7D6E" } as const;
const FUNDO = { vermelho: "#FEE2E2", amarelo: "#FEF3C7", verde: "#DCFCE7", sem_plano: "#EFEAE2", sem_doc: "#EFEAE2" } as const;
const ROTULO = { vermelho: "Vencida", amarelo: "Perto", verde: "Em dia", sem_plano: "Sem plano", sem_doc: "Sem documento" } as const;
const TIPOS = [["carro", "Carro"], ["caminhonete", "Caminhonete"], ["caminhao", "Caminhão"], ["moto", "Moto"]] as const;
const COMBUSTIVEIS = ["Diesel", "Gasolina", "Flex", "Etanol", "Elétrico"];
const CAMBIOS = ["Manual", "Automático"];
const CATEGORIAS = [
  ["manutencao", "Manutenção"], ["pneu", "Pneu"], ["combustivel", "Combustível"], ["ipva", "IPVA"],
  ["licenciamento", "Licenciamento"], ["seguro", "Seguro"], ["multa", "Multa"], ["documentacao", "Documentação"], ["outro", "Outro"],
] as const;
const TIPOS_DOC = [["ipva", "IPVA"], ["seguro", "Seguro"], ["licenciamento", "Licenciamento"], ["outro", "Outro"]] as const;
const SUGESTOES = ["Troca de óleo", "Pneus", "Revisão", "Freios", "Correia", "Filtros"];

type Status = keyof typeof COR;
type Plano = { id: string; tipo: string; intervalo_km: number; ultimo_km: number; proxima_km: number; km_para_proxima: number; status: "verde" | "amarelo" | "vermelho" };
type Doc = { id: string; tipo: string; vencimento: string; valor: number | null; anexo_path: string | null; dias: number; status: Status };
type Veiculo = {
  id: string; placa: string; modelo: string | null; marca: string | null; ano: number | null; tipo: string;
  km_atual: number; km_percorrido: number; litros: number; consumo_km_l: number | null;
  custo_manutencao: number; custo_combustivel: number; custo_total: number; custo_por_km: number | null;
  status_geral: Status; vencidos: number; amarelos: number; planos: Plano[];
  status_docs: Status; docs_vencidos: number; docs_amarelos: number; documentos: Doc[];
};
type Resumo = {
  total_veiculos: number; veiculos_vencidos: number; consumo_medio_frota: number | null;
  documentos_vencidos: number; custo_total_frota: number; custo_por_km_frota: number | null;
};
type Registro = { id: string; tipo: string; data: string; km_na_manutencao: number; valor: number | null; fornecedor: string | null; descricao: string | null; anexo_path: string | null };
type Custo = {
  id: string; categoria: string; descricao: string | null; valor: number; fornecedor_nome: string | null; data_custo: string;
  documento: string | null; anexo_path: string | null; entra_base_fiscal: boolean;
};
type Form = { placa: string; modelo: string; marca: string; ano: string; tipo: string; km_inicial: string; chassi: string; renavam: string; observacao: string };
type Extra = {
  versao: string; cor: string; combustivel: string; cambio: string; potencia_cv: string; lugares: string; ncm: string;
  valor_aquisicao: string; data_entrada: string; fornecedor_nome: string; crlv_path: string; tem_manual: boolean; tem_chave_reserva: boolean;
};
type PlanoForm = { id?: string; tipo: string; intervalo_km: string; ultimo_km: string };
type CustoForm = { categoria: string; valor: string; data_custo: string; descricao: string; fornecedor_nome: string; documento: string; entra_base_fiscal: boolean };
type DocForm = { tipo: string; vencimento: string; valor: string };

const FORM_VAZIO: Form = { placa: "", modelo: "", marca: "", ano: "", tipo: "carro", km_inicial: "", chassi: "", renavam: "", observacao: "" };
const EXTRA_VAZIO: Extra = {
  versao: "", cor: "", combustivel: "", cambio: "", potencia_cv: "", lugares: "", ncm: "", valor_aquisicao: "", data_entrada: "",
  fornecedor_nome: "", crlv_path: "", tem_manual: false, tem_chave_reserva: false,
};
const CUSTO_VAZIO: CustoForm = { categoria: "manutencao", valor: "", data_custo: "", descricao: "", fornecedor_nome: "", documento: "", entra_base_fiscal: false };
const DOC_VAZIO: DocForm = { tipo: "ipva", vencimento: "", valor: "" };

const num = (n: number | null | undefined) => (n == null ? "—" : Math.round(Number(n)).toLocaleString("pt-BR"));
const kmL = (n: number | null) => (n == null ? "—" : `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km/l`);
const moeda = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const dataBR = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
// Valor digitado em reais ("1.250,00") vira o decimal que o banco aceita ("1250.00").
const decimal = (s: string) => (s.trim() ? s.replace(/\./g, "").replace(",", ".") : "");

async function enviarAnexo(companyId: string, pasta: string, arquivo: File): Promise<string> {
  if (!ANEXO_TIPOS.includes(arquivo.type)) throw new Error("O anexo precisa ser PDF, JPG, PNG ou WEBP.");
  if (arquivo.size > ANEXO_MAX) throw new Error("O anexo passa de 10 MB.");
  const nome = arquivo.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const path = `${companyId}/${pasta}/${Date.now()}-${nome}`;
  const { error } = await supabase.storage.from(BUCKET_ANEXOS).upload(path, arquivo, { contentType: arquivo.type, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

async function abrirAnexo(path: string) {
  const { data, error } = await supabase.storage.from(BUCKET_ANEXOS).createSignedUrl(path, 3600);
  if (error || !data) { window.alert("Não foi possível abrir o anexo."); return; }
  window.open(data.signedUrl, "_blank", "noopener");
}

export default function FrotaPage() {
  const { sel, companies } = useCompanyIds();
  const companyId = sel && !sel.startsWith("group_") && sel !== "consolidado" ? sel : null;
  const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [excluidos, setExcluidos] = useState<{ id: string; placa: string; modelo: string | null; excluido_em: string }[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | "novo" | null>(null);
  const [mostrarExcluidos, setMostrarExcluidos] = useState(false);
  const [visao, setVisao] = useState<"frota" | "relatorios">("frota");

  const carregar = useCallback(async () => {
    if (!companyId) return;
    const { data, error } = await supabase.rpc("fn_hub_frota_indicadores", { p_company_id: companyId, p_veiculo_id: null });
    if (error) { setErro(error.message); return; }
    setErro(null);
    const d = data as { resumo: Resumo; veiculos: Veiculo[] };
    setResumo(d.resumo); setVeiculos(d.veiculos ?? []);
    const { data: ex } = await supabase.from("erp_hub_frota_veiculo").select("id, placa, modelo, excluido_em")
      .eq("company_id", companyId).not("excluido_em", "is", null).order("excluido_em", { ascending: false });
    setExcluidos((ex ?? []) as typeof excluidos);
  }, [companyId]);

  useEffect(() => { void carregar(); }, [carregar]);

  const nomeEmpresa = companies.find((c) => c.id === companyId)?.nome_fantasia ?? "";
  const veic = useMemo(() => veiculos.find((v) => v.id === aberto) ?? null, [veiculos, aberto]);

  if (!companyId) return <div className="p-4 text-sm" style={{ color: TXM }}>Escolha uma empresa para ver a frota.</div>;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4" style={{ color: ESP, background: BG }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Controle de frota</h1>
          <div className="text-xs" style={{ color: TXM }}>{nomeEmpresa} · km e consumo vêm das viagens lançadas</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg border p-1" style={{ borderColor: BD }}>
            {(["frota", "relatorios"] as const).map((v) => (
              <button key={v} onClick={() => setVisao(v)} className="rounded-md px-3 py-1 text-sm"
                style={{ background: visao === v ? ESP : "transparent", color: visao === v ? BRANCO : ESP }}>
                {v === "frota" ? "Frota" : "Relatórios"}
              </button>
            ))}
          </div>
          {/* Rastreabilidade do km/consumo: a frota não digita km nem litros — eles vêm das viagens. */}
          <div className="flex items-center gap-1">
            <a href="/dashboard/projetos/viagens" className="rounded-lg border px-3 py-2 text-sm font-medium"
              style={{ borderColor: BD, color: ESP }}>Ver viagens →</a>
            <AjudaCampo chave="projetos.frota.ver_viagens" rota={ROTA} />
          </div>
          {visao === "frota" && (
            <button data-testid="frota-novo-veiculo" onClick={() => setAberto("novo")}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: ESP }}>
              + Novo veículo
            </button>
          )}
        </div>
      </div>

      {erro && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</div>}

      {visao === "relatorios" && <RelatoriosFrota companyId={companyId} veiculos={veiculos} />}

      {visao === "frota" && (
      <>
      {/* indicadores do topo */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Indicador titulo="Veículos" valor={resumo?.total_veiculos ?? 0} chave="projetos.frota.placa" />
        <Indicador titulo="Manutenção vencida" valor={resumo?.veiculos_vencidos ?? 0} cor={COR.vermelho} chave="projetos.frota.alerta" />
        <Indicador titulo="Documentos vencidos" valor={resumo?.documentos_vencidos ?? 0} cor={COR.vermelho} chave="projetos.frota.doc_vencimento" />
        <Indicador titulo="Custo total da frota" valor={moeda(resumo?.custo_total_frota ?? 0)} chave="projetos.frota.custo_total" />
        <Indicador titulo="Custo por km" valor={resumo?.custo_por_km_frota != null ? `${moeda(resumo.custo_por_km_frota)}/km` : "—"} chave="projetos.frota.custo_km" />
        <Indicador titulo="Consumo médio da frota" valor={kmL(resumo?.consumo_medio_frota ?? null)} chave="projetos.frota.consumo" />
      </div>

      {/* cards: vermelhos primeiro (o banco já ordena) */}
      {veiculos.length === 0 && !erro && (
        <div className="rounded-xl border p-6 text-center text-sm" style={{ borderColor: BD, background: BRANCO, color: TXM }}>
          Nenhum veículo cadastrado. Use “Novo veículo” e já deixe o plano de manutenção.
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {veiculos.map((v) => (
          <button key={v.id} onClick={() => setAberto(v.id)} className="rounded-xl border p-4 text-left"
            style={{ borderColor: v.status_geral === "vermelho" || v.status_docs === "vermelho" ? COR.vermelho : BD, background: BRANCO }}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-mono text-base font-bold">{v.placa}</div>
                <div className="text-xs" style={{ color: TXM }}>{[v.marca, v.modelo].filter(Boolean).join(" ") || "sem modelo"}</div>
              </div>
              <span className="flex flex-col items-end rounded px-2 py-0.5 text-[11px] font-semibold" style={{ background: FUNDO[v.status_geral], color: COR[v.status_geral] }}>
                <span className="text-[9px] font-bold uppercase opacity-70">Manutenção</span>
                {ROTULO[v.status_geral]}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div><span style={{ color: TXM }}>Km atual</span><div className="font-semibold">{num(v.km_atual)}</div></div>
              <div><span style={{ color: TXM }}>Consumo</span><div className="font-semibold">{kmL(v.consumo_km_l)}</div></div>
              <div><span style={{ color: TXM }}>Custo/km</span><div className="font-semibold">{v.custo_por_km != null ? moeda(v.custo_por_km) : "—"}</div></div>
            </div>
            <div className="mt-3 space-y-1">
              {v.planos.length === 0 && <div className="text-xs" style={{ color: TXM }}>Sem plano preventivo</div>}
              {v.planos.slice(0, 3).map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-md px-2 py-1 text-xs"
                  style={{ background: FUNDO[p.status] }}>
                  <span>{p.tipo}</span>
                  <b style={{ color: COR[p.status] }}>
                    {p.km_para_proxima <= 0 ? `vencida há ${num(-p.km_para_proxima)} km` : `faltam ${num(p.km_para_proxima)} km`}
                  </b>
                </div>
              ))}
              {v.status_docs !== "sem_doc" && (
                <div className="flex items-center justify-between rounded-md px-2 py-1 text-xs" style={{ background: FUNDO[v.status_docs] }}>
                  <span>Documentos</span>
                  <b style={{ color: COR[v.status_docs] }}>{ROTULO[v.status_docs]}</b>
                </div>
              )}
            </div>
            {/* Sinaliza no 1º paint que o card abre o detalhe completo do veículo. */}
            <div className="mt-3 border-t pt-2 text-[11px] font-medium" style={{ borderColor: BD, color: ESP }}>
              Toque para custos, documentos e manutenções →
            </div>
          </button>
        ))}
      </div>

      {excluidos.length > 0 && (
        <div>
          <button onClick={() => setMostrarExcluidos((x) => !x)} className="text-xs underline" style={{ color: TXM }}>
            {mostrarExcluidos ? "Ocultar" : "Ver"} veículos excluídos ({excluidos.length})
          </button>
          {mostrarExcluidos && (
            <div className="mt-2 space-y-2">
              {excluidos.map((x) => (
                <ExcluidoLinha key={x.id} x={x} companyId={companyId} onFeito={carregar} />
              ))}
            </div>
          )}
        </div>
      )}

      </>
      )}

      {aberto === "novo" && (
        <PainelVeiculo key="novo" companyId={companyId} veic={null} onFechar={() => setAberto(null)} onSalvo={carregar} />
      )}
      {veic && (
        <PainelVeiculo key={veic.id} companyId={companyId} veic={veic} onFechar={() => setAberto(null)} onSalvo={carregar} />
      )}
    </div>
  );
}

function Indicador({ titulo, valor, cor, chave }: { titulo: string; valor: number | string; cor?: string; chave: string }) {
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: BD, background: BRANCO }}>
      <div className="flex items-center gap-1 text-[11px] font-semibold uppercase" style={{ color: TXM }}>
        {titulo} <AjudaCampo chave={chave} rota={ROTA} />
      </div>
      <div className="mt-1 text-xl font-bold" style={{ color: cor ?? ESP }}>{valor}</div>
    </div>
  );
}

function ExcluidoLinha({ x, companyId, onFeito }: { x: { id: string; placa: string; modelo: string | null }; companyId: string; onFeito: () => void }) {
  const [erro, setErro] = useState<string | null>(null);
  async function restaurar() {
    const { error } = await supabase.rpc("fn_hub_frota_veiculo_restaurar", { p_id: x.id, p_motivo: "restaurado pela tela" });
    if (error) { setErro(error.message); return; }
    onFeito();
  }
  return (
    <div className="flex items-center justify-between rounded-lg border p-2 text-xs" style={{ borderColor: BD, background: BRANCO }} data-company={companyId}>
      <span>{x.placa} · {x.modelo ?? "sem modelo"}</span>
      <button onClick={restaurar} className="rounded border px-2 py-1" style={{ borderColor: ESP }}>Restaurar</button>
      {erro && <span role="alert" className="text-red-700">{erro}</span>}
    </div>
  );
}

function PainelVeiculo({ companyId, veic, onFechar, onSalvo }: {
  companyId: string; veic: Veiculo | null; onFechar: () => void; onSalvo: () => void;
}) {
  const [f, setF] = useState<Form>(() => (veic ? { ...FORM_VAZIO, placa: veic.placa, modelo: veic.modelo ?? "", marca: veic.marca ?? "", ano: veic.ano ? String(veic.ano) : "", tipo: veic.tipo, km_inicial: "" } : FORM_VAZIO));
  const [x, setX] = useState<Extra>(EXTRA_VAZIO);
  const [crlvArquivo, setCrlvArquivo] = useState<File | null>(null);
  const [planos, setPlanos] = useState<PlanoForm[]>(() => (veic?.planos ?? []).map((p) => ({ id: p.id, tipo: p.tipo, intervalo_km: String(p.intervalo_km), ultimo_km: String(p.ultimo_km) })));
  const [novoPlano, setNovoPlano] = useState<PlanoForm>({ tipo: "", intervalo_km: "", ultimo_km: "" });
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [aba, setAba] = useState<"dados" | "custos" | "documentos" | "manutencoes">("dados");
  const vid = veic?.id;

  // dados extras (não vêm no indicador): lidos da linha do veículo ao abrir
  useEffect(() => {
    if (!vid) return;
    void (async () => {
      const { data } = await supabase.from("erp_hub_frota_veiculo")
        .select("versao, cor, combustivel, cambio, potencia_cv, lugares, ncm, valor_aquisicao, data_entrada, fornecedor_nome, crlv_path, tem_manual, tem_chave_reserva")
        .eq("id", vid).maybeSingle();
      const r = data as Record<string, string | number | boolean | null> | null;
      if (!r) return;
      const s = (k: string) => (r[k] == null ? "" : String(r[k]));
      setX({
        versao: s("versao"), cor: s("cor"), combustivel: s("combustivel"), cambio: s("cambio"), potencia_cv: s("potencia_cv"),
        lugares: s("lugares"), ncm: s("ncm"), valor_aquisicao: s("valor_aquisicao"), data_entrada: s("data_entrada"),
        fornecedor_nome: s("fornecedor_nome"), crlv_path: s("crlv_path"), tem_manual: r.tem_manual === true, tem_chave_reserva: r.tem_chave_reserva === true,
      });
    })();
  }, [vid]);

  async function salvarVeiculo(crlv: string | null): Promise<string | null> {
    const { data, error } = await supabase.rpc("fn_hub_frota_veiculo_salvar", {
      p_company_id: companyId, p_id: veic?.id ?? null,
      p_dados: {
        placa: f.placa, modelo: f.modelo, marca: f.marca, ano: f.ano, tipo: f.tipo, km_inicial: f.km_inicial,
        chassi: f.chassi, renavam: f.renavam, observacao: f.observacao,
        ...x, valor_aquisicao: decimal(x.valor_aquisicao), crlv_path: crlv ?? x.crlv_path,
      },
    });
    if (error) { setErro(error.message); return null; }
    return data as string;
  }

  async function salvarTudo() {
    setErro(null); setMsg(null);
    let crlv: string | null = null;
    try {
      if (crlvArquivo) crlv = await enviarAnexo(companyId, veic ? `frota/${veic.id}` : "frota/cadastro", crlvArquivo);
    } catch (e) { setErro((e as Error).message); return; }
    const id = await salvarVeiculo(crlv);
    if (!id) return;
    const pendentes = [...planos, ...(novoPlano.tipo.trim() ? [novoPlano] : [])];
    for (const p of pendentes) {
      if (!p.tipo.trim() || !p.intervalo_km) continue;
      const { error } = await supabase.rpc("fn_hub_frota_manutencao_plano_salvar", {
        p_veiculo_id: id, p_tipo: p.tipo, p_intervalo_km: Number(p.intervalo_km),
        p_observacao: null, p_ultimo_km: p.ultimo_km ? Number(p.ultimo_km) : null, p_id: p.id ?? null,
      });
      if (error) { setErro(error.message); return; }
    }
    setMsg("Salvo.");
    setCrlvArquivo(null);
    setNovoPlano({ tipo: "", intervalo_km: "", ultimo_km: "" });
    onSalvo();
    if (!veic) onFechar();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onFechar}>
      <div className="h-full w-full max-w-xl overflow-y-auto p-5" style={{ background: BRANCO }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{veic ? `Veículo ${veic.placa}` : "Novo veículo"}</h2>
          <button onClick={onFechar} className="text-sm underline" style={{ color: TXM }}>Fechar</button>
        </div>

        {veic && (
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            {(["dados", "custos", "documentos", "manutencoes"] as const).map((a) => (
              <button key={a} onClick={() => setAba(a)} className="rounded-full px-3 py-1"
                style={{ background: aba === a ? ESP : BD, color: aba === a ? BRANCO : ESP }}>
                {({ dados: "Dados e plano", custos: "Custos", documentos: "Documentos", manutencoes: "Manutenções" })[a]}
              </button>
            ))}
          </div>
        )}

        {erro && <div role="alert" className="mt-3 rounded bg-red-50 p-2 text-sm text-red-700">{erro}</div>}
        {msg && <div className="mt-3 rounded bg-green-50 p-2 text-sm text-green-700">{msg}</div>}

        {aba === "dados" && (
          <div className="mt-4 space-y-4">
            <Secao titulo="Veículo">
              <Campo rotulo="Placa"><AjudaCampo chave="projetos.frota.placa" rota={ROTA} /><input aria-label="Placa" className={inp} value={f.placa} onChange={(e) => setF({ ...f, placa: e.target.value })} placeholder="DEM1A01" /></Campo>
              <Campo rotulo="Modelo"><AjudaCampo chave="projetos.frota.modelo" rota={ROTA} /><input aria-label="Modelo" className={inp} value={f.modelo} onChange={(e) => setF({ ...f, modelo: e.target.value })} /></Campo>
              <Campo rotulo="Marca"><AjudaCampo chave="projetos.frota.marca" rota={ROTA} /><input aria-label="Marca" className={inp} value={f.marca} onChange={(e) => setF({ ...f, marca: e.target.value })} /></Campo>
              <Campo rotulo="Ano"><AjudaCampo chave="projetos.frota.ano" rota={ROTA} /><input aria-label="Ano" inputMode="numeric" className={inp} value={f.ano} onChange={(e) => setF({ ...f, ano: e.target.value })} /></Campo>
              <Campo rotulo="Tipo"><AjudaCampo chave="projetos.frota.tipo" rota={ROTA} />
                <select aria-label="Tipo" className={inp} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
                  {TIPOS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
                </select>
              </Campo>
              {!veic && <Campo rotulo="Km inicial"><AjudaCampo chave="projetos.frota.km_inicial" rota={ROTA} /><input aria-label="Km inicial" inputMode="numeric" className={inp} value={f.km_inicial} onChange={(e) => setF({ ...f, km_inicial: e.target.value })} /></Campo>}
              <Campo rotulo="Chassi (opcional)"><AjudaCampo chave="projetos.frota.chassi" rota={ROTA} /><input aria-label="Chassi" className={inp} value={f.chassi} onChange={(e) => setF({ ...f, chassi: e.target.value })} /></Campo>
              <Campo rotulo="RENAVAM (opcional)"><AjudaCampo chave="projetos.frota.renavam" rota={ROTA} /><input aria-label="RENAVAM" className={inp} value={f.renavam} onChange={(e) => setF({ ...f, renavam: e.target.value })} /></Campo>
            </Secao>

            <details className="rounded-lg border p-3" style={{ borderColor: BD }}>
              <summary className="cursor-pointer text-sm font-semibold">Mais dados do veículo</summary>
              <div className="mt-3 space-y-4">
                <Secao titulo="Ficha técnica">
                  <Campo rotulo="Versão"><AjudaCampo chave="projetos.frota.versao" rota={ROTA} /><input aria-label="Versão" className={inp} value={x.versao} onChange={(e) => setX({ ...x, versao: e.target.value })} /></Campo>
                  <Campo rotulo="Cor"><AjudaCampo chave="projetos.frota.cor" rota={ROTA} /><input aria-label="Cor" className={inp} value={x.cor} onChange={(e) => setX({ ...x, cor: e.target.value })} /></Campo>
                  <Campo rotulo="Combustível"><AjudaCampo chave="projetos.frota.combustivel" rota={ROTA} />
                    <select aria-label="Combustível" className={inp} value={x.combustivel} onChange={(e) => setX({ ...x, combustivel: e.target.value })}>
                      <option value="">—</option>
                      {COMBUSTIVEIS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </Campo>
                  <Campo rotulo="Câmbio"><AjudaCampo chave="projetos.frota.cambio" rota={ROTA} />
                    <select aria-label="Câmbio" className={inp} value={x.cambio} onChange={(e) => setX({ ...x, cambio: e.target.value })}>
                      <option value="">—</option>
                      {CAMBIOS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </Campo>
                  <Campo rotulo="Potência (cv)"><AjudaCampo chave="projetos.frota.potencia" rota={ROTA} /><input aria-label="Potência (cv)" inputMode="numeric" className={inp} value={x.potencia_cv} onChange={(e) => setX({ ...x, potencia_cv: e.target.value })} /></Campo>
                  <Campo rotulo="Lugares"><AjudaCampo chave="projetos.frota.lugares" rota={ROTA} /><input aria-label="Lugares" inputMode="numeric" className={inp} value={x.lugares} onChange={(e) => setX({ ...x, lugares: e.target.value })} /></Campo>
                  <Campo rotulo="NCM"><AjudaCampo chave="projetos.frota.ncm" rota={ROTA} /><input aria-label="NCM" className={inp} value={x.ncm} onChange={(e) => setX({ ...x, ncm: e.target.value })} /></Campo>
                </Secao>
                <Secao titulo="Compra e entrada">
                  <Campo rotulo="Valor de aquisição"><AjudaCampo chave="projetos.frota.valor_aquisicao" rota={ROTA} /><input aria-label="Valor de aquisição" inputMode="decimal" className={inp} value={x.valor_aquisicao} onChange={(e) => setX({ ...x, valor_aquisicao: e.target.value })} /></Campo>
                  <Campo rotulo="Data de entrada na frota"><AjudaCampo chave="projetos.frota.data_entrada" rota={ROTA} /><input aria-label="Data de entrada na frota" type="date" className={inp} value={x.data_entrada} onChange={(e) => setX({ ...x, data_entrada: e.target.value })} /></Campo>
                  <Campo rotulo="Fornecedor do veículo"><AjudaCampo chave="projetos.frota.fornecedor_veiculo" rota={ROTA} /><input aria-label="Fornecedor do veículo" className={inp} value={x.fornecedor_nome} onChange={(e) => setX({ ...x, fornecedor_nome: e.target.value })} /></Campo>
                  <Campo rotulo="CRLV (arquivo)"><AjudaCampo chave="projetos.frota.crlv" rota={ROTA} />
                    <input aria-label="CRLV (arquivo)" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="text-xs" onChange={(e) => setCrlvArquivo(e.target.files?.[0] ?? null)} />
                    {x.crlv_path && !crlvArquivo && <button type="button" onClick={() => abrirAnexo(x.crlv_path)} className="mt-1 w-fit text-[11px] underline" style={{ color: ESP }}>Abrir CRLV anexado</button>}
                  </Campo>
                </Secao>
                <div className="flex flex-wrap gap-4 text-xs">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={x.tem_manual} onChange={(e) => setX({ ...x, tem_manual: e.target.checked })} />
                    <span>Tem manual</span>
                    <AjudaCampo chave="projetos.frota.manual" rota={ROTA} />
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={x.tem_chave_reserva} onChange={(e) => setX({ ...x, tem_chave_reserva: e.target.checked })} />
                    <span>Tem chave reserva</span>
                    <AjudaCampo chave="projetos.frota.chave_reserva" rota={ROTA} />
                  </label>
                </div>
              </div>
            </details>

            <Secao titulo="Plano preventivo (a cada quantos km)">
              {planos.map((p, i) => (
                <LinhaPlano key={p.id ?? i} p={p} onChange={(np) => setPlanos(planos.map((y, j) => (j === i ? np : y)))} />
              ))}
              <div className="rounded-lg border border-dashed p-3" style={{ borderColor: BD }}>
                <div className="mb-2 text-xs font-semibold" style={{ color: TXM }}>Adicionar manutenção</div>
                <LinhaPlano p={novoPlano} sugestoes onChange={setNovoPlano} />
              </div>
              {veic && <div className="text-[11px]" style={{ color: TXM }}>Quando você registra uma manutenção feita (aba Manutenções), o contador daquele tipo recomeça daquele km.</div>}
            </Secao>

            <div className="flex flex-wrap gap-2">
              <button onClick={salvarTudo} className="rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: ESP }}>Salvar</button>
              {veic && <ExcluirVeiculo id={veic.id} onFeito={() => { onSalvo(); onFechar(); }} />}
            </div>
          </div>
        )}

        {aba === "custos" && veic && <AbaCustos companyId={companyId} veiculo={veic} />}
        {aba === "documentos" && veic && <AbaDocumentos companyId={companyId} veiculo={veic} onFeito={onSalvo} />}
        {aba === "manutencoes" && veic && <AbaManutencoes companyId={companyId} veiculo={veic} />}
      </div>
    </div>
  );
}

const inp = "w-full rounded-lg border px-3 py-2 text-sm";

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{titulo}</h3>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

// O "?" (AjudaCampo) é filho explícito de cada Campo: o gate RD-95 confere o uso, não o componente.
function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block font-semibold" style={{ color: TXM }}>{rotulo}</span>
      {children}
    </label>
  );
}

function LinhaPlano({ p, onChange, sugestoes }: { p: PlanoForm; onChange: (p: PlanoForm) => void; sugestoes?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <Campo rotulo="Tipo de manutenção"><AjudaCampo chave="projetos.frota.tipo_manutencao" rota={ROTA} />
        <input aria-label="Tipo de manutenção" list={sugestoes ? "frota-tipos" : undefined} className={inp} value={p.tipo} onChange={(e) => onChange({ ...p, tipo: e.target.value })} />
        {sugestoes && <datalist id="frota-tipos">{SUGESTOES.map((s) => <option key={s} value={s} />)}</datalist>}
      </Campo>
      <Campo rotulo="A cada quantos km"><AjudaCampo chave="projetos.frota.intervalo_km" rota={ROTA} />
        <input aria-label="A cada quantos km" inputMode="numeric" className={inp} value={p.intervalo_km} onChange={(e) => onChange({ ...p, intervalo_km: e.target.value })} />
      </Campo>
      <Campo rotulo="Última vez (km)"><AjudaCampo chave="projetos.frota.ultimo_km" rota={ROTA} />
        <input aria-label="Última vez (km)" inputMode="numeric" className={inp} value={p.ultimo_km} onChange={(e) => onChange({ ...p, ultimo_km: e.target.value })} />
      </Campo>
    </div>
  );
}

function ExcluirVeiculo({ id, onFeito }: { id: string; onFeito: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  async function excluir() {
    const { error } = await supabase.rpc("fn_hub_frota_veiculo_excluir", { p_id: id, p_motivo: motivo });
    if (error) { setErro(error.message); return; }
    onFeito();
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1 text-xs">
        <input aria-label="Motivo da exclusão" placeholder="Motivo (ex.: vendido)" className="rounded-lg border px-2 py-2 text-sm" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        <AjudaCampo chave="projetos.frota.motivo_exclusao" rota={ROTA} />
      </label>
      <button onClick={excluir} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: COR.vermelho, color: COR.vermelho }}>Excluir veículo</button>
      {erro && <span role="alert" className="text-xs text-red-700">{erro}</span>}
    </div>
  );
}

function AbaCustos({ companyId, veiculo }: { companyId: string; veiculo: Veiculo }) {
  const [lista, setLista] = useState<Custo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [f, setF] = useState<CustoForm>(CUSTO_VAZIO);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from("erp_hub_frota_custo")
      .select("id, categoria, descricao, valor, fornecedor_nome, data_custo, documento, anexo_path, entra_base_fiscal")
      .eq("veiculo_id", veiculo.id).is("excluido_em", null).order("data_custo", { ascending: false });
    if (error) { setErro(error.message); return; }
    setLista((data ?? []) as Custo[]);
  }, [veiculo.id]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function registrar() {
    setErro(null); setEnviando(true);
    try {
      const anexo = arquivo ? await enviarAnexo(companyId, `frota/${veiculo.id}`, arquivo) : null;
      const { error } = await supabase.rpc("fn_hub_frota_custo_salvar", {
        p_company_id: companyId, p_id: null,
        p_dados: { veiculo_id: veiculo.id, ...f, valor: decimal(f.valor), anexo_path: anexo },
      });
      if (error) { setErro(error.message); return; }
      setF(CUSTO_VAZIO); setArquivo(null);
      void carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  async function excluir(id: string) {
    const motivo = window.prompt("Motivo da exclusão deste custo:");
    if (!motivo) return;
    const { error } = await supabase.rpc("fn_hub_frota_custo_excluir", { p_id: id, p_motivo: motivo });
    if (error) { setErro(error.message); return; }
    void carregar();
  }

  const total = lista.reduce((s, c) => s + Number(c.valor), 0);

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-xl border p-3" style={{ borderColor: BD }}>
        <div className="mb-2 text-sm font-semibold">Registrar custo</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Campo rotulo="Categoria"><AjudaCampo chave="projetos.frota.custo_categoria" rota={ROTA} />
            <select aria-label="Categoria" className={inp} value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })}>
              {CATEGORIAS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Valor"><AjudaCampo chave="projetos.frota.custo_valor" rota={ROTA} /><input aria-label="Valor do custo" inputMode="decimal" className={inp} value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} /></Campo>
          <Campo rotulo="Data"><AjudaCampo chave="projetos.frota.custo_data" rota={ROTA} /><input aria-label="Data do custo" type="date" className={inp} value={f.data_custo} onChange={(e) => setF({ ...f, data_custo: e.target.value })} /></Campo>
          <Campo rotulo="Descrição (opcional)"><AjudaCampo chave="projetos.frota.custo_descricao" rota={ROTA} /><input aria-label="Descrição do custo" className={inp} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></Campo>
          <Campo rotulo="Fornecedor (opcional)"><AjudaCampo chave="projetos.frota.custo_fornecedor" rota={ROTA} /><input aria-label="Fornecedor do custo" className={inp} value={f.fornecedor_nome} onChange={(e) => setF({ ...f, fornecedor_nome: e.target.value })} /></Campo>
          <Campo rotulo="Nota ou recibo (opcional)"><AjudaCampo chave="projetos.frota.custo_documento" rota={ROTA} /><input aria-label="Número da nota" className={inp} value={f.documento} onChange={(e) => setF({ ...f, documento: e.target.value })} /></Campo>
          <Campo rotulo="Anexo (nota ou comprovante)"><AjudaCampo chave="projetos.frota.custo_anexo" rota={ROTA} />
            <input aria-label="Anexo do custo" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="text-xs" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
          </Campo>
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs">
          <input type="checkbox" checked={f.entra_base_fiscal} onChange={(e) => setF({ ...f, entra_base_fiscal: e.target.checked })} />
          <span>Entra na base fiscal</span>
          <AjudaCampo chave="projetos.frota.custo_base_fiscal" rota={ROTA} />
        </label>
        {erro && <div role="alert" className="mt-2 text-xs text-red-700">{erro}</div>}
        <button onClick={registrar} disabled={enviando} className="mt-3 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: ESP }}>
          {enviando ? "Salvando…" : "Registrar custo"}
        </button>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between text-sm font-semibold">
          <span>Histórico de custos</span>
          <span data-testid="custos-total">Total {moeda(total)}</span>
        </div>
        {lista.length === 0 && <div className="text-xs" style={{ color: TXM }}>Nenhum custo registrado.</div>}
        <div className="space-y-2">
          {lista.map((c) => (
            <div key={c.id} className="flex items-start justify-between gap-2 rounded-lg border p-2 text-xs" style={{ borderColor: BD }}>
              <div>
                <div className="font-semibold">{CATEGORIAS.find(([v]) => v === c.categoria)?.[1] ?? c.categoria} · {dataBR(c.data_custo)} · {moeda(c.valor)}</div>
                <div style={{ color: TXM }}>
                  {[c.descricao, c.fornecedor_nome, c.documento ? `nº ${c.documento}` : null, c.entra_base_fiscal ? "base fiscal" : null].filter(Boolean).join(" · ") || "sem detalhes"}
                </div>
                {c.anexo_path && <button onClick={() => abrirAnexo(c.anexo_path as string)} className="mt-1 underline" style={{ color: ESP }}>Abrir anexo</button>}
              </div>
              <button onClick={() => excluir(c.id)} className="text-[11px] underline" style={{ color: TXM }}>Excluir</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AbaDocumentos({ companyId, veiculo, onFeito }: { companyId: string; veiculo: Veiculo; onFeito: () => void }) {
  const [f, setF] = useState<DocForm>(DOC_VAZIO);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function registrar() {
    setErro(null); setEnviando(true);
    try {
      if (!f.vencimento) { setErro("Informe o vencimento do documento."); return; }
      const anexo = arquivo ? await enviarAnexo(companyId, `frota/${veiculo.id}`, arquivo) : null;
      const { error } = await supabase.rpc("fn_hub_frota_documento_salvar", {
        p_company_id: companyId, p_id: null,
        p_dados: { veiculo_id: veiculo.id, tipo: f.tipo, vencimento: f.vencimento, valor: decimal(f.valor), anexo_path: anexo },
      });
      if (error) { setErro(error.message); return; }
      setF(DOC_VAZIO); setArquivo(null);
      onFeito();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-xl border p-3" style={{ borderColor: BD }}>
        <div className="mb-2 text-sm font-semibold">Registrar documento com vencimento</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Campo rotulo="Tipo"><AjudaCampo chave="projetos.frota.doc_tipo" rota={ROTA} />
            <select aria-label="Tipo do documento" className={inp} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
              {TIPOS_DOC.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Vencimento"><AjudaCampo chave="projetos.frota.doc_vencimento" rota={ROTA} /><input aria-label="Vencimento" type="date" className={inp} value={f.vencimento} onChange={(e) => setF({ ...f, vencimento: e.target.value })} /></Campo>
          <Campo rotulo="Valor (opcional)"><AjudaCampo chave="projetos.frota.doc_valor" rota={ROTA} /><input aria-label="Valor do documento" inputMode="decimal" className={inp} value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} /></Campo>
          <Campo rotulo="Anexo do documento"><AjudaCampo chave="projetos.frota.doc_anexo" rota={ROTA} />
            <input aria-label="Anexo do documento" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="text-xs" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
          </Campo>
        </div>
        {erro && <div role="alert" className="mt-2 text-xs text-red-700">{erro}</div>}
        <button onClick={registrar} disabled={enviando} className="mt-3 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: ESP }}>
          {enviando ? "Salvando…" : "Registrar documento"}
        </button>
      </div>

      <div>
        <div className="mb-2 text-sm font-semibold">Documentos</div>
        {veiculo.documentos.length === 0 && <div className="text-xs" style={{ color: TXM }}>Nenhum documento com vencimento.</div>}
        <div className="space-y-2">
          {veiculo.documentos.map((d) => (
            <LinhaDoc key={d.id} d={d} onFeito={onFeito} />
          ))}
        </div>
      </div>
    </div>
  );
}

function LinhaDoc({ d, onFeito }: { d: Doc; onFeito: () => void }) {
  const [renovando, setRenovando] = useState(false);
  const [novo, setNovo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const rotuloTipo = TIPOS_DOC.find(([v]) => v === d.tipo)?.[1] ?? d.tipo;

  async function renovar() {
    setErro(null);
    if (!novo) { setErro("Informe o novo vencimento."); return; }
    const { error } = await supabase.rpc("fn_hub_frota_documento_renovar", { p_id: d.id, p_vencimento: novo, p_valor: null, p_anexo: null });
    if (error) { setErro(error.message); return; }
    setRenovando(false); setNovo("");
    onFeito();
  }

  async function excluir() {
    const motivo = window.prompt("Motivo da exclusão deste documento:");
    if (!motivo) return;
    const { error } = await supabase.rpc("fn_hub_frota_documento_excluir", { p_id: d.id, p_motivo: motivo });
    if (error) { setErro(error.message); return; }
    onFeito();
  }

  return (
    <div className="rounded-lg border p-2 text-xs" style={{ borderColor: BD, background: FUNDO[d.status] }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">{rotuloTipo} · vence {dataBR(d.vencimento)}</div>
          <div style={{ color: COR[d.status] }}>
            {d.dias < 0 ? `vencido há ${Math.abs(d.dias)} dia(s)` : `faltam ${d.dias} dia(s)`}
            {d.valor != null ? ` · ${moeda(d.valor)}` : ""}
          </div>
          {d.anexo_path && <button onClick={() => abrirAnexo(d.anexo_path as string)} className="mt-1 underline" style={{ color: ESP }}>Abrir anexo</button>}
        </div>
        <div className="flex flex-col items-end gap-1">
          <button onClick={() => setRenovando((x) => !x)} className="underline" style={{ color: ESP }}>Renovar</button>
          <button onClick={excluir} className="underline" style={{ color: TXM }}>Excluir</button>
        </div>
      </div>
      {renovando && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1">
            <input aria-label="Novo vencimento" type="date" className="rounded-lg border px-2 py-1 text-xs" value={novo} onChange={(e) => setNovo(e.target.value)} />
            <AjudaCampo chave="projetos.frota.doc_renovar" rota={ROTA} />
          </label>
          <button onClick={renovar} className="rounded-lg px-3 py-1 text-xs font-semibold text-white" style={{ background: ESP }}>Confirmar renovação</button>
        </div>
      )}
      {erro && <div role="alert" className="mt-1 text-red-700">{erro}</div>}
    </div>
  );
}

function AbaManutencoes({ companyId, veiculo }: { companyId: string; veiculo: Veiculo }) {
  const [lista, setLista] = useState<Registro[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [r, setR] = useState({ tipo: veiculo.planos[0]?.tipo ?? "", data: "", km: "", valor: "", fornecedor: "", descricao: "" });
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(async () => {
    const { data } = await supabase.from("erp_hub_frota_manutencao_registro")
      .select("id, tipo, data, km_na_manutencao, valor, fornecedor, descricao, anexo_path")
      .eq("veiculo_id", veiculo.id).is("excluido_em", null).order("data", { ascending: false });
    setLista((data ?? []) as Registro[]);
  }, [veiculo.id]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function registrar() {
    setErro(null); setEnviando(true);
    try {
      const anexo = arquivo ? await enviarAnexo(companyId, `frota/${veiculo.id}`, arquivo) : null;
      const { error } = await supabase.rpc("fn_hub_frota_manutencao_registrar", { p_veiculo_id: veiculo.id, p_dados: { ...r, anexo_path: anexo } });
      if (error) { setErro(error.message); return; }
      setR({ ...r, data: "", km: "", valor: "", fornecedor: "", descricao: "" });
      setArquivo(null);
      void carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível registrar a manutenção.");
    } finally {
      setEnviando(false);
    }
  }

  async function excluir(id: string) {
    const motivo = window.prompt("Motivo da exclusão desta manutenção:");
    if (!motivo) return;
    const { error } = await supabase.rpc("fn_hub_frota_manutencao_excluir", { p_registro_id: id, p_motivo: motivo });
    if (error) { setErro(error.message); return; }
    void carregar();
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-xl border p-3" style={{ borderColor: BD }}>
        <div className="mb-2 text-sm font-semibold">Registrar manutenção feita</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Campo rotulo="Tipo"><AjudaCampo chave="projetos.frota.tipo_manutencao" rota={ROTA} /><input aria-label="Tipo da manutenção" className={inp} value={r.tipo} onChange={(e) => setR({ ...r, tipo: e.target.value })} /></Campo>
          <Campo rotulo="Data"><AjudaCampo chave="projetos.frota.data_manutencao" rota={ROTA} /><input aria-label="Data" type="date" className={inp} value={r.data} onChange={(e) => setR({ ...r, data: e.target.value })} /></Campo>
          <Campo rotulo="Km na manutenção"><AjudaCampo chave="projetos.frota.km_manutencao" rota={ROTA} /><input aria-label="Km na manutenção" inputMode="numeric" className={inp} value={r.km} onChange={(e) => setR({ ...r, km: e.target.value })} /></Campo>
          <Campo rotulo="Valor (opcional)"><AjudaCampo chave="projetos.frota.valor" rota={ROTA} /><input aria-label="Valor" inputMode="decimal" className={inp} value={r.valor} onChange={(e) => setR({ ...r, valor: e.target.value })} /></Campo>
          <Campo rotulo="Fornecedor (opcional)"><AjudaCampo chave="projetos.frota.fornecedor" rota={ROTA} /><input aria-label="Fornecedor" className={inp} value={r.fornecedor} onChange={(e) => setR({ ...r, fornecedor: e.target.value })} /></Campo>
          <Campo rotulo="Descrição (opcional)"><AjudaCampo chave="projetos.frota.descricao" rota={ROTA} /><input aria-label="Descrição" className={inp} value={r.descricao} onChange={(e) => setR({ ...r, descricao: e.target.value })} /></Campo>
          <Campo rotulo="Anexo (nota ou laudo)"><AjudaCampo chave="projetos.frota.manutencao_anexo" rota={ROTA} />
            <input aria-label="Anexo da manutenção" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="text-xs" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
          </Campo>
        </div>
        {erro && <div role="alert" className="mt-2 text-xs text-red-700">{erro}</div>}
        <button onClick={registrar} disabled={enviando} className="mt-3 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: ESP }}>{enviando ? "Salvando…" : "Registrar"}</button>
      </div>

      <div>
        <div className="mb-2 text-sm font-semibold">Histórico</div>
        {lista.length === 0 && <div className="text-xs" style={{ color: TXM }}>Nenhuma manutenção registrada.</div>}
        <div className="space-y-2">
          {lista.map((x) => (
            <div key={x.id} className="flex items-start justify-between gap-2 rounded-lg border p-2 text-xs" style={{ borderColor: BD }}>
              <div>
                <div className="font-semibold">{x.tipo} · {x.data.split("-").reverse().join("/")}</div>
                <div style={{ color: TXM }}>{num(x.km_na_manutencao)} km{x.fornecedor ? ` · ${x.fornecedor}` : ""}{x.valor != null ? ` · R$ ${Number(x.valor).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : ""}</div>
                {x.anexo_path && <button onClick={() => abrirAnexo(x.anexo_path as string)} className="mt-1 underline" style={{ color: ESP }}>Abrir anexo</button>}
              </div>
              <button onClick={() => excluir(x.id)} className="text-[11px] underline" style={{ color: TXM }}>Excluir</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
