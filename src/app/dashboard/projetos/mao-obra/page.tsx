// src/app/dashboard/projetos/mao-obra/page.tsx
// Hub · Mão de obra (SPEC Hub E1+E2 rev. 15, seção 5 · recorte H1+H3). Genérico para qualquer empresa.
// Abas: Funções (média do GRUPO ponderada por horas, só fichas conferidas) · Equipe (por pessoa no cadastro
// compartilhado OU perfil padrão sem nome) · Lista atual (o catálogo antigo, até a migração com OK do CEO).
// LGPD: salário e custo individual só para gestor/financeiro da empresa que emprega — o banco já devolve mascarado.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, FileUp, HardHat, Plus, Users, UserPlus, Link2, History, Lock, CheckCircle2, AlertTriangle, X } from "lucide-react";
import { useCompanyIds } from "@/lib/useCompanyIds";
import { supabase } from "@/lib/supabase";
import ImportarMaoObraModal from "@/components/projetos/ImportarMaoObraModal";
import MaoObraCatalogoLegado from "@/components/projetos/MaoObraCatalogoLegado";
import {
  calcularCustoMaoObra, chavesPadrao, encargosFolhaPct, fatorFolhaReoneracao, meiServicoObraPadrao, rpaInssPadrao, temComponenteComValor, valorMesComponente,
  TIPOS_COMPONENTE, VINCULOS, type ChavesIncidencia, type Componente, type Encargos, type FichaCusto, type FormaPagamento, type PadroesFicha, type TipoComponente, type Vinculo,
} from "@/lib/hub/custoMaoObra";
import { cpfValido, mascaraCpf } from "@/lib/documentos/cpf";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";

type CustoFuncao = { custo_hora: number | null; custo_m2: number | null; custo_unidade?: number | null; unidade?: string | null; origem: "media_grupo" | "manual" | "sem_dado"; pessoas_conferidas: number; empresas: number; nao_conferidas: number };
type Funcao = { id: string; nome: string; cbo: string | null; forma_pagamento: string; unidade_producao?: string | null; custo_hora_manual: number | null; unida_a_id: string | null; unida_a_nome: string | null; ativo: boolean; migrada_de: string | null; custo: CustoFuncao | null;
  salario_sugerido?: { valor: number; origem: "media_conferida" | "estimado_custo_hora"; pessoas: number } | null };
type ItemEquipe = {
  id: string; grupo_id: string; tipo: "pessoa" | "perfil"; funcionario_id: string | null; nome: string; funcao_id: string; funcao: string;
  vinculo: string; forma_pagamento: string; setor: string | null; quantidade_pessoas: number; horas_produtivas_mes: number;
  vigencia_inicio: string; conferido: boolean; ativo: boolean; matricula: string | null; ajuste_por_nome?: string | null; chaves_confirmadas?: boolean;
  ficha: (Partial<FichaCusto> & Record<string, unknown>) | null; custo: { custo_mensal: number | null; custo_hora: number | null; custo_m2: number | null; custo_unidade?: number | null; unidade?: string | null; alertas?: string[] } | null;
};
type Lista = { pode_ver_individual: boolean; encargos: Encargos & { fonte: string; vigencia_inicio: string | null }; funcoes: Funcao[]; equipe: ItemEquipe[] };

