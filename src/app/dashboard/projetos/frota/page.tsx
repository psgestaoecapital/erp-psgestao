// src/app/dashboard/projetos/frota/page.tsx
// Hub · Controle de frota (chamado #5166, FC/FCR). Uma tela só (RD-99): cards da frota com os alertas de manutenção,
// cadastro do veículo com o plano preventivo (a cada quantos km) na mesma tela, e dentro do veículo a aba de
// manutenções (registrar, histórico, excluir). Km e consumo vêm das VIAGENS (RPC fn_hub_frota_indicadores);
// esta tela não digita km nem litros. Semáforo (verde/amarelo/vermelho) calculado no banco.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useCompanyIds } from "@/lib/useCompanyIds";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";

const ROTA = "/dashboard/projetos/frota";
const ESP = "#3D2314", BRANCO = "#FFFFFF", BD = "#E7DED3", TXM = "#6B5D4F", BG = "#F7F3EC";
const COR = { vermelho: "#B91C1C", amarelo: "#B45309", verde: "#166534", sem_plano: "#8A7D6E" } as const;
const FUNDO = { vermelho: "#FEE2E2", amarelo: "#FEF3C7", verde: "#DCFCE7", sem_plano: "#EFEAE2" } as const;
const ROTULO = { vermelho: "Vencida", amarelo: "Perto", verde: "Em dia", sem_plano: "Sem plano" } as const;
const TIPOS = [["carro", "Carro"], ["caminhonete", "Caminhonete"], ["caminhao", "Caminhão"], ["moto", "Moto"]] as const;
const SUGESTOES = ["Troca de óleo", "Pneus", "Revisão", "Freios", "Correia", "Filtros"];

type Plano = { id: string; tipo: string; intervalo_km: number; ultimo_km: number; proxima_km: number; km_para_proxima: number; status: "verde" | "amarelo" | "vermelho" };
type Veiculo = {
  id: string; placa: string; modelo: string | null; marca: string | null; ano: number | null; tipo: string;
  km_atual: number; km_percorrido: number; litros: number; consumo_km_l: number | null;
  status_geral: keyof typeof COR; vencidos: number; amarelos: number; planos: Plano[];
};
type Resumo = { total_veiculos: number; veiculos_vencidos: number; consumo_medio_frota: number | null };
type Registro = { id: string; tipo: string; data: string; km_na_manutencao: number; valor: number | null; fornecedor: string | null; descricao: string | null };
type Form = { placa: string; modelo: string; marca: string; ano: string; tipo: string; km_inicial: string; chassi: string; renavam: string; observacao: string };
type PlanoForm = { id?: string; tipo: string; intervalo_km: string; ultimo_km: string };
const FORM_VAZIO: Form = { placa: "", modelo: "", marca: "", ano: "", tipo: "carro", km_inicial: "", chassi: "", renavam: "", observacao: "" };
const num = (n: number | null | undefined) => (n == null ? "—" : Math.round(Number(n)).toLocaleString("pt-BR"));
const kmL = (n: number | null) => (n == null ? "—" : `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km/l`);