const brl = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`);
const numBR = (s: string) => { const n = Number(String(s ?? "").replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0 };
const FORMAS = [{ v: "mensal", l: "Mensal" }, { v: "hora", l: "Por hora" }, { v: "producao", l: "Por produção (m², metro, ponto, peça…)" }, { v: "diaria", l: "Por diária" }];
const rotVinculo = (v: string) => VINCULOS.find((x) => x.v === v)?.rotulo ?? v;
const rotForma = (f: string, u?: string | null) => (f === "m2" ? "m²" : f === "producao" ? `produção${u ? ` (${u === "m2" ? "m²" : u})` : ""}` : f);

const inp = "w-full border border-[#3D2314]/15 rounded-md px-2 py-1.5 text-[13px] text-[#3D2314] bg-white";
const btnPri = "px-3 py-2 rounded-md bg-[#C8941A] text-[#3D2314] font-medium text-[13px] hover:bg-[#B07F12] disabled:opacity-50 inline-flex items-center gap-1.5";
const btnSec = "px-3 py-2 rounded-md border border-[#3D2314]/15 text-[13px] text-[#3D2314] hover:bg-[#3D2314]/5 disabled:opacity-50 inline-flex items-center gap-1.5";

export default function MaoObraPage() {
  const { sel, companies } = useCompanyIds();
  const companyId = sel && !sel.startsWith("group_") && sel !== "consolidado" ? sel : null;
  const empresa = companies.find((c) => c.id === companyId);
  const [aba, setAba] = useState<"funcoes" | "equipe" | "lista">("equipe");
  const [dados, setDados] = useState<Lista | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [modal, setModal] = useState<null | { tipo: "funcao"; f?: Funcao } | { tipo: "ficha"; modo: "pessoa" | "perfil" | "editar"; item?: ItemEquipe } | { tipo: "encerrar"; item: ItemEquipe } | { tipo: "encargos" } | { tipo: "historico"; item: ItemEquipe } | { tipo: "unir"; f: Funcao } | { tipo: "importar" }>(null);

  const carregar = useCallback(async () => {
    if (!companyId) return;
    setErro(null);
    const { data, error } = await supabase.rpc("fn_mao_obra_listar", { p_company_id: companyId });
    if (error) { setErro(error.message); return; }
    setDados(data as Lista);
  }, [companyId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial vinda do banco
  useEffect(() => { void carregar(); }, [carregar]);

  const pode = !!dados?.pode_ver_individual;
  const funcoesAtivas = useMemo(() => (dados?.funcoes ?? []).filter((f) => f.ativo), [dados]);

  async function rpc(fn: string, args: Record<string, unknown>, ok: string) {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) { setErro(error.message); return false; }
    const r = data as { ok?: boolean; erro?: string } | null;
    if (r && r.ok === false) { setErro(r.erro ?? "Não foi possível salvar."); return false; }
    setAviso(ok); setErro(null); await carregar(); return true;
  }

  async function baixarModelo() {
    const { gerarModeloMaoObra } = await import("@/lib/hub/planilhaMaoObra");
    const url = URL.createObjectURL(await gerarModeloMaoObra());
    const a = document.createElement("a"); a.href = url; a.download = "MODELO_mao_de_obra_PS.xlsx"; a.click(); URL.revokeObjectURL(url);
  }

  if (!companyId) {
    return <div className="p-6 text-[13px] text-[#3D2314]/70">Escolha uma empresa no seletor para ver a mão de obra.</div>;
  }
  const enc = dados?.encargos;

  return (
    <div className="p-4 md:p-6 space-y-4 text-[#3D2314]" data-testid="mao-obra-page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium flex items-center gap-2"><HardHat size={22} /> Mão de obra</h1>
          <p className="text-sm text-[#3D2314]/60">{empresa?.nome_fantasia ?? ""} · custo da hora de cada função, a partir da equipe conferida (média do grupo de empresas).</p>
        </div>
        {pode && (
          <div className="flex flex-wrap gap-2">
            <button className={btnSec} onClick={() => void baixarModelo()} data-testid="mao-obra-baixar-modelo"><Download size={14} /> Baixar modelo</button>
            <button className={btnSec} onClick={() => setModal({ tipo: "importar" })} data-testid="mao-obra-importar"><FileUp size={14} /> Importar planilha</button>
            <button className={btnSec} onClick={() => setModal({ tipo: "funcao" })} data-testid="mao-obra-nova-funcao"><Plus size={14} /> Nova função</button>
            <button className={btnSec} onClick={() => setModal({ tipo: "ficha", modo: "perfil" })} data-testid="mao-obra-novo-perfil"><Users size={14} /> Novo perfil padrão</button>
            <button className={btnPri} onClick={() => setModal({ tipo: "ficha", modo: "pessoa" })} data-testid="mao-obra-novo-funcionario"><UserPlus size={14} /> Novo funcionário</button>
          </div>
        )}
      </header>

      {enc && (
        <div className={`rounded-md border px-3 py-2 text-[12.5px] flex flex-wrap items-center justify-between gap-2 ${enc.provisorio ? "border-[#C8941A]/60 bg-[#FAEEDA]/60" : "border-[#3D2314]/15 bg-[#FAF7F2]"}`} data-testid="mao-obra-encargos">
          <span>
            {enc.provisorio ? <><AlertTriangle size={13} className="inline -mt-0.5 mr-1" /><b>Encargos provisórios</b> — até o contador confirmar. </> : <><CheckCircle2 size={13} className="inline -mt-0.5 mr-1" />Encargos confirmados pelo contador. </>}
            Regime {enc.regime}{enc.simples_anexo ? ` (Anexo ${enc.simples_anexo})` : ""} · encargos da folha <b>{pct(enc.encargos_folha_pct)}</b>
            {enc.desoneracao ? ` · desoneração: ${pct(Number(enc.desoneracao_fator_folha) * 100)} do INSS patronal na folha${enc.cprb_pct ? `, CPRB ${pct(enc.cprb_pct)} sobre a receita` : ""}` : ""}
            {" "}· 13º {pct(enc.prov_13_pct)} · férias {pct(enc.prov_ferias_pct)} · rescisão {pct(enc.prov_rescisao_pct)}
          </span>
          {pode && <button className={btnSec} onClick={() => setModal({ tipo: "encargos" })} data-testid="mao-obra-encargos-editar">Configurar padrões</button>}
        </div>
      )}
      {!pode && dados && (
        <div className="rounded-md border border-[#3D2314]/15 bg-[#FAF7F2] px-3 py-2 text-[12.5px] flex items-center gap-1.5" data-testid="mao-obra-lgpd">
          <Lock size={13} /> Salário e custo de cada pessoa só aparecem para gestor e financeiro da empresa. Aqui você vê a média de cada função.
        </div>
      )}
      {pode && dados && (
        <div className="text-[11.5px] text-[#3D2314]/60 flex items-center gap-1.5" data-testid="mao-obra-lgpd-log">
          <Lock size={12} /> Você vê salário e custo de cada pessoa desta empresa. Cada abertura fica registrada (quem, quando, qual ficha).
        </div>
      )}
      {erro && <div className="rounded-md bg-[#F7E1E1] text-[#791F1F] px-3 py-2 text-[12.5px]" data-testid="mao-obra-erro">{erro}</div>}
      {aviso && !erro && <div className="rounded-md bg-[#E5F2E1] text-[#2F5A1F] px-3 py-2 text-[12.5px]" data-testid="mao-obra-aviso">{aviso}</div>}

      <nav className="flex gap-1 border-b border-[#3D2314]/10">
        {([["equipe", "Equipe"], ["funcoes", "Funções"], ["lista", "Lista atual (até a migração)"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setAba(k)} data-testid={`mao-obra-aba-${k}`}
            className={`px-3 py-2 text-[13px] -mb-px border-b-2 ${aba === k ? "border-[#C8941A] font-medium" : "border-transparent text-[#3D2314]/60"}`}>{l}</button>
        ))}
      </nav>

      {aba === "equipe" && dados && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]" data-testid="mao-obra-equipe">
            <thead><tr className="text-left text-[#3D2314]/60 border-b border-[#3D2314]/10">
              <th className="py-2 pr-2">Nome</th><th className="pr-2">Função</th><th className="pr-2">Vínculo</th><th className="pr-2 text-right">Horas/mês</th>
              <th className="pr-2 text-right">Custo mensal</th><th className="pr-2 text-right">Custo da hora</th><th className="pr-2 text-right">Por unidade</th><th className="pr-2">Situação<AjudaCampo chave="projetos.mao_obra.equipe.conferido" /></th><th></th>
            </tr></thead>
            <tbody>
              {dados.equipe.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-[#3D2314]/60">Ninguém cadastrado ainda. Use “Novo funcionário” ou “Novo perfil padrão”{dados.funcoes.length === 0 ? " (antes, cadastre as funções na aba Funções)" : ""}.</td></tr>}
              {dados.equipe.map((i) => (
                <tr key={i.id} className="border-b border-[#3D2314]/5" data-testid={`mao-obra-linha-${i.grupo_id}`}>
                  <td className="py-2 pr-2">{i.nome}{i.tipo === "perfil" && <span className="ml-1 text-[11px] text-[#3D2314]/60">· perfil × {i.quantidade_pessoas}</span>}</td>
                  <td className="pr-2">{i.funcao}</td>
                  <td className="pr-2 text-[11.5px]">{rotVinculo(i.vinculo)}{i.custo?.alertas?.includes("diarista_mais_8_dias") && <span className="ml-1 text-[#791F1F]" title="Diarista com mais de 8 dias no mês: risco trabalhista" data-testid="mao-obra-alerta-diarista">⚠</span>}</td>
                  <td className="pr-2 text-right tabular-nums">{i.horas_produtivas_mes}</td>
                  <td className="pr-2 text-right tabular-nums" data-testid="mao-obra-custo-mensal">{pode ? brl(i.custo?.custo_mensal) : <Lock size={12} className="inline" />}</td>
                  <td className="pr-2 text-right tabular-nums" data-testid="mao-obra-custo-hora">{pode ? brl(i.custo?.custo_hora) : <Lock size={12} className="inline" />}</td>
                  <td className="pr-2 text-right tabular-nums" data-testid="mao-obra-custo-unidade">{pode ? (i.custo?.custo_unidade != null ? `${brl(i.custo.custo_unidade)}/${i.custo.unidade === "m2" ? "m²" : i.custo.unidade ?? "un."}` : "—") : <Lock size={12} className="inline" />}</td>
                  <td className="pr-2">
                    {i.conferido
                      ? <span className="text-[#2F5A1F]" data-testid="mao-obra-conferido">✓ Conferido</span>
                      : <span className="text-[#8A5A00]" data-testid="mao-obra-nao-conferido">Não conferido · fora do custo</span>}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {pode && (
                      <>
                        {!i.conferido && <button className="text-[12px] underline mr-2" data-testid="mao-obra-conferir" onClick={() => void rpc("fn_mao_obra_ficha_conferir", { p_ficha_id: i.id, p_conferido: true }, `${i.nome}: conferido — entra no custo da função.`)}>Conferir</button>}
                        <button className="text-[12px] underline mr-2" data-testid="mao-obra-editar" onClick={() => setModal({ tipo: "ficha", modo: "editar", item: i })}>Editar / reajuste</button>
                        <button className="text-[12px] underline mr-2" onClick={() => setModal({ tipo: "historico", item: i })}><History size={12} className="inline" /> Histórico</button>
                        <button className="text-[12px] underline text-[#791F1F]" data-testid="mao-obra-encerrar" onClick={() => setModal({ tipo: "encerrar", item: i })}>{i.tipo === "pessoa" ? "Desligar" : "Inativar"}</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {aba === "funcoes" && dados && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]" data-testid="mao-obra-funcoes">
            <thead><tr className="text-left text-[#3D2314]/60 border-b border-[#3D2314]/10">
              <th className="py-2 pr-2">Função</th><th className="pr-2">CBO</th><th className="pr-2">Pagamento</th><th className="pr-2 text-right">Custo da hora</th><th className="pr-2 text-right">Por unidade</th>
              <th className="pr-2">Origem</th><th className="pr-2 text-right">Pessoas conferidas</th><th className="pr-2 text-right">Não conferidas</th><th></th>
            </tr></thead>
            <tbody>
              {dados.funcoes.length === 0 && (
                <tr><td colSpan={9} className="py-6 text-center text-[#3D2314]/60" data-testid="mao-obra-funcoes-vazia">
                  Nenhuma função ainda. Use “Nova função”{pode ? " ou comece pelas funções-modelo de obra (só os nomes e a forma de pagamento — sem custo inventado; você ajusta depois)." : "."}
                  {pode && <div className="mt-2"><button className={btnPri} data-testid="mao-obra-funcoes-modelo" onClick={() => void rpc("fn_mao_obra_funcoes_modelo", { p_company_id: companyId }, "Funções-modelo criadas — ajuste nomes e forma de pagamento se precisar.")}>Usar funções-modelo</button><AjudaCampo chave="projetos.mao_obra.funcao.modelo" /></div>}
                </td></tr>
              )}
              {dados.funcoes.map((f) => (
                <tr key={f.id} className={`border-b border-[#3D2314]/5 ${f.ativo ? "" : "opacity-50"}`} data-testid={`mao-obra-funcao-${f.id}`}>
                  <td className="py-2 pr-2">{f.nome}{f.unida_a_nome && <span className="ml-1 text-[11px] text-[#3D2314]/60">· unida a {f.unida_a_nome}</span>}</td>
                  <td className="pr-2">{f.cbo ?? "—"}</td>
                  <td className="pr-2">{rotForma(f.forma_pagamento, f.unidade_producao)}</td>
                  <td className="pr-2 text-right tabular-nums" data-testid="mao-obra-funcao-custo">{brl(f.custo?.custo_hora)}</td>
                  <td className="pr-2 text-right tabular-nums" data-testid="mao-obra-funcao-custo-unidade">{f.custo?.custo_unidade != null ? `${brl(f.custo.custo_unidade)}/${f.custo.unidade === "m2" ? "m²" : f.custo.unidade ?? "un."}` : "—"}</td>
                  <td className="pr-2 text-[11.5px]">{f.custo?.origem === "media_grupo" ? `média do grupo (${f.custo.empresas} empresa${f.custo.empresas === 1 ? "" : "s"})` : f.custo?.origem === "manual" ? "manual · ninguém conferido" : "sem dado"}</td>
                  <td className="pr-2 text-right tabular-nums">{f.custo?.pessoas_conferidas ?? 0}</td>
                  <td className="pr-2 text-right tabular-nums">{f.custo?.nao_conferidas ?? 0}</td>
                  <td className="text-right whitespace-nowrap">
                    {pode && <>
                      <button className="text-[12px] underline mr-2" onClick={() => setModal({ tipo: "funcao", f })}>Editar</button>
                      <button className="text-[12px] underline" onClick={() => setModal({ tipo: "unir", f })}><Link2 size={12} className="inline" /> Unir</button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11.5px] text-[#3D2314]/60">O custo da função é a média de todas as fichas conferidas das empresas do grupo, pesada pelas horas produtivas (e pela quantidade de pessoas no perfil padrão). Funções do grupo casam pelo CBO, quando houver, ou pelo nome; “Unir” junta nomes parecidos.</p>
        </div>
      )}

      {aba === "lista" && <MaoObraCatalogoLegado />}

      {modal?.tipo === "funcao" && <ModalFuncao companyId={companyId} f={modal.f} onClose={() => setModal(null)} onSalvar={rpc} />}
      {modal?.tipo === "importar" && <ImportarMaoObraModal companyId={companyId} funcoes={dados?.funcoes ?? []} equipe={dados?.equipe ?? []} onClose={() => setModal(null)} onConcluido={carregar} />}
      {modal?.tipo === "unir" && <ModalUnir f={modal.f} funcoes={funcoesAtivas} onClose={() => setModal(null)} onSalvar={rpc} />}
      {modal?.tipo === "ficha" && enc && <ModalFicha companyId={companyId} modo={modal.modo} item={modal.item} funcoes={funcoesAtivas} encargos={enc} onClose={() => setModal(null)} onSalvar={rpc} />}
      {modal?.tipo === "encerrar" && <ModalEncerrar item={modal.item} onClose={() => setModal(null)} onSalvar={rpc} />}
      {modal?.tipo === "encargos" && enc && <ModalEncargos companyId={companyId} enc={enc} onClose={() => setModal(null)} onSalvar={rpc} />}
      {modal?.tipo === "historico" && <ModalHistorico item={modal.item} onClose={() => setModal(null)} />}
    </div>
  );
}

type Salvar = (fn: string, args: Record<string, unknown>, ok: string) => Promise<boolean>;

function Janela({ titulo, onClose, children, testid }: { titulo: string; onClose: () => void; children: React.ReactNode; testid: string }) {
  return (
    <div onClick={onClose} className="fixed inset-0 bg-black/45 z-[90] flex items-start justify-center p-3 overflow-y-auto">
      <div onClick={(e) => e.stopPropagation()} className="bg-[#FAF7F2] rounded-xl w-full max-w-[720px] p-4 md:p-5 space-y-3 text-[#3D2314] mt-6" data-testid={testid}>
        <div className="flex items-center justify-between"><h2 className="text-[16px] font-medium">{titulo}</h2><button onClick={onClose} className={btnSec}><X size={14} /></button></div>
        {children}
      </div>
    </div>
  );
}
// todo campo do Hub tem o "?" (AjudaCampo) ao lado do rótulo — CEO 01/10; o gate check-ajuda-campo reprova campo sem ajuda
function Campo({ rotulo, ajuda, children }: { rotulo: React.ReactNode; ajuda?: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-[12px]"><span className="text-[#3D2314]/70">{rotulo}{ajuda && <AjudaCampo chave={ajuda} />}</span>{children}</label>;
}

function ModalFuncao({ companyId, f, onClose, onSalvar }: { companyId: string; f?: Funcao; onClose: () => void; onSalvar: Salvar }) {
  const [nome, setNome] = useState(f?.nome ?? "");
  const [cbo, setCbo] = useState(f?.cbo ?? "");
  const [forma, setForma] = useState(f?.forma_pagamento === "m2" ? "producao" : f?.forma_pagamento ?? "hora");
  const [unidade, setUnidade] = useState(f?.unidade_producao ?? (f?.forma_pagamento === "m2" ? "m2" : ""));
  const [manual, setManual] = useState(f?.custo_hora_manual != null ? String(f.custo_hora_manual).replace(".", ",") : "");
  const [ativo, setAtivo] = useState(f?.ativo ?? true);
  return (
    <Janela titulo={f ? `Editar função · ${f.nome}` : "Nova função"} onClose={onClose} testid="mao-obra-modal-funcao">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Campo ajuda="projetos.mao_obra.funcao.nome" rotulo="Nome da função"><input className={inp} value={nome} onChange={(e) => setNome(e.target.value)} data-testid="funcao-nome" placeholder="Gesseiro" /></Campo>
        <Campo ajuda="projetos.mao_obra.funcao.cbo" rotulo="CBO (opcional — casa a função entre as empresas do grupo)"><input className={inp} value={cbo} onChange={(e) => setCbo(e.target.value)} placeholder="7155-05" /></Campo>
        <Campo ajuda="projetos.mao_obra.funcao.forma" rotulo="Forma de pagamento (sugerida na ficha)"><select className={inp} value={forma} onChange={(e) => setForma(e.target.value)} data-testid="funcao-forma">{FORMAS.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}</select></Campo>
        {forma === "producao" && <Campo ajuda="projetos.mao_obra.funcao.unidade" rotulo="Unidade de produção"><select className={inp} value={unidade || "m2"} onChange={(e) => setUnidade(e.target.value)} data-testid="funcao-unidade">{UNIDADES.map((u) => <option key={u.v} value={u.v}>{u.l}</option>)}</select></Campo>}
        <Campo ajuda="projetos.mao_obra.funcao.custo_manual" rotulo="Custo/hora manual (só enquanto ninguém estiver conferido)"><input className={inp} value={manual} onChange={(e) => setManual(e.target.value)} inputMode="decimal" placeholder="opcional" /></Campo>
      </div>
      {f && <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Função ativa<AjudaCampo chave="projetos.mao_obra.funcao.ativa" /></label>}
      <div className="flex justify-end gap-2">
        <button className={btnSec} onClick={onClose}>Voltar</button>
        <button className={btnPri} data-testid="funcao-salvar" disabled={nome.trim().length < 2} onClick={async () => {
          if (await onSalvar("fn_mao_obra_funcao_salvar", { p_company_id: companyId, p_id: f?.id ?? null, p_dados: { nome, cbo, forma_pagamento: forma, unidade_producao: forma === "producao" ? unidade || "m2" : "", custo_hora_manual: manual ? numBR(manual) : "", ativo } }, `Função ${nome} salva.`)) onClose();
        }}>Salvar</button>
      </div>
    </Janela>
  );
}

function ModalUnir({ f, funcoes, onClose, onSalvar }: { f: Funcao; funcoes: Funcao[]; onClose: () => void; onSalvar: Salvar }) {
  const [alvo, setAlvo] = useState(f.unida_a_id ?? "");
  return (
    <Janela titulo={`Unir “${f.nome}” a outra função`} onClose={onClose} testid="mao-obra-modal-unir">
      <p className="text-[12.5px] text-[#3D2314]/70">As duas passam a contar como a mesma função na média do grupo (ex.: “Gesseiro” e “Gesseiro montador”).</p>
      <div className="flex items-center gap-1"><select className={inp} value={alvo} onChange={(e) => setAlvo(e.target.value)}>
        <option value="">— não unir (separar) —</option>
        {funcoes.filter((x) => x.id !== f.id).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
      </select><AjudaCampo chave="projetos.mao_obra.funcao.unir" /></div>
      <div className="flex justify-end gap-2">
        <button className={btnSec} onClick={onClose}>Voltar</button>
        <button className={btnPri} onClick={async () => { if (await onSalvar("fn_mao_obra_funcao_unir", { p_funcao_id: f.id, p_unir_a_id: alvo || null }, "Funções atualizadas.")) onClose(); }}>Salvar</button>
      </div>
    </Janela>
  );
}

const BENEFICIOS: [keyof FichaCusto, string, string][] = [
  ["beneficio_vt", "Vale-transporte (já sem o desconto de 6%)", "projetos.mao_obra.beneficio.vt"], ["beneficio_alimentacao", "Alimentação", "projetos.mao_obra.beneficio.alimentacao"],
  ["beneficio_saude", "Plano de saúde", "projetos.mao_obra.beneficio.saude"], ["beneficio_seguro", "Seguro de vida", "projetos.mao_obra.beneficio.seguro"], ["beneficio_epi", "EPI e uniforme (por mês)", "projetos.mao_obra.beneficio.epi"],
];

// Data de hoje no fuso de Brasília (UTC−3), para o campo "vale a partir de".
function hojeBR() { return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); }
const txt = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n).replace(".", ","));
const PADRAO_FICHA: PadroesFicha = {
  horas_produtivas_mes: 176, vinculo: "clt", forma_pagamento: "mensal", beneficio_vt: 0, beneficio_alimentacao: 0, beneficio_saude: 0, beneficio_seguro: 0, beneficio_epi: 0,
  dsr_fator: 0.16667, rpa_inss_pct: 20, salario_minimo: 1518, incidencia: {},
};
const padroesDe = (e: Encargos): PadroesFicha => ({ ...PADRAO_FICHA, ...(e.padroes ?? {}) } as PadroesFicha);
// percentuais do cálculo que podem ser ajustados na ficha (vêm do padrão da empresa)
const AJUSTES: { k: "encargos_folha_pct_ajuste" | "prov_13_pct_ajuste" | "prov_ferias_pct_ajuste" | "prov_rescisao_pct_ajuste" | "dsr_fator_ajuste"; padrao: (e: Encargos) => number; l: string; ajuda: string }[] = [
  { k: "encargos_folha_pct_ajuste", padrao: (e) => Number(e.encargos_folha_pct), l: "Encargos da folha %", ajuda: "projetos.mao_obra.ajuste.encargos" },
  { k: "prov_13_pct_ajuste", padrao: (e) => Number(e.prov_13_pct), l: "13º %", ajuda: "projetos.mao_obra.ajuste.13" },
  { k: "prov_ferias_pct_ajuste", padrao: (e) => Number(e.prov_ferias_pct), l: "Férias + 1/3 %", ajuda: "projetos.mao_obra.ajuste.ferias" },
  { k: "prov_rescisao_pct_ajuste", padrao: (e) => Number(e.prov_rescisao_pct), l: "Provisão de rescisão %", ajuda: "projetos.mao_obra.ajuste.rescisao" },
  { k: "dsr_fator_ajuste", padrao: (e) => Number(padroesDe(e).dsr_fator), l: "DSR (1/6 = 0,16667)", ajuda: "projetos.mao_obra.ajuste.dsr" },
];
const Obrig = () => <span className="text-[#791F1F]">*</span>;

const UNIDADES = [{ v: "m2", l: "m²" }, { v: "m", l: "metro" }, { v: "ponto", l: "ponto" }, { v: "peca", l: "peça" }, { v: "un", l: "unidade" }];
const rotUnidade = (u: string | null | undefined) => UNIDADES.find((x) => x.v === u)?.l ?? u ?? "un.";
const SUBTIPOS: Partial<Record<TipoComponente, { v: string; l: string }[]>> = {
  fixo: [{ v: "mensal", l: "mensal" }, { v: "hora", l: "por hora" }],
  adicional: [{ v: "insalubridade", l: "insalubridade (% do mínimo)" }, { v: "periculosidade", l: "periculosidade (% do fixo)" }, { v: "noturno", l: "noturno" }, { v: "outro", l: "outro (R$)" }],
};
const CHAVES: { k: keyof ChavesIncidencia; l: string; ajuda: string }[] = [
  { k: "gera_dsr", l: "Gera DSR", ajuda: "projetos.mao_obra.chave.gera_dsr" }, { k: "integra_13_ferias", l: "13º/férias", ajuda: "projetos.mao_obra.chave.13_ferias" },
  { k: "incide_encargos", l: "INSS/FGTS", ajuda: "projetos.mao_obra.chave.encargos" }, { k: "integra_remuneracao", l: "Integra a remuneração", ajuda: "projetos.mao_obra.chave.integra" },
];
const ehClt = (vinc: string) => vinc === "clt" || vinc === "clt_intermitente";