export default function FrotaPage() {
  const { sel, companies } = useCompanyIds();
  const companyId = sel && !sel.startsWith("group_") && sel !== "consolidado" ? sel : null;
  const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [excluidos, setExcluidos] = useState<{ id: string; placa: string; modelo: string | null; excluido_em: string }[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | "novo" | null>(null);
  const [mostrarExcluidos, setMostrarExcluidos] = useState(false);

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
        <button data-testid="frota-novo-veiculo" onClick={() => setAberto("novo")}
          className="rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: ESP }}>
          + Novo veículo
        </button>
      </div>

      {erro && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</div>}

      {/* indicadores do topo */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Indicador titulo="Veículos" valor={resumo?.total_veiculos ?? 0} chave="projetos.frota.placa" />
        <Indicador titulo="Manutenção vencida" valor={resumo?.veiculos_vencidos ?? 0} cor={COR.vermelho} chave="projetos.frota.alerta" />
        <Indicador titulo="Consumo médio da frota" valor={kmL(resumo?.consumo_medio_frota ?? null)} chave="projetos.frota.consumo" />
        <Indicador titulo="Excluídos" valor={excluidos.length} chave="projetos.frota.placa" />
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
            style={{ borderColor: v.status_geral === "vermelho" ? COR.vermelho : BD, background: BRANCO }}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-mono text-base font-bold">{v.placa}</div>
                <div className="text-xs" style={{ color: TXM }}>{[v.marca, v.modelo].filter(Boolean).join(" ") || "sem modelo"}</div>
              </div>
              <span className="rounded px-2 py-0.5 text-[11px] font-semibold" style={{ background: FUNDO[v.status_geral], color: COR[v.status_geral] }}>
                {ROTULO[v.status_geral]}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div><span style={{ color: TXM }}>Km atual</span><div className="font-semibold">{num(v.km_atual)}</div></div>
              <div><span style={{ color: TXM }}>Consumo</span><div className="font-semibold">{kmL(v.consumo_km_l)}</div></div>
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
  const [planos, setPlanos] = useState<PlanoForm[]>(() => (veic?.planos ?? []).map((p) => ({ id: p.id, tipo: p.tipo, intervalo_km: String(p.intervalo_km), ultimo_km: String(p.ultimo_km) })));
  const [novoPlano, setNovoPlano] = useState<PlanoForm>({ tipo: "", intervalo_km: "", ultimo_km: "" });
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [aba, setAba] = useState<"dados" | "manutencoes">("dados");

  async function salvarVeiculo(): Promise<string | null> {
    const { data, error } = await supabase.rpc("fn_hub_frota_veiculo_salvar", {
      p_company_id: companyId, p_id: veic?.id ?? null,
      p_dados: { placa: f.placa, modelo: f.modelo, marca: f.marca, ano: f.ano, tipo: f.tipo, km_inicial: f.km_inicial, chassi: f.chassi, renavam: f.renavam, observacao: f.observacao },
    });
    if (error) { setErro(error.message); return null; }
    return data as string;
  }

  async function salvarTudo() {
    setErro(null); setMsg(null);
    const id = await salvarVeiculo();
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
          <div className="mt-3 flex gap-2 text-sm">
            {(["dados", "manutencoes"] as const).map((a) => (
              <button key={a} onClick={() => setAba(a)} className="rounded-full px-3 py-1"
                style={{ background: aba === a ? ESP : BD, color: aba === a ? BRANCO : ESP }}>
                {a === "dados" ? "Dados e plano" : "Manutenções"}
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

            <Secao titulo="Plano preventivo (a cada quantos km)">
              {planos.map((p, i) => (
                <LinhaPlano key={p.id ?? i} p={p} onChange={(np) => setPlanos(planos.map((x, j) => (j === i ? np : x)))} />
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

        {aba === "manutencoes" && veic && <AbaManutencoes veiculo={veic} />}
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

function AbaManutencoes({ veiculo }: { veiculo: Veiculo }) {
  const [lista, setLista] = useState<Registro[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [r, setR] = useState({ tipo: veiculo.planos[0]?.tipo ?? "", data: "", km: "", valor: "", fornecedor: "", descricao: "" });

  const carregar = useCallback(async () => {
    const { data } = await supabase.from("erp_hub_frota_manutencao_registro")
      .select("id, tipo, data, km_na_manutencao, valor, fornecedor, descricao")
      .eq("veiculo_id", veiculo.id).is("excluido_em", null).order("data", { ascending: false });
    setLista((data ?? []) as Registro[]);
  }, [veiculo.id]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function registrar() {
    setErro(null);
    const { error } = await supabase.rpc("fn_hub_frota_manutencao_registrar", { p_veiculo_id: veiculo.id, p_dados: r });
    if (error) { setErro(error.message); return; }
    setR({ ...r, data: "", km: "", valor: "", fornecedor: "", descricao: "" });
    void carregar();
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
        </div>
        {erro && <div role="alert" className="mt-2 text-xs text-red-700">{erro}</div>}
        <button onClick={registrar} className="mt-3 rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: ESP }}>Registrar</button>
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
              </div>
              <button onClick={() => excluir(x.id)} className="text-[11px] underline" style={{ color: TXM }}>Excluir</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