type LinhaComp = ChavesIncidencia & {
  key: string; tipo: TipoComponente; subtipo: string; descricao: string; valor: string; quantidade: string; percentual: string; unidade: string; estimado: boolean; chaves_ajustadas: boolean;
};
let seqLinha = 0;
function novaLinha(tipo: TipoComponente, vinc: string, inc: Record<string, ChavesIncidencia>, extra: Partial<LinhaComp> = {}): LinhaComp {
  const subtipo = extra.subtipo ?? (tipo === "fixo" ? "mensal" : tipo === "adicional" ? "insalubridade" : "");
  const percentual = extra.percentual ?? (tipo === "hora_extra" ? "50" : tipo === "adicional" ? (subtipo === "periculosidade" ? "30" : "20") : "");
  return {
    key: `c${++seqLinha}`, tipo, subtipo, descricao: "", valor: "", quantidade: "", percentual, unidade: tipo === "producao" ? "m2" : "", estimado: tipo === "producao",
    ...chavesPadrao(vinc as Vinculo, tipo, subtipo || null, inc), chaves_ajustadas: false, ...extra,
  };
}
function linhaDoBanco(c: Componente): LinhaComp {
  return {
    key: `c${++seqLinha}`, tipo: c.tipo, subtipo: c.subtipo ?? "", descricao: c.descricao ?? "", valor: c.valor ? txt(Number(c.valor)) : "",
    quantidade: c.quantidade ? txt(Number(c.quantidade)) : "", percentual: c.percentual != null ? txt(Number(c.percentual)) : "", unidade: c.unidade ?? "",
    estimado: !!c.estimado, gera_dsr: !!c.gera_dsr, integra_13_ferias: !!c.integra_13_ferias, incide_encargos: !!c.incide_encargos, integra_remuneracao: !!c.integra_remuneracao,
    chaves_ajustadas: !!c.chaves_ajustadas,
  };
}
function paraComponente(l: LinhaComp): Componente {
  return {
    tipo: l.tipo, subtipo: l.subtipo || null, descricao: l.descricao || null, valor: numBR(l.valor), quantidade: numBR(l.quantidade),
    percentual: l.percentual === "" ? null : numBR(l.percentual), unidade: l.tipo === "producao" ? l.unidade || "m2" : null, estimado: l.estimado,
    gera_dsr: l.gera_dsr, integra_13_ferias: l.integra_13_ferias, incide_encargos: l.incide_encargos, integra_remuneracao: l.integra_remuneracao,
  };
}
const formaDosComponentes = (ls: LinhaComp[]): FormaPagamento => {
  const c = ls.find((x) => numBR(x.valor) > 0 || numBR(x.percentual) > 0) ?? ls[0];
  if (!c) return "mensal";
  if (c.tipo === "fixo") return c.subtipo === "hora" ? "hora" : "mensal";
  if (c.tipo === "producao") return "producao";
  if (c.tipo === "diaria") return "diaria";
  return "mensal";
};

function ModalFicha({ companyId, modo, item, funcoes, encargos, onClose, onSalvar }: { companyId: string; modo: "pessoa" | "perfil" | "editar"; item?: ItemEquipe; funcoes: Funcao[]; encargos: Encargos; onClose: () => void; onSalvar: Salvar }) {
  const f0 = item?.ficha ?? {};
  const novo = modo !== "editar";
  const tipo = modo === "editar" ? item?.tipo ?? "perfil" : modo;
  const pad = padroesDe(encargos);
  const inc = pad.incidencia ?? {};
  const [v, setV] = useState<Record<string, string>>(() => {
    // ficha nova: pré-preenchida pelos padrões da empresa ("Configurar padrões"); edição: o que está na ficha
    const base: Record<string, string> = {
      funcao_id: String(item?.funcao_id ?? ""), vinculo: String(f0.vinculo ?? pad.vinculo),
      horas_produtivas_mes: txt(Number(f0.horas_produtivas_mes ?? pad.horas_produtivas_mes)), quantidade_pessoas: String(f0.quantidade_pessoas ?? 1),
      descricao: String(f0.descricao ?? ""), setor: String(f0.setor ?? ""), vigencia_inicio: hojeBR(), motivo: "",
    };
    for (const [k] of BENEFICIOS) {
      const daFicha = f0[k] != null && Number(f0[k]) !== 0 ? Number(f0[k]) : null;
      const doPadrao = novo ? Number((pad as unknown as Record<string, number>)[k] ?? 0) : 0;
      base[k] = daFicha != null ? txt(daFicha) : doPadrao ? txt(doPadrao) : "";
    }
    for (const a of AJUSTES) base[a.k] = f0[a.k] != null ? txt(Number(f0[a.k])) : "";
    return base;
  });
  const [linhas, setLinhas] = useState<LinhaComp[]>(() => {
    const doBanco = Array.isArray(f0.componentes) ? (f0.componentes as Componente[]) : [];
    if (doBanco.length) return doBanco.map(linhaDoBanco);
    return [novaLinha("fixo", String(f0.vinculo ?? pad.vinculo), inc)];
  });
  const [mei, setMei] = useState<boolean>(() => !!f0.mei_servico_obra);
  const [meiTocado, setMeiTocado] = useState(!novo);
  const [chavesOk, setChavesOk] = useState<boolean>(() => !!item?.chaves_confirmadas);
  const [salarioSugerido, setSalarioSugerido] = useState<string | null>(null);
  const [p, setP] = useState<Record<string, string>>({});
  const [tentou, setTentou] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((o) => ({ ...o, [k]: e.target.value }));
  const setPes = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setP((o) => ({ ...o, [k]: k === "cpf" ? mascaraCpf(e.target.value) : e.target.value }));
  const funcaoSel = funcoes.find((x) => x.id === v.funcao_id);

  function mudarLinha(key: string, patch: Partial<LinhaComp>) {
    setLinhas((ls) => ls.map((l) => {
      if (l.key !== key) return l;
      const n = { ...l, ...patch };
      if ((patch.tipo || patch.subtipo !== undefined) && !n.chaves_ajustadas) Object.assign(n, chavesPadrao(v.vinculo as Vinculo, n.tipo, n.subtipo || null, inc));
      if (patch.tipo && patch.tipo !== l.tipo) Object.assign(n, novaLinha(patch.tipo, v.vinculo, inc, { key: l.key }));
      return n;
    }));
  }
  function mudarChave(key: string, k: keyof ChavesIncidencia, val: boolean) {
    setLinhas((ls) => ls.map((l) => {
      if (l.key !== key) return l;
      const n = { ...l, [k]: val };
      const padrao = chavesPadrao(v.vinculo as Vinculo, n.tipo, n.subtipo || null, inc);
      n.chaves_ajustadas = CHAVES.some((c) => n[c.k] !== padrao[c.k]);
      return n;
    }));
    setChavesOk(false);
  }
  function mudarVinculo(vinc: string) {
    setV((o) => ({ ...o, vinculo: vinc }));
    // chaves seguem o vínculo (as que a pessoa não mexeu)
    setLinhas((ls) => ls.map((l) => (l.chaves_ajustadas ? l : { ...l, ...chavesPadrao(vinc as Vinculo, l.tipo, l.subtipo || null, inc) })));
    if (vinc === "pj" && !meiTocado) setMei(meiServicoObraPadrao(funcaoSel?.nome));
  }
  // ao escolher a função: sugere o salário médio (fixo) e a forma de pagamento da função (produção, diária, hora)
  function escolherFuncao(id: string) {
    const fn = funcoes.find((x) => x.id === id);
    setV((o) => ({ ...o, funcao_id: id }));
    if (!meiTocado) setMei(meiServicoObraPadrao(fn?.nome));
    if (!novo || !fn) return;
    const sug = fn.salario_sugerido?.valor;
    setLinhas((ls) => {
      let out = [...ls];
      const fixo = out.find((l) => l.tipo === "fixo" && l.subtipo !== "hora");
      if (sug && fixo && ehClt(v.vinculo) && (!fixo.valor || fixo.valor === salarioSugerido)) out = out.map((l) => (l === fixo ? { ...l, valor: txt(sug) } : l));
      const forma = fn.forma_pagamento;
      if ((forma === "producao" || forma === "m2") && !out.some((l) => l.tipo === "producao")) {
        out.push(novaLinha("producao", v.vinculo, inc, { unidade: fn.unidade_producao || "m2" }));
      } else if (forma === "diaria" && !out.some((l) => l.tipo === "diaria")) {
        out.push(novaLinha("diaria", v.vinculo, inc, { quantidade: "8" }));
      }
      return out;
    });
    setSalarioSugerido(sug ? txt(sug) : null);
  }

  const comps = linhas.map(paraComponente);
  const aj = (k: string) => (v[k] === "" ? null : numBR(v[k]));
  const ficha: Partial<FichaCusto> = {
    vinculo: v.vinculo as Vinculo, forma_pagamento: formaDosComponentes(linhas), componentes: comps, mei_servico_obra: v.vinculo === "pj" && mei,
    horas_produtivas_mes: numBR(v.horas_produtivas_mes) || 176,
    ...Object.fromEntries(BENEFICIOS.map(([k]) => [k, numBR(v[k])])),
    encargos_folha_pct_ajuste: aj("encargos_folha_pct_ajuste"), prov_13_pct_ajuste: aj("prov_13_pct_ajuste"),
    prov_ferias_pct_ajuste: aj("prov_ferias_pct_ajuste"), prov_rescisao_pct_ajuste: aj("prov_rescisao_pct_ajuste"), dsr_fator_ajuste: aj("dsr_fator_ajuste"),
  };
  const calc = calcularCustoMaoObra(ficha, encargos);
  const fixoMes = comps.filter((c) => c.tipo === "fixo" && (c.subtipo ?? "mensal") === "mensal").reduce((s, c) => s + Number(c.valor ?? 0), 0);
  const ctx = { fixoMes, horaBase: fixoMes / 220 + comps.filter((c) => c.tipo === "fixo" && c.subtipo === "hora").reduce((s, c) => s + Number(c.valor ?? 0), 0), salarioMinimo: Number(pad.salario_minimo) || 1518 };
  const temAjuste = AJUSTES.some((a) => v[a.k] !== "");
  const clt = ehClt(v.vinculo);
  const corpoFicha = { ...ficha, tipo, funcao_id: v.funcao_id, descricao: v.descricao || null, setor: v.setor || null, chaves_confirmadas: clt && chavesOk,
    quantidade_pessoas: tipo === "perfil" ? Math.max(1, Math.round(numBR(v.quantidade_pessoas))) : 1, vigencia_inicio: v.vigencia_inicio };
  const titulo = modo === "pessoa" ? "Novo funcionário" : modo === "perfil" ? "Novo perfil padrão (sem nome)" : `Editar / reajuste · ${item?.nome}`;

  // obrigatórios (o banco confere de novo): nome, CPF válido, função, vínculo, pelo menos um componente com valor e admissão
  const faltando: string[] = [];
  if (!v.funcao_id) faltando.push("função");
  if (!v.vinculo) faltando.push("vínculo");
  if (!temComponenteComValor(comps)) faltando.push("pelo menos um componente da remuneração com valor");
  if (modo === "pessoa") {
    if ((p.nome_completo ?? "").trim().length < 3) faltando.push("nome completo");
    if (!cpfValido(p.cpf)) faltando.push((p.cpf ?? "").replace(/\D/g, "").length === 11 ? "CPF válido (dígito não confere)" : "CPF");
    if (!p.data_admissao) faltando.push("data de admissão");
  }

  async function salvar() {
    setTentou(true);
    if (faltando.length) return;
    if (modo === "editar" && item) {
      if (await onSalvar("fn_mao_obra_ficha_reajustar", { p_ficha_id: item.id, p_dados: corpoFicha, p_vigencia: v.vigencia_inicio, p_motivo: v.motivo || "reajuste" }, "Reajuste salvo com histórico — confira para entrar no custo.")) onClose();
      return;
    }
    if (await onSalvar("fn_mao_obra_ficha_salvar", { p_company_id: companyId, p_ficha: corpoFicha, p_pessoa: tipo === "pessoa" ? p : null }, "Ficha salva — confira para entrar no custo da função.")) onClose();
  }
  const marcaErro = (cond: boolean) => (tentou && cond ? " border-[#791F1F]" : "");
  const rotEncargos = clt ? `Encargos (${pct(calc.encargos_folha_pct)})` : v.vinculo === "pj" ? (mei ? "INSS patronal do MEI em obra (20%)" : "Encargos (MEI/PJ: nenhum)") : `INSS do autônomo (${pct(calc.rpa_inss_pct)})`;

  return (
    <Janela titulo={titulo} onClose={onClose} testid="mao-obra-modal-ficha">
      {funcoes.length === 0 && <div className="rounded-md bg-[#FAEEDA] px-3 py-2 text-[12.5px]">Cadastre uma função antes (aba Funções → Nova função ou “Usar funções-modelo”).</div>}
      <p className="text-[11.5px] text-[#3D2314]/60"><Obrig /> obrigatório. O resto pode completar depois.</p>
      {modo === "pessoa" && (
        <fieldset className="space-y-2">
          <legend className="text-[11px] uppercase tracking-wide text-[#3D2314]/60">Dados pessoais e de vínculo (cadastro compartilhado — o mesmo do SST)</legend>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Campo ajuda="projetos.mao_obra.pessoa.nome" rotulo={<>Nome completo <Obrig /></>}><input className={inp + marcaErro((p.nome_completo ?? "").trim().length < 3)} onChange={setPes("nome_completo")} data-testid="pessoa-nome" /></Campo>
            <Campo ajuda="projetos.mao_obra.pessoa.cpf" rotulo={<>CPF <Obrig /></>}>
              <input className={inp + marcaErro(!cpfValido(p.cpf))} value={p.cpf ?? ""} onChange={setPes("cpf")} inputMode="numeric" placeholder="000.000.000-00" data-testid="pessoa-cpf" />
              {(p.cpf ?? "").replace(/\D/g, "").length === 11 && !cpfValido(p.cpf) && <span className="text-[11px] text-[#791F1F]" data-testid="pessoa-cpf-invalido">CPF inválido — confira os números</span>}
            </Campo>
            <Campo ajuda="projetos.mao_obra.pessoa.admissao" rotulo={<>Data de admissão <Obrig /></>}><input type="date" className={inp + marcaErro(!p.data_admissao)} onChange={setPes("data_admissao")} data-testid="pessoa-admissao" /></Campo>
            <Campo ajuda="projetos.mao_obra.pessoa.documentos" rotulo="RG"><input className={inp} onChange={setPes("rg")} /></Campo>
            <Campo ajuda="projetos.mao_obra.pessoa.documentos" rotulo="Data de nascimento"><input type="date" className={inp} onChange={setPes("data_nascimento")} /></Campo>
            <Campo ajuda="projetos.mao_obra.pessoa.contato" rotulo="Telefone"><input className={inp} onChange={setPes("telefone")} /></Campo>
            <Campo ajuda="projetos.mao_obra.pessoa.contato" rotulo="E-mail"><input className={inp} onChange={setPes("email")} /></Campo>
            <Campo ajuda="projetos.mao_obra.pessoa.endereco" rotulo="CEP"><input className={inp} onChange={setPes("cep")} /></Campo>
            <Campo ajuda="projetos.mao_obra.pessoa.endereco" rotulo="Endereço"><input className={inp} onChange={setPes("logradouro")} /></Campo>
            <Campo ajuda="projetos.mao_obra.pessoa.endereco" rotulo="Número"><input className={inp} onChange={setPes("numero")} /></Campo>
            <Campo ajuda="projetos.mao_obra.pessoa.endereco" rotulo="Bairro"><input className={inp} onChange={setPes("bairro")} /></Campo>
            <Campo ajuda="projetos.mao_obra.pessoa.endereco" rotulo="Cidade"><input className={inp} onChange={setPes("cidade")} /></Campo>
            <Campo ajuda="projetos.mao_obra.pessoa.endereco" rotulo="UF"><input className={inp} maxLength={2} onChange={setPes("uf")} /></Campo>
            <Campo ajuda="projetos.mao_obra.pessoa.matricula" rotulo="Matrícula"><input className={inp} onChange={setPes("matricula")} /></Campo>
            <Campo ajuda="projetos.mao_obra.pessoa.cargo_setor" rotulo="Cargo"><input className={inp} onChange={setPes("cargo")} /></Campo>
            <Campo ajuda="projetos.mao_obra.pessoa.cargo_setor" rotulo="Setor"><input className={inp} onChange={setPes("setor")} /></Campo>
            <Campo ajuda="projetos.mao_obra.pessoa.obra" rotulo="Obra atual"><input className={inp} onChange={setPes("obra_nome")} /></Campo>
          </div>
          <p className="text-[11px] text-[#3D2314]/60">Dados de saúde não entram aqui: ficam no SST.</p>
        </fieldset>
      )}
      <fieldset className="space-y-2">
        <legend className="text-[11px] uppercase tracking-wide text-[#3D2314]/60">Ficha de custo</legend>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Campo ajuda="projetos.mao_obra.ficha.funcao" rotulo={<>Função <Obrig /></>}>
            <select className={inp + marcaErro(!v.funcao_id)} value={v.funcao_id} onChange={(e) => escolherFuncao(e.target.value)} data-testid="ficha-funcao">
              <option value="">— escolha —</option>
              {funcoes.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </Campo>
          <Campo ajuda="projetos.mao_obra.ficha.vinculo" rotulo={<>Vínculo <Obrig /></>}><select className={inp} value={v.vinculo} onChange={(e) => mudarVinculo(e.target.value)} data-testid="ficha-vinculo">{VINCULOS.map((x) => <option key={x.v} value={x.v}>{x.rotulo}</option>)}</select></Campo>
          <Campo ajuda="projetos.mao_obra.ficha.horas" rotulo={`Horas produtivas por mês (padrão ${txt(pad.horas_produtivas_mes)})`}><input className={inp} value={v.horas_produtivas_mes} onChange={set("horas_produtivas_mes")} inputMode="decimal" data-testid="ficha-horas" /></Campo>
          {tipo === "perfil" && <>
            <Campo ajuda="projetos.mao_obra.ficha.perfil_descricao" rotulo="Descrição do perfil"><input className={inp} value={v.descricao} onChange={set("descricao")} placeholder="Gesseiro padrão" /></Campo>
            <Campo ajuda="projetos.mao_obra.ficha.perfil_quantidade" rotulo="Quantidade de pessoas"><input className={inp} value={v.quantidade_pessoas} onChange={set("quantidade_pessoas")} inputMode="numeric" data-testid="ficha-quantidade" /></Campo>
            <Campo ajuda="projetos.mao_obra.ficha.perfil_setor" rotulo="Setor"><input className={inp} value={v.setor} onChange={set("setor")} /></Campo>
          </>}
        </div>
        {v.vinculo === "pj" && (
          <label className="flex items-start gap-2 text-[12.5px]">
            <input type="checkbox" checked={mei} onChange={(e) => { setMei(e.target.checked); setMeiTocado(true); }} data-testid="ficha-mei-obra" className="mt-0.5" />
            <span>MEI em serviço de obra<AjudaCampo chave="projetos.mao_obra.ficha.mei_obra" /> (hidráulica, elétrica, pintura, alvenaria, carpintaria): o contratante paga 20% de INSS patronal sobre o valor (LC 123). <span className="text-[#8A5A00]">A confirmar com o contador.</span></span>
          </label>
        )}
        {v.vinculo === "diarista" && <p className="text-[11.5px] text-[#3D2314]/60">Diarista é calculado como autônomo (INSS do RPA sobre o valor).</p>}
      </fieldset>

      <fieldset className="space-y-2" data-testid="ficha-componentes">
        <legend className="text-[11px] uppercase tracking-wide text-[#3D2314]/60">Remuneração por componentes <Obrig /> <span className="normal-case tracking-normal">— pelo menos um com valor</span></legend>
        {clt && <p className="text-[11px] text-[#8A5A00]">Chaves de incidência pré-preenchidas pelo tipo e pelo vínculo — <b>a confirmar com o contador</b>.</p>}
        {linhas.map((l, idx) => {
          const c = comps[idx];
          const valorMes = valorMesComponente(c, ctx);
          return (
            <div key={l.key} className={`rounded-md border bg-white px-2 py-2 space-y-1.5${l.chaves_ajustadas ? " border-[#C8941A]" : " border-[#3D2314]/15"}`} data-testid={`componente-${idx}`}>
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 items-end">
                <Campo ajuda="projetos.mao_obra.comp.tipo" rotulo="Tipo">
                  <select className={inp} value={l.tipo} onChange={(e) => mudarLinha(l.key, { tipo: e.target.value as TipoComponente })} data-testid="componente-tipo">
                    {TIPOS_COMPONENTE.map((t) => <option key={t.tipo} value={t.tipo}>{t.rotulo}</option>)}
                  </select>
                </Campo>
                {SUBTIPOS[l.tipo] && (
                  <Campo ajuda="projetos.mao_obra.comp.tipo" rotulo="Qual">
                    <select className={inp} value={l.subtipo} onChange={(e) => mudarLinha(l.key, { subtipo: e.target.value, ...(l.tipo === "adicional" ? { percentual: e.target.value === "periculosidade" ? "30" : e.target.value === "outro" ? "" : "20" } : {}), ...(l.tipo === "fixo" && e.target.value === "hora" && !l.quantidade ? { quantidade: v.horas_produtivas_mes } : {}) })} data-testid="componente-subtipo">
                      {SUBTIPOS[l.tipo]!.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}
                    </select>
                  </Campo>
                )}
                <CamposComponente l={l} onChange={(patch) => mudarLinha(l.key, patch)} />
                <div className="text-[12px] text-right sm:col-span-1">Valor do mês<br /><b data-testid="componente-valor-mes">{brl(Math.round(valorMes * 100) / 100)}</b></div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px]">
                <span className="flex items-center"><input className={inp + " max-w-[260px]"} value={l.descricao} onChange={(e) => mudarLinha(l.key, { descricao: e.target.value })} placeholder="descrição (opcional)" /><AjudaCampo chave="projetos.mao_obra.comp.descricao" /></span>
                {clt && (
                  <span className="flex flex-wrap items-center gap-3" data-testid="componente-chaves">
                    {CHAVES.map((ch) => (
                      <label key={ch.k} className="flex items-center gap-1"><input type="checkbox" checked={l[ch.k]} onChange={(e) => mudarChave(l.key, ch.k, e.target.checked)} data-testid={`chave-${ch.k}`} /> {ch.l}<AjudaCampo chave={ch.ajuda} /></label>
                    ))}
                    {l.chaves_ajustadas && <button type="button" className="underline" onClick={() => setLinhas((ls) => ls.map((x) => (x.key === l.key ? { ...x, ...chavesPadrao(v.vinculo as Vinculo, x.tipo, x.subtipo || null, inc), chaves_ajustadas: false } : x)))}>padrão</button>}
                  </span>
                )}
                {linhas.length > 1 && <button type="button" className="text-[#791F1F] underline" onClick={() => setLinhas((ls) => ls.filter((x) => x.key !== l.key))} data-testid="componente-remover">remover</button>}
              </div>
            </div>
          );
        })}
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center"><select className={inp + " max-w-[240px]"} value="" onChange={(e) => { if (e.target.value) setLinhas((ls) => [...ls, novaLinha(e.target.value as TipoComponente, v.vinculo, inc, e.target.value === "producao" && funcaoSel?.unidade_producao ? { unidade: funcaoSel.unidade_producao } : {})]); }} data-testid="componente-adicionar">
            <option value="">+ adicionar componente…</option>
            {TIPOS_COMPONENTE.map((t) => <option key={t.tipo} value={t.tipo}>{t.rotulo} — {t.ajuda}</option>)}
          </select><AjudaCampo chave="projetos.mao_obra.comp.tipo" /></span>
          {salarioSugerido && funcaoSel?.salario_sugerido && linhas.some((l) => l.tipo === "fixo" && l.valor === salarioSugerido) && (
            <span className="text-[11px] text-[#3D2314]/60" data-testid="ficha-salario-sugerido">
              Fixo sugerido: {funcaoSel.salario_sugerido.origem === "media_conferida" ? `média conferida da função (${funcaoSel.salario_sugerido.pessoas} pessoa(s))` : "estimado pelo custo/hora atual da função"} — ajuste se precisar
            </span>
          )}
        </div>
        {clt && (
          <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={chavesOk} onChange={(e) => setChavesOk(e.target.checked)} data-testid="ficha-chaves-confirmadas" /> As chaves de incidência desta ficha foram conferidas com o contador<AjudaCampo chave="projetos.mao_obra.chave.confirmadas" /></label>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-[11px] uppercase tracking-wide text-[#3D2314]/60">Benefícios e vigência</legend>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {BENEFICIOS.map(([k, l, aj]) => (
            <Campo key={k} rotulo={l} ajuda={aj}><input className={inp} value={v[k]} onChange={set(k)} inputMode="decimal" data-testid={`ficha-${k}`} /></Campo>
          ))}
          <Campo ajuda="projetos.mao_obra.ficha.vigencia" rotulo={modo === "editar" ? "Vale a partir de (reajuste)" : "Vale a partir de"}><input type="date" className={inp} value={v.vigencia_inicio} onChange={set("vigencia_inicio")} /></Campo>
          {modo === "editar" && <Campo ajuda="projetos.mao_obra.ficha.motivo" rotulo="Motivo (ex.: dissídio, promoção, correção)"><input className={inp} value={v.motivo} onChange={set("motivo")} /></Campo>}
        </div>
      </fieldset>
      {clt && (
        <div className="rounded-md border border-[#3D2314]/15 bg-white px-3 py-2 space-y-2" data-testid="ficha-ajustes">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
            <span className="text-[#3D2314]/70">Percentuais do cálculo — vêm do padrão da empresa{encargos.provisorio ? " (provisórios)" : ""}; altere só se esta ficha for diferente.</span>
            {temAjuste && (
              <span className="flex items-center gap-2">
                <span className="rounded bg-[#FAEEDA] px-2 py-0.5 text-[11.5px] text-[#8A5A00]" data-testid="ficha-ajustada">
                  Ajustado nesta ficha{item?.ajuste_por_nome && f0.ajuste_em ? ` por ${item.ajuste_por_nome} em ${new Date(String(f0.ajuste_em)).toLocaleString("pt-BR")}` : ""}
                </span>
                <button type="button" className="text-[12px] underline" data-testid="ficha-voltar-padrao" onClick={() => setV((o) => ({ ...o, ...Object.fromEntries(AJUSTES.map((a) => [a.k, ""])) }))}>Voltar ao padrão</button>
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {AJUSTES.map((a) => (
              <Campo key={a.k} rotulo={a.l} ajuda={a.ajuda}>
                <input className={inp + (v[a.k] !== "" ? " border-[#C8941A] bg-[#FFFBF0]" : "")} value={v[a.k] !== "" ? v[a.k] : txt(a.padrao(encargos))}
                  onChange={(e) => { const x = e.target.value; setV((o) => ({ ...o, [a.k]: numBR(x) === a.padrao(encargos) ? "" : x })); }}
                  inputMode="decimal" data-testid={`ficha-${a.k}`} />
              </Campo>
            ))}
          </div>
        </div>
      )}
      <div className="rounded-md border border-[#C8941A]/50 bg-white px-3 py-2 text-[12.5px] grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="ficha-calculo">
        <div>Componentes no mês<br /><b>{brl(calc.base)}</b></div>
        {clt && <div>DSR + 13º e férias<br /><b>{brl(calc.dsr + calc.provisoes)}</b></div>}
        <div>{rotEncargos}{encargos.provisorio && clt && !temAjuste && <span className="text-[#8A5A00]"> · provisórios</span>}<br /><b data-testid="ficha-encargos">{brl(calc.encargos)}</b></div>
        {clt && <div>Rescisão<br /><b>{brl(calc.rescisao)}</b></div>}
        <div>Custo mensal{tipo === "perfil" ? " (por pessoa)" : ""}<AjudaCampo chave="projetos.mao_obra.resultado.mensal" /><br /><b data-testid="ficha-custo-mensal">{brl(calc.custo_mensal)}</b></div>
        <div>Custo da hora produtiva<AjudaCampo chave="projetos.mao_obra.resultado.hora" /><br /><b data-testid="ficha-custo-hora">{brl(calc.custo_hora)}</b></div>
        {calc.custo_unidade != null && <div>Custo por {rotUnidade(calc.unidade)}<AjudaCampo chave="projetos.mao_obra.resultado.unidade" /><br /><b data-testid="ficha-custo-unidade">{brl(calc.custo_unidade)}</b></div>}
      </div>
      {calc.alertas.includes("diarista_mais_8_dias") && (
        <div className="rounded-md bg-[#F7E1E1] text-[#791F1F] px-3 py-2 text-[12.5px]" data-testid="ficha-alerta-diarista">
          <AlertTriangle size={13} className="inline -mt-0.5 mr-1" /> Risco trabalhista: diarista com mais de 8 dias no mês pode caracterizar vínculo de emprego. Confirme com o contador.
        </div>
      )}
      {calc.alertas.includes("volume_estimado") && (
        <div className="rounded-md bg-[#FAEEDA] text-[#8A5A00] px-3 py-2 text-[12px]" data-testid="ficha-alerta-estimado">Volume estimado — o custo por unidade e o custo mensal são estimativa até haver produção medida.</div>
      )}
      {tentou && faltando.length > 0 && <div className="rounded-md bg-[#F7E1E1] text-[#791F1F] px-3 py-2 text-[12.5px]" data-testid="ficha-faltando">Falta preencher: {faltando.join(", ")}.</div>}
      <p className="text-[11px] text-[#3D2314]/60">Valores-padrão (DSR 1/6, INSS do RPA, MEI em obra, chaves de incidência) são a confirmar com o contador. Depois de salvar, a ficha fica “não conferida” e não entra no custo da função até alguém conferir.</p>
      <div className="flex justify-end gap-2">
        <button className={btnSec} onClick={onClose}>Voltar</button>
        <button className={btnPri} onClick={() => void salvar()} data-testid="ficha-salvar">Salvar</button>
      </div>
    </Janela>
  );
}

// campos de valor de cada tipo de componente
function CamposComponente({ l, onChange }: { l: LinhaComp; onChange: (patch: Partial<LinhaComp>) => void }) {
  const campo = (k: "valor" | "quantidade" | "percentual", rotulo: string, testid: string, ajuda: string, ph?: string) => (
    <Campo rotulo={rotulo} ajuda={ajuda}><input className={inp} value={l[k]} onChange={(e) => onChange({ [k]: e.target.value })} inputMode="decimal" placeholder={ph} data-testid={testid} /></Campo>
  );
  switch (l.tipo) {
    case "fixo":
      return l.subtipo === "hora"
        ? <>{campo("valor", "R$ por hora", "componente-valor", "projetos.mao_obra.comp.fixo_hora")}{campo("quantidade", "Horas no mês", "componente-quantidade", "projetos.mao_obra.comp.fixo_hora")}</>
        : <>{campo("valor", "R$ por mês", "componente-valor", "projetos.mao_obra.comp.fixo_mensal")}</>;
    case "producao":
      return <>
        {campo("valor", `R$ por ${rotUnidade(l.unidade)}`, "componente-valor", "projetos.mao_obra.comp.producao_valor")}
        <Campo ajuda="projetos.mao_obra.comp.producao_unidade" rotulo="Unidade"><select className={inp} value={l.unidade || "m2"} onChange={(e) => onChange({ unidade: e.target.value })} data-testid="componente-unidade">{UNIDADES.map((u) => <option key={u.v} value={u.v}>{u.l}</option>)}</select></Campo>
        {campo("quantidade", "Volume médio no mês", "componente-quantidade", "projetos.mao_obra.comp.producao_volume")}
        <label className="flex items-center gap-1 text-[11.5px] pb-2"><input type="checkbox" checked={l.estimado} onChange={(e) => onChange({ estimado: e.target.checked })} data-testid="componente-estimado" /> volume estimado<AjudaCampo chave="projetos.mao_obra.comp.producao_estimado" /></label>
      </>;
    case "empreitada":
      return <>{campo("valor", "Valor da obra (R$)", "componente-valor", "projetos.mao_obra.comp.empreitada")}{campo("quantidade", "Dias da obra", "componente-quantidade", "projetos.mao_obra.comp.empreitada")}</>;
    case "diaria":
      return <>{campo("valor", "R$ por dia", "componente-valor", "projetos.mao_obra.comp.diaria")}{campo("quantidade", "Dias no mês", "componente-quantidade", "projetos.mao_obra.comp.diaria")}</>;
    case "comissao":
      return <>{campo("percentual", "Comissão %", "componente-percentual", "projetos.mao_obra.comp.comissao")}{campo("quantidade", "Base média do mês (R$)", "componente-quantidade", "projetos.mao_obra.comp.comissao")}</>;
    case "bonus":
      return <>{campo("valor", "Valor médio no mês (R$)", "componente-valor", "projetos.mao_obra.comp.bonus")}</>;
    case "hora_extra":
      return <>{campo("quantidade", "Horas extras no mês", "componente-quantidade", "projetos.mao_obra.comp.hora_extra")}{campo("percentual", "Adicional %", "componente-percentual", "projetos.mao_obra.comp.hora_extra")}{campo("valor", "R$ da hora (vazio = fixo ÷ 220)", "componente-valor", "projetos.mao_obra.comp.hora_extra", "auto")}</>;
    case "adicional":
      if (l.subtipo === "insalubridade") return <>{campo("percentual", "% do salário mínimo (10, 20, 40)", "componente-percentual", "projetos.mao_obra.comp.insalubridade")}</>;
      if (l.subtipo === "periculosidade") return <>{campo("percentual", "% do fixo", "componente-percentual", "projetos.mao_obra.comp.periculosidade")}</>;
      if (l.subtipo === "noturno") return <>{campo("quantidade", "Horas noturnas no mês", "componente-quantidade", "projetos.mao_obra.comp.noturno")}{campo("percentual", "Adicional %", "componente-percentual", "projetos.mao_obra.comp.noturno")}</>;
      return <>{campo("valor", "R$ por mês", "componente-valor", "projetos.mao_obra.comp.adicional_outro")}</>;
    default:
      return null;
  }
}

function ModalEncerrar({ item, onClose, onSalvar }: { item: ItemEquipe; onClose: () => void; onSalvar: Salvar }) {
  const [data, setData] = useState(hojeBR);
  const [motivo, setMotivo] = useState("");
  const pessoa = item.tipo === "pessoa";
  return (
    <Janela titulo={pessoa ? `Desligar ${item.nome}` : `Inativar perfil ${item.nome}`} onClose={onClose} testid="mao-obra-modal-encerrar">
      <p className="text-[12.5px] text-[#3D2314]/70">{pessoa ? "A pessoa fica desligada (data de demissão no cadastro compartilhado) e sai do custo da função. Nada é apagado." : "O perfil sai do custo da função. Nada é apagado."}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Campo ajuda="projetos.mao_obra.encerrar.data" rotulo={pessoa ? "Data do desligamento" : "Data"}><input type="date" className={inp} value={data} onChange={(e) => setData(e.target.value)} /></Campo>
        <Campo ajuda="projetos.mao_obra.encerrar.motivo" rotulo="Motivo"><input className={inp} value={motivo} onChange={(e) => setMotivo(e.target.value)} data-testid="encerrar-motivo" /></Campo>
      </div>
      <div className="flex justify-end gap-2">
        <button className={btnSec} onClick={onClose}>Voltar</button>
        <button className={btnPri} disabled={motivo.trim().length < 3} data-testid="encerrar-confirmar" onClick={async () => { if (await onSalvar("fn_mao_obra_ficha_encerrar", { p_ficha_id: item.id, p_data: data, p_motivo: motivo }, pessoa ? `${item.nome} desligado.` : "Perfil inativado.")) onClose(); }}>{pessoa ? "Desligar" : "Inativar"}</button>
      </div>
    </Janela>
  );
}

const BENEFICIOS_PADRAO: [keyof PadroesFicha, string][] = [
  ["beneficio_vt", "Vale-transporte (R$/mês)"], ["beneficio_alimentacao", "Alimentação (R$/mês)"], ["beneficio_saude", "Plano de saúde (R$/mês)"],
  ["beneficio_seguro", "Seguro de vida (R$/mês)"], ["beneficio_epi", "EPI e uniforme (R$/mês)"],
];

const LINHAS_INCIDENCIA: { k: string; tipo: TipoComponente; subtipo?: string; rotulo: string }[] = [
  { k: "fixo:mensal", tipo: "fixo", subtipo: "mensal", rotulo: "Fixo mensal" }, { k: "fixo:hora", tipo: "fixo", subtipo: "hora", rotulo: "Fixo por hora" },
  { k: "producao", tipo: "producao", rotulo: "Produção por unidade" }, { k: "empreitada", tipo: "empreitada", rotulo: "Empreitada por obra" },
  { k: "diaria", tipo: "diaria", rotulo: "Diária" }, { k: "comissao", tipo: "comissao", rotulo: "Comissão" }, { k: "bonus", tipo: "bonus", rotulo: "Bônus / prêmio" },
  { k: "hora_extra", tipo: "hora_extra", rotulo: "Horas extras habituais" }, { k: "adicional", tipo: "adicional", rotulo: "Adicionais (insalubridade, periculosidade, outros)" },
  { k: "adicional:noturno", tipo: "adicional", subtipo: "noturno", rotulo: "Adicional noturno" },
];

function ModalEncargos({ companyId, enc, onClose, onSalvar }: { companyId: string; enc: Encargos; onClose: () => void; onSalvar: Salvar }) {
  const [v, setV] = useState<Record<string, string>>(() => ({
    regime: enc.regime, simples_anexo: enc.simples_anexo ?? "", inss_patronal_pct: String(enc.inss_patronal_pct), rat_pct: String(enc.rat_pct), fap: String(enc.fap),
    terceiros_pct: String(enc.terceiros_pct), fgts_pct: String(enc.fgts_pct), prov_13_pct: String(enc.prov_13_pct), prov_ferias_pct: String(enc.prov_ferias_pct),
    prov_rescisao_pct: String(enc.prov_rescisao_pct), desoneracao: enc.desoneracao ? "1" : "", desoneracao_fator_folha: String(enc.desoneracao ? enc.desoneracao_fator_folha : fatorFolhaReoneracao(new Date().getFullYear())),
    cprb_pct: enc.cprb_pct != null ? String(enc.cprb_pct) : "", vigencia_inicio: hojeBR(),
    horas_produtivas_padrao: txt(padroesDe(enc).horas_produtivas_mes), vinculo_padrao: padroesDe(enc).vinculo,
    forma_padrao: padroesDe(enc).forma_pagamento === "m2" ? "producao" : padroesDe(enc).forma_pagamento,
    ...Object.fromEntries(BENEFICIOS_PADRAO.map(([k]) => [`${k}_padrao`, txt(Number(padroesDe(enc)[k] ?? 0))])),
    dsr_fator: txt(padroesDe(enc).dsr_fator), rpa_inss_pct: txt(padroesDe(enc).rpa_inss_pct), salario_minimo_ref: txt(padroesDe(enc).salario_minimo),
  }));
  // chaves de incidência por tipo de componente (CLT) — padrão interno, salvo o que a empresa mudou
  const [inc, setInc] = useState<Record<string, ChavesIncidencia>>(() => Object.fromEntries(LINHAS_INCIDENCIA.map((l) => [l.k, chavesPadrao("clt", l.tipo, l.subtipo, padroesDe(enc).incidencia ?? {})])));
  const [confirmar, setConfirmar] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((o) => ({ ...o, [k]: e.target.value }));
  const total = encargosFolhaPct({ inss_patronal_pct: numBR(v.inss_patronal_pct), desoneracao_fator_folha: v.desoneracao ? numBR(v.desoneracao_fator_folha) : 1, rat_pct: numBR(v.rat_pct), fap: numBR(v.fap), terceiros_pct: numBR(v.terceiros_pct), fgts_pct: numBR(v.fgts_pct) });
  function aplicarPadrao(anexo: string) {
    if (v.regime !== "simples") setV((o) => ({ ...o, inss_patronal_pct: "20", rat_pct: "3", terceiros_pct: "5,8", fgts_pct: "8" }));
    else if (anexo === "IV") setV((o) => ({ ...o, simples_anexo: anexo, inss_patronal_pct: "20", rat_pct: "3", terceiros_pct: "0", fgts_pct: "8" }));
    else setV((o) => ({ ...o, simples_anexo: anexo, inss_patronal_pct: "0", rat_pct: "0", terceiros_pct: "0", fgts_pct: "8" }));
  }
  return (
    <Janela titulo="Padrões da empresa (quem emprega)" onClose={onClose} testid="mao-obra-modal-encargos">
      <p className="text-[12px] text-[#3D2314]/70">Ficam “provisórios” até o contador confirmar. Nos Anexos III e V do Simples o INSS patronal está dentro do DAS (só FGTS na folha); no Anexo IV (obra) o INSS patronal e o RAT são pagos fora do DAS.</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Campo ajuda="projetos.mao_obra.padrao.regime" rotulo="Regime"><select className={inp} value={v.regime} onChange={set("regime")}><option value="simples">Simples</option><option value="presumido">Lucro Presumido</option><option value="real">Lucro Real</option></select></Campo>
        {v.regime === "simples" && <Campo ajuda="projetos.mao_obra.padrao.anexo" rotulo="Anexo do Simples"><select className={inp} value={v.simples_anexo} onChange={(e) => aplicarPadrao(e.target.value)}><option value="">—</option>{["I", "II", "III", "IV", "V"].map((a) => <option key={a} value={a}>Anexo {a}</option>)}</select></Campo>}
        <Campo ajuda="projetos.mao_obra.padrao.inss" rotulo="INSS patronal %"><input className={inp} value={v.inss_patronal_pct} onChange={set("inss_patronal_pct")} /></Campo>
        <Campo ajuda="projetos.mao_obra.padrao.rat" rotulo="RAT %"><input className={inp} value={v.rat_pct} onChange={set("rat_pct")} /></Campo>
        <Campo ajuda="projetos.mao_obra.padrao.fap" rotulo="FAP"><input className={inp} value={v.fap} onChange={set("fap")} /></Campo>
        <Campo ajuda="projetos.mao_obra.padrao.terceiros" rotulo="Terceiros %"><input className={inp} value={v.terceiros_pct} onChange={set("terceiros_pct")} /></Campo>
        <Campo ajuda="projetos.mao_obra.padrao.fgts" rotulo="FGTS %"><input className={inp} value={v.fgts_pct} onChange={set("fgts_pct")} /></Campo>
        <Campo ajuda="projetos.mao_obra.padrao.provisoes" rotulo="13º %"><input className={inp} value={v.prov_13_pct} onChange={set("prov_13_pct")} /></Campo>
        <Campo ajuda="projetos.mao_obra.padrao.provisoes" rotulo="Férias + 1/3 %"><input className={inp} value={v.prov_ferias_pct} onChange={set("prov_ferias_pct")} /></Campo>
        <Campo ajuda="projetos.mao_obra.padrao.provisoes" rotulo="Rescisão %"><input className={inp} value={v.prov_rescisao_pct} onChange={set("prov_rescisao_pct")} /></Campo>
        <Campo ajuda="projetos.mao_obra.padrao.vigencia" rotulo="Vale a partir de"><input type="date" className={inp} value={v.vigencia_inicio} onChange={set("vigencia_inicio")} /></Campo>
      </div>
      <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={!!v.desoneracao} onChange={(e) => setV((o) => ({ ...o, desoneracao: e.target.checked ? "1" : "" }))} data-testid="encargos-desoneracao" /> Desoneração da folha (CPRB) — reoneração gradual<AjudaCampo chave="projetos.mao_obra.padrao.desoneracao" /></label>
      {v.desoneracao && (
        <div className="grid grid-cols-2 gap-2">
          <Campo ajuda="projetos.mao_obra.padrao.desoneracao" rotulo={`Parte do INSS patronal na folha (${new Date().getFullYear()}: ${fatorFolhaReoneracao(new Date().getFullYear()) * 100}%)`}><input className={inp} value={v.desoneracao_fator_folha} onChange={set("desoneracao_fator_folha")} /></Campo>
          <Campo ajuda="projetos.mao_obra.padrao.desoneracao" rotulo="CPRB sobre a receita % (vai para os impostos da venda, não para a hora)"><input className={inp} value={v.cprb_pct} onChange={set("cprb_pct")} /></Campo>
        </div>
      )}
      <div className="text-[12.5px]">Encargos da folha: <b>{pct(total)}</b></div>
      <fieldset className="space-y-2 border-t border-[#3D2314]/10 pt-2" data-testid="padroes-ficha">
        <legend className="text-[11px] uppercase tracking-wide text-[#3D2314]/60">Padrões da ficha nova (dá para mudar em cada ficha)</legend>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Campo ajuda="projetos.mao_obra.padrao.horas" rotulo="Horas produtivas/mês"><input className={inp} value={v.horas_produtivas_padrao} onChange={set("horas_produtivas_padrao")} inputMode="decimal" data-testid="padrao-horas" /></Campo>
          <Campo ajuda="projetos.mao_obra.padrao.vinculo_forma" rotulo="Vínculo"><select className={inp} value={v.vinculo_padrao} onChange={set("vinculo_padrao")}>{VINCULOS.map((x) => <option key={x.v} value={x.v}>{x.rotulo}</option>)}</select></Campo>
          <Campo ajuda="projetos.mao_obra.padrao.vinculo_forma" rotulo="Forma de pagamento"><select className={inp} value={v.forma_padrao} onChange={set("forma_padrao")}>{FORMAS.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}</select></Campo>
          {BENEFICIOS_PADRAO.map(([k, l]) => (
            <Campo ajuda="projetos.mao_obra.padrao.beneficios" key={k} rotulo={l}><input className={inp} value={v[`${k}_padrao`]} onChange={set(`${k}_padrao`)} inputMode="decimal" data-testid={`padrao-${k}`} /></Campo>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-2 border-t border-[#3D2314]/10 pt-2" data-testid="padroes-calculo">
        <legend className="text-[11px] uppercase tracking-wide text-[#3D2314]/60">Regras do cálculo (a confirmar com o contador)</legend>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Campo ajuda="projetos.mao_obra.padrao.dsr" rotulo="DSR (fração do mês; 1/6 = 0,16667)"><input className={inp} value={v.dsr_fator} onChange={set("dsr_fator")} inputMode="decimal" data-testid="padrao-dsr" /></Campo>
          <Campo ajuda="projetos.mao_obra.padrao.rpa" rotulo={`INSS do autônomo (RPA) % — regra do regime: ${rpaInssPadrao(v.regime, v.simples_anexo)}%`}><input className={inp} value={v.rpa_inss_pct} onChange={set("rpa_inss_pct")} inputMode="decimal" data-testid="padrao-rpa" /></Campo>
          <Campo ajuda="projetos.mao_obra.padrao.salario_minimo" rotulo="Salário mínimo de referência (insalubridade)"><input className={inp} value={v.salario_minimo_ref} onChange={set("salario_minimo_ref")} inputMode="decimal" data-testid="padrao-salario-minimo" /></Campo>
        </div>
        <p className="text-[11px] text-[#3D2314]/60">RPA: 0% no Simples Anexo III ou V (o INSS já está no DAS); 20% no Anexo IV, Lucro Real e Presumido. MEI em serviço de obra: 20% (LC 123). Diarista é calculado como autônomo.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]" data-testid="padroes-incidencia">
            <thead><tr className="text-left text-[#3D2314]/60"><th className="py-1 pr-2">Componente (CLT)<AjudaCampo chave="projetos.mao_obra.padrao.chaves" /></th>{CHAVES.map((c) => <th key={c.k} className="pr-2 text-center">{c.l}</th>)}</tr></thead>
            <tbody>{LINHAS_INCIDENCIA.map((l) => (
              <tr key={l.k} className="border-t border-[#3D2314]/5"><td className="py-1 pr-2">{l.rotulo}</td>
                {CHAVES.map((c) => <td key={c.k} className="pr-2 text-center"><input type="checkbox" checked={inc[l.k][c.k]} onChange={(e) => setInc((o) => ({ ...o, [l.k]: { ...o[l.k], [c.k]: e.target.checked } }))} /></td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={confirmar} onChange={(e) => setConfirmar(e.target.checked)} data-testid="encargos-confirmar" /> O contador confirmou estes percentuais e regras<AjudaCampo chave="projetos.mao_obra.padrao.confirmado" /></label>
      <div className="flex justify-end gap-2">
        <button className={btnSec} onClick={onClose}>Voltar</button>
        <button className={btnPri} data-testid="encargos-salvar" onClick={async () => {
          const dados: Record<string, unknown> = { ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, ["regime", "simples_anexo", "vigencia_inicio", "vinculo_padrao", "forma_padrao"].includes(k) ? x : k === "desoneracao" ? !!x : x === "" ? null : numBR(x)])) };
          // INSS do RPA igual à regra do regime = sem valor próprio (segue o regime se ele mudar)
          if (dados.rpa_inss_pct === rpaInssPadrao(v.regime, v.simples_anexo)) dados.rpa_inss_pct = null;
          // só as chaves que a empresa mudou em relação ao padrão interno
          dados.incidencia_padrao = Object.fromEntries(LINHAS_INCIDENCIA.filter((l) => CHAVES.some((c) => inc[l.k][c.k] !== chavesPadrao("clt", l.tipo, l.subtipo)[c.k])).map((l) => [l.k, inc[l.k]]));
          if (await onSalvar("fn_mao_obra_encargos_salvar", { p_company_id: companyId, p_dados: dados, p_confirmar: confirmar }, confirmar ? "Padrões salvos — encargos confirmados pelo contador." : "Padrões salvos.")) onClose();
        }}>Salvar</button>
      </div>
    </Janela>
  );
}

function ModalHistorico({ item, onClose }: { item: ItemEquipe; onClose: () => void }) {
  const [linhas, setLinhas] = useState<{ vigencia_inicio: string; vigencia_fim: string | null; salario: number; motivo: string | null; conferido: boolean; custo: { custo_mensal: number | null; custo_hora: number | null } }[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    void supabase.rpc("fn_mao_obra_ficha_historico", { p_grupo_id: item.grupo_id }).then(({ data, error }) => { if (error) setErro(error.message); else setLinhas((data as typeof linhas) ?? []); });
  }, [item.grupo_id]);
  return (
    <Janela titulo={`Histórico · ${item.nome}`} onClose={onClose} testid="mao-obra-modal-historico">
      {erro && <div className="text-[#791F1F] text-[12.5px]">{erro}</div>}
      <table className="w-full text-[12.5px]"><thead><tr className="text-left text-[#3D2314]/60"><th>Vigência</th><th className="text-right">Salário/valor</th><th className="text-right">Custo mensal</th><th className="text-right">Hora</th><th>Motivo</th></tr></thead>
        <tbody>{(linhas ?? []).map((l, i) => (
          <tr key={i} className="border-t border-[#3D2314]/5"><td>{l.vigencia_inicio}{l.vigencia_fim ? ` → ${l.vigencia_fim}` : " → hoje"}</td><td className="text-right">{brl(l.salario)}</td><td className="text-right">{brl(l.custo?.custo_mensal)}</td><td className="text-right">{brl(l.custo?.custo_hora)}</td><td>{l.motivo}{l.conferido ? " · conferido" : ""}</td></tr>
        ))}</tbody></table>
    </Janela>
  );
}
