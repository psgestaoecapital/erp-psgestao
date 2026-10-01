// src/app/dashboard/projetos/mao-obra/page.tsx
// Hub · Mão de obra (SPEC Hub E1+E2 rev. 15, seção 5 · recorte H1+H3). Genérico para qualquer empresa.
// Abas: Funções (média do GRUPO ponderada por horas, só fichas conferidas) · Equipe (por pessoa no cadastro
// compartilhado OU perfil padrão sem nome) · Lista atual (o catálogo antigo, até a migração com OK do CEO).
// LGPD: salário e custo individual só para gestor/financeiro da empresa que emprega — o banco já devolve mascarado.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HardHat, Plus, Users, UserPlus, Link2, History, Lock, CheckCircle2, AlertTriangle, X } from "lucide-react";
import { useCompanyIds } from "@/lib/useCompanyIds";
import { supabase } from "@/lib/supabase";
import MaoObraCatalogoLegado from "@/components/projetos/MaoObraCatalogoLegado";
import { calcularCustoMaoObra, encargosFolhaPct, fatorFolhaReoneracao, type Encargos, type FichaCusto } from "@/lib/hub/custoMaoObra";

type CustoFuncao = { custo_hora: number | null; custo_m2: number | null; origem: "media_grupo" | "manual" | "sem_dado"; pessoas_conferidas: number; empresas: number; nao_conferidas: number };
type Funcao = { id: string; nome: string; cbo: string | null; forma_pagamento: string; custo_hora_manual: number | null; unida_a_id: string | null; unida_a_nome: string | null; ativo: boolean; migrada_de: string | null; custo: CustoFuncao | null };
type ItemEquipe = {
  id: string; grupo_id: string; tipo: "pessoa" | "perfil"; funcionario_id: string | null; nome: string; funcao_id: string; funcao: string;
  vinculo: string; forma_pagamento: string; setor: string | null; quantidade_pessoas: number; horas_produtivas_mes: number;
  vigencia_inicio: string; conferido: boolean; ativo: boolean; matricula: string | null;
  ficha: (Partial<FichaCusto> & Record<string, unknown>) | null; custo: { custo_mensal: number | null; custo_hora: number | null; custo_m2: number | null } | null;
};
type Lista = { pode_ver_individual: boolean; encargos: Encargos & { fonte: string; vigencia_inicio: string | null }; funcoes: Funcao[]; equipe: ItemEquipe[] };

const brl = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`);
const numBR = (s: string) => { const n = Number(String(s ?? "").replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0 };
const VINCULOS = [{ v: "clt", l: "CLT" }, { v: "pj", l: "PJ / empreiteiro" }, { v: "diarista", l: "Diarista" }];
const FORMAS = [{ v: "mensal", l: "Mensal" }, { v: "hora", l: "Por hora" }, { v: "m2", l: "Por m² produzido" }, { v: "diaria", l: "Por diária" }];

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
  const [modal, setModal] = useState<null | { tipo: "funcao"; f?: Funcao } | { tipo: "ficha"; modo: "pessoa" | "perfil" | "editar"; item?: ItemEquipe } | { tipo: "encerrar"; item: ItemEquipe } | { tipo: "encargos" } | { tipo: "historico"; item: ItemEquipe } | { tipo: "unir"; f: Funcao }>(null);

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
          {pode && <button className={btnSec} onClick={() => setModal({ tipo: "encargos" })} data-testid="mao-obra-encargos-editar">Configurar encargos</button>}
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
              <th className="pr-2 text-right">Custo mensal</th><th className="pr-2 text-right">Custo da hora</th><th className="pr-2">Situação</th><th></th>
            </tr></thead>
            <tbody>
              {dados.equipe.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-[#3D2314]/60">Ninguém cadastrado ainda. Use “Novo funcionário” ou “Novo perfil padrão”.</td></tr>}
              {dados.equipe.map((i) => (
                <tr key={i.id} className="border-b border-[#3D2314]/5" data-testid={`mao-obra-linha-${i.grupo_id}`}>
                  <td className="py-2 pr-2">{i.nome}{i.tipo === "perfil" && <span className="ml-1 text-[11px] text-[#3D2314]/60">· perfil × {i.quantidade_pessoas}</span>}</td>
                  <td className="pr-2">{i.funcao}</td>
                  <td className="pr-2 uppercase text-[11px]">{i.vinculo}</td>
                  <td className="pr-2 text-right tabular-nums">{i.horas_produtivas_mes}</td>
                  <td className="pr-2 text-right tabular-nums" data-testid="mao-obra-custo-mensal">{pode ? brl(i.custo?.custo_mensal) : <Lock size={12} className="inline" />}</td>
                  <td className="pr-2 text-right tabular-nums" data-testid="mao-obra-custo-hora">{pode ? (i.custo?.custo_m2 != null ? `${brl(i.custo.custo_m2)}/m²` : brl(i.custo?.custo_hora)) : <Lock size={12} className="inline" />}</td>
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
              <th className="py-2 pr-2">Função</th><th className="pr-2">CBO</th><th className="pr-2">Pagamento</th><th className="pr-2 text-right">Custo da hora</th>
              <th className="pr-2">Origem</th><th className="pr-2 text-right">Pessoas conferidas</th><th className="pr-2 text-right">Não conferidas</th><th></th>
            </tr></thead>
            <tbody>
              {dados.funcoes.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-[#3D2314]/60">Nenhuma função ainda. Use “Nova função”.</td></tr>}
              {dados.funcoes.map((f) => (
                <tr key={f.id} className={`border-b border-[#3D2314]/5 ${f.ativo ? "" : "opacity-50"}`} data-testid={`mao-obra-funcao-${f.id}`}>
                  <td className="py-2 pr-2">{f.nome}{f.unida_a_nome && <span className="ml-1 text-[11px] text-[#3D2314]/60">· unida a {f.unida_a_nome}</span>}</td>
                  <td className="pr-2">{f.cbo ?? "—"}</td>
                  <td className="pr-2">{f.forma_pagamento === "m2" ? "m²" : f.forma_pagamento}</td>
                  <td className="pr-2 text-right tabular-nums" data-testid="mao-obra-funcao-custo">{f.custo?.custo_m2 != null ? `${brl(f.custo.custo_m2)}/m²` : brl(f.custo?.custo_hora)}</td>
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
function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-[12px]"><span className="text-[#3D2314]/70">{rotulo}</span>{children}</label>;
}

function ModalFuncao({ companyId, f, onClose, onSalvar }: { companyId: string; f?: Funcao; onClose: () => void; onSalvar: Salvar }) {
  const [nome, setNome] = useState(f?.nome ?? "");
  const [cbo, setCbo] = useState(f?.cbo ?? "");
  const [forma, setForma] = useState(f?.forma_pagamento ?? "hora");
  const [manual, setManual] = useState(f?.custo_hora_manual != null ? String(f.custo_hora_manual).replace(".", ",") : "");
  const [ativo, setAtivo] = useState(f?.ativo ?? true);
  return (
    <Janela titulo={f ? `Editar função · ${f.nome}` : "Nova função"} onClose={onClose} testid="mao-obra-modal-funcao">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Campo rotulo="Nome da função"><input className={inp} value={nome} onChange={(e) => setNome(e.target.value)} data-testid="funcao-nome" placeholder="Gesseiro" /></Campo>
        <Campo rotulo="CBO (opcional — casa a função entre as empresas do grupo)"><input className={inp} value={cbo} onChange={(e) => setCbo(e.target.value)} placeholder="7155-05" /></Campo>
        <Campo rotulo="Forma de pagamento"><select className={inp} value={forma} onChange={(e) => setForma(e.target.value)}><option value="hora">Por hora</option><option value="m2">Por m² produzido</option><option value="diaria">Por diária</option></select></Campo>
        <Campo rotulo="Custo/hora manual (só enquanto ninguém estiver conferido)"><input className={inp} value={manual} onChange={(e) => setManual(e.target.value)} inputMode="decimal" placeholder="opcional" /></Campo>
      </div>
      {f && <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Função ativa</label>}
      <div className="flex justify-end gap-2">
        <button className={btnSec} onClick={onClose}>Voltar</button>
        <button className={btnPri} data-testid="funcao-salvar" disabled={nome.trim().length < 2} onClick={async () => {
          if (await onSalvar("fn_mao_obra_funcao_salvar", { p_company_id: companyId, p_id: f?.id ?? null, p_dados: { nome, cbo, forma_pagamento: forma, custo_hora_manual: manual ? numBR(manual) : "", ativo } }, `Função ${nome} salva.`)) onClose();
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
      <select className={inp} value={alvo} onChange={(e) => setAlvo(e.target.value)}>
        <option value="">— não unir (separar) —</option>
        {funcoes.filter((x) => x.id !== f.id).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
      </select>
      <div className="flex justify-end gap-2">
        <button className={btnSec} onClick={onClose}>Voltar</button>
        <button className={btnPri} onClick={async () => { if (await onSalvar("fn_mao_obra_funcao_unir", { p_funcao_id: f.id, p_unir_a_id: alvo || null }, "Funções atualizadas.")) onClose(); }}>Salvar</button>
      </div>
    </Janela>
  );
}

const CAMPOS_VALOR: [keyof FichaCusto, string][] = [
  ["adicional_insalubridade", "Insalubridade (R$/mês)"], ["adicional_periculosidade", "Periculosidade (R$/mês)"], ["adicional_outros", "Outros adicionais (R$/mês)"],
  ["beneficio_vt", "Vale-transporte (já sem o desconto de 6%)"], ["beneficio_alimentacao", "Alimentação"], ["beneficio_saude", "Plano de saúde"],
  ["beneficio_seguro", "Seguro de vida"], ["beneficio_epi", "EPI e uniforme (por mês)"],
];

// Data de hoje no fuso de Brasília (UTC−3), para o campo "vale a partir de".
function hojeBR() { return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); }

function ModalFicha({ companyId, modo, item, funcoes, encargos, onClose, onSalvar }: { companyId: string; modo: "pessoa" | "perfil" | "editar"; item?: ItemEquipe; funcoes: Funcao[]; encargos: Encargos; onClose: () => void; onSalvar: Salvar }) {
  const f0 = item?.ficha ?? {};
  const tipo = modo === "editar" ? item?.tipo ?? "perfil" : modo;
  const [v, setV] = useState<Record<string, string>>(() => {
    const base: Record<string, string> = {
      funcao_id: String(item?.funcao_id ?? funcoes[0]?.id ?? ""), vinculo: String(f0.vinculo ?? "clt"), forma_pagamento: String(f0.forma_pagamento ?? "mensal"),
      salario: f0.salario != null ? String(f0.salario).replace(".", ",") : "", valor_unidade: f0.valor_unidade ? String(f0.valor_unidade).replace(".", ",") : "",
      dias_mes: String(f0.dias_mes ?? 22), horas_produtivas_mes: String(f0.horas_produtivas_mes ?? 176), quantidade_pessoas: String(f0.quantidade_pessoas ?? 1),
      descricao: String(f0.descricao ?? ""), setor: String(f0.setor ?? ""), vigencia_inicio: hojeBR(), motivo: "",
    };
    for (const [k] of CAMPOS_VALOR) base[k] = f0[k] ? String(f0[k]).replace(".", ",") : "";
    return base;
  });
  const [p, setP] = useState<Record<string, string>>({});
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((o) => ({ ...o, [k]: e.target.value }));
  const setPes = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setP((o) => ({ ...o, [k]: e.target.value }));
  const ficha: Partial<FichaCusto> = {
    vinculo: v.vinculo as FichaCusto["vinculo"], forma_pagamento: v.forma_pagamento as FichaCusto["forma_pagamento"],
    salario: numBR(v.salario), valor_unidade: numBR(v.valor_unidade), dias_mes: numBR(v.dias_mes) || 22, horas_produtivas_mes: numBR(v.horas_produtivas_mes) || 176,
    ...Object.fromEntries(CAMPOS_VALOR.map(([k]) => [k, numBR(v[k])])),
  };
  const calc = calcularCustoMaoObra(ficha, encargos);
  const corpoFicha = { ...ficha, tipo, funcao_id: v.funcao_id, descricao: v.descricao || null, setor: v.setor || null,
    quantidade_pessoas: tipo === "perfil" ? Math.max(1, Math.round(numBR(v.quantidade_pessoas))) : 1, vigencia_inicio: v.vigencia_inicio };
  const valorPorUnidade = v.vinculo === "diarista" || (v.vinculo === "pj" && v.forma_pagamento !== "mensal");
  const titulo = modo === "pessoa" ? "Novo funcionário" : modo === "perfil" ? "Novo perfil padrão (sem nome)" : `Editar / reajuste · ${item?.nome}`;

  async function salvar() {
    if (modo === "editar" && item) {
      if (await onSalvar("fn_mao_obra_ficha_reajustar", { p_ficha_id: item.id, p_dados: corpoFicha, p_vigencia: v.vigencia_inicio, p_motivo: v.motivo || "reajuste" }, "Reajuste salvo com histórico — confira para entrar no custo.")) onClose();
      return;
    }
    if (await onSalvar("fn_mao_obra_ficha_salvar", { p_company_id: companyId, p_ficha: corpoFicha, p_pessoa: tipo === "pessoa" ? p : null }, "Ficha salva — confira para entrar no custo da função.")) onClose();
  }

  return (
    <Janela titulo={titulo} onClose={onClose} testid="mao-obra-modal-ficha">
      {funcoes.length === 0 && <div className="rounded-md bg-[#FAEEDA] px-3 py-2 text-[12.5px]">Cadastre uma função antes (aba Funções → Nova função).</div>}
      {modo === "pessoa" && (
        <fieldset className="space-y-2">
          <legend className="text-[11px] uppercase tracking-wide text-[#3D2314]/60">Dados pessoais e de vínculo (cadastro compartilhado — o mesmo do SST)</legend>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Campo rotulo="Nome completo"><input className={inp} onChange={setPes("nome_completo")} data-testid="pessoa-nome" /></Campo>
            <Campo rotulo="CPF"><input className={inp} onChange={setPes("cpf")} data-testid="pessoa-cpf" /></Campo>
            <Campo rotulo="RG"><input className={inp} onChange={setPes("rg")} /></Campo>
            <Campo rotulo="Data de nascimento"><input type="date" className={inp} onChange={setPes("data_nascimento")} /></Campo>
            <Campo rotulo="Telefone"><input className={inp} onChange={setPes("telefone")} /></Campo>
            <Campo rotulo="E-mail"><input className={inp} onChange={setPes("email")} /></Campo>
            <Campo rotulo="CEP"><input className={inp} onChange={setPes("cep")} /></Campo>
            <Campo rotulo="Endereço"><input className={inp} onChange={setPes("logradouro")} /></Campo>
            <Campo rotulo="Número"><input className={inp} onChange={setPes("numero")} /></Campo>
            <Campo rotulo="Bairro"><input className={inp} onChange={setPes("bairro")} /></Campo>
            <Campo rotulo="Cidade"><input className={inp} onChange={setPes("cidade")} /></Campo>
            <Campo rotulo="UF"><input className={inp} maxLength={2} onChange={setPes("uf")} /></Campo>
            <Campo rotulo="Matrícula"><input className={inp} onChange={setPes("matricula")} /></Campo>
            <Campo rotulo="Data de admissão"><input type="date" className={inp} onChange={setPes("data_admissao")} /></Campo>
            <Campo rotulo="Cargo"><input className={inp} onChange={setPes("cargo")} /></Campo>
            <Campo rotulo="Setor"><input className={inp} onChange={setPes("setor")} /></Campo>
            <Campo rotulo="Obra atual"><input className={inp} onChange={setPes("obra_nome")} /></Campo>
          </div>
          <p className="text-[11px] text-[#3D2314]/60">Dados de saúde não entram aqui: ficam no SST.</p>
        </fieldset>
      )}
      <fieldset className="space-y-2">
        <legend className="text-[11px] uppercase tracking-wide text-[#3D2314]/60">Ficha de custo</legend>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Campo rotulo="Função"><select className={inp} value={v.funcao_id} onChange={set("funcao_id")} data-testid="ficha-funcao">{funcoes.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select></Campo>
          <Campo rotulo="Vínculo"><select className={inp} value={v.vinculo} onChange={set("vinculo")} data-testid="ficha-vinculo">{VINCULOS.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}</select></Campo>
          <Campo rotulo="Forma de pagamento"><select className={inp} value={v.forma_pagamento} onChange={set("forma_pagamento")}>{FORMAS.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}</select></Campo>
          {tipo === "perfil" && <>
            <Campo rotulo="Descrição do perfil"><input className={inp} value={v.descricao} onChange={set("descricao")} placeholder="Gesseiro padrão" /></Campo>
            <Campo rotulo="Quantidade de pessoas"><input className={inp} value={v.quantidade_pessoas} onChange={set("quantidade_pessoas")} inputMode="numeric" data-testid="ficha-quantidade" /></Campo>
            <Campo rotulo="Setor"><input className={inp} value={v.setor} onChange={set("setor")} /></Campo>
          </>}
          {!valorPorUnidade && <Campo rotulo={tipo === "perfil" ? "Salário médio (R$/mês)" : v.vinculo === "pj" ? "Valor mensal (R$)" : "Salário base (R$/mês)"}><input className={inp} value={v.salario} onChange={set("salario")} inputMode="decimal" data-testid="ficha-salario" /></Campo>}
          {valorPorUnidade && <Campo rotulo={v.vinculo === "diarista" || v.forma_pagamento === "diaria" ? "Valor da diária (R$)" : v.forma_pagamento === "m2" ? "Valor por m² (R$)" : "Valor por hora (R$)"}><input className={inp} value={v.valor_unidade} onChange={set("valor_unidade")} inputMode="decimal" /></Campo>}
          {v.vinculo === "diarista" && <Campo rotulo="Dias por mês"><input className={inp} value={v.dias_mes} onChange={set("dias_mes")} inputMode="decimal" /></Campo>}
          <Campo rotulo="Horas produtivas por mês (padrão 176)"><input className={inp} value={v.horas_produtivas_mes} onChange={set("horas_produtivas_mes")} inputMode="decimal" data-testid="ficha-horas" /></Campo>
          {CAMPOS_VALOR.map(([k, l]) => (v.vinculo === "clt" || !k.startsWith("adicional_")) && (
            <Campo key={k} rotulo={l}><input className={inp} value={v[k]} onChange={set(k)} inputMode="decimal" data-testid={`ficha-${k}`} /></Campo>
          ))}
          <Campo rotulo={modo === "editar" ? "Vale a partir de (reajuste)" : "Vale a partir de"}><input type="date" className={inp} value={v.vigencia_inicio} onChange={set("vigencia_inicio")} /></Campo>
          {modo === "editar" && <Campo rotulo="Motivo (ex.: dissídio, promoção, correção)"><input className={inp} value={v.motivo} onChange={set("motivo")} /></Campo>}
        </div>
      </fieldset>
      <div className="rounded-md border border-[#C8941A]/50 bg-white px-3 py-2 text-[12.5px] grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="ficha-calculo">
        <div>Remuneração + 13º e férias<br /><b>{brl(calc.remuneracao)}</b></div>
        <div>Encargos ({pct(encargos.encargos_folha_pct)}){encargos.provisorio && <span className="text-[#8A5A00]"> · provisórios</span>}<br /><b>{brl(calc.encargos)}</b></div>
        <div>Custo mensal{tipo === "perfil" ? " (por pessoa)" : ""}<br /><b data-testid="ficha-custo-mensal">{brl(calc.custo_mensal)}</b></div>
        <div>{calc.custo_m2 != null ? "Custo por m²" : "Custo da hora produtiva"}<br /><b data-testid="ficha-custo-hora">{calc.custo_m2 != null ? brl(calc.custo_m2) : brl(calc.custo_hora)}</b></div>
      </div>
      <p className="text-[11px] text-[#3D2314]/60">Depois de salvar, a ficha fica “não conferida” e não entra no custo da função até alguém conferir.</p>
      <div className="flex justify-end gap-2">
        <button className={btnSec} onClick={onClose}>Voltar</button>
        <button className={btnPri} onClick={() => void salvar()} disabled={!v.funcao_id || (modo === "pessoa" && (p.nome_completo ?? "").trim().length < 3)} data-testid="ficha-salvar">Salvar</button>
      </div>
    </Janela>
  );
}

function ModalEncerrar({ item, onClose, onSalvar }: { item: ItemEquipe; onClose: () => void; onSalvar: Salvar }) {
  const [data, setData] = useState(hojeBR);
  const [motivo, setMotivo] = useState("");
  const pessoa = item.tipo === "pessoa";
  return (
    <Janela titulo={pessoa ? `Desligar ${item.nome}` : `Inativar perfil ${item.nome}`} onClose={onClose} testid="mao-obra-modal-encerrar">
      <p className="text-[12.5px] text-[#3D2314]/70">{pessoa ? "A pessoa fica desligada (data de demissão no cadastro compartilhado) e sai do custo da função. Nada é apagado." : "O perfil sai do custo da função. Nada é apagado."}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Campo rotulo={pessoa ? "Data do desligamento" : "Data"}><input type="date" className={inp} value={data} onChange={(e) => setData(e.target.value)} /></Campo>
        <Campo rotulo="Motivo"><input className={inp} value={motivo} onChange={(e) => setMotivo(e.target.value)} data-testid="encerrar-motivo" /></Campo>
      </div>
      <div className="flex justify-end gap-2">
        <button className={btnSec} onClick={onClose}>Voltar</button>
        <button className={btnPri} disabled={motivo.trim().length < 3} data-testid="encerrar-confirmar" onClick={async () => { if (await onSalvar("fn_mao_obra_ficha_encerrar", { p_ficha_id: item.id, p_data: data, p_motivo: motivo }, pessoa ? `${item.nome} desligado.` : "Perfil inativado.")) onClose(); }}>{pessoa ? "Desligar" : "Inativar"}</button>
      </div>
    </Janela>
  );
}

function ModalEncargos({ companyId, enc, onClose, onSalvar }: { companyId: string; enc: Encargos; onClose: () => void; onSalvar: Salvar }) {
  const [v, setV] = useState<Record<string, string>>(() => ({
    regime: enc.regime, simples_anexo: enc.simples_anexo ?? "", inss_patronal_pct: String(enc.inss_patronal_pct), rat_pct: String(enc.rat_pct), fap: String(enc.fap),
    terceiros_pct: String(enc.terceiros_pct), fgts_pct: String(enc.fgts_pct), prov_13_pct: String(enc.prov_13_pct), prov_ferias_pct: String(enc.prov_ferias_pct),
    prov_rescisao_pct: String(enc.prov_rescisao_pct), desoneracao: enc.desoneracao ? "1" : "", desoneracao_fator_folha: String(enc.desoneracao ? enc.desoneracao_fator_folha : fatorFolhaReoneracao(new Date().getFullYear())),
    cprb_pct: enc.cprb_pct != null ? String(enc.cprb_pct) : "", vigencia_inicio: hojeBR(),
  }));
  const [confirmar, setConfirmar] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((o) => ({ ...o, [k]: e.target.value }));
  const total = encargosFolhaPct({ inss_patronal_pct: numBR(v.inss_patronal_pct), desoneracao_fator_folha: v.desoneracao ? numBR(v.desoneracao_fator_folha) : 1, rat_pct: numBR(v.rat_pct), fap: numBR(v.fap), terceiros_pct: numBR(v.terceiros_pct), fgts_pct: numBR(v.fgts_pct) });
  function aplicarPadrao(anexo: string) {
    if (v.regime !== "simples") setV((o) => ({ ...o, inss_patronal_pct: "20", rat_pct: "3", terceiros_pct: "5,8", fgts_pct: "8" }));
    else if (anexo === "IV") setV((o) => ({ ...o, simples_anexo: anexo, inss_patronal_pct: "20", rat_pct: "3", terceiros_pct: "0", fgts_pct: "8" }));
    else setV((o) => ({ ...o, simples_anexo: anexo, inss_patronal_pct: "0", rat_pct: "0", terceiros_pct: "0", fgts_pct: "8" }));
  }
  return (
    <Janela titulo="Encargos da empresa (quem emprega)" onClose={onClose} testid="mao-obra-modal-encargos">
      <p className="text-[12px] text-[#3D2314]/70">Ficam “provisórios” até o contador confirmar. Nos Anexos III e V do Simples o INSS patronal está dentro do DAS (só FGTS na folha); no Anexo IV (obra) o INSS patronal e o RAT são pagos fora do DAS.</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Campo rotulo="Regime"><select className={inp} value={v.regime} onChange={set("regime")}><option value="simples">Simples</option><option value="presumido">Lucro Presumido</option><option value="real">Lucro Real</option></select></Campo>
        {v.regime === "simples" && <Campo rotulo="Anexo do Simples"><select className={inp} value={v.simples_anexo} onChange={(e) => aplicarPadrao(e.target.value)}><option value="">—</option>{["I", "II", "III", "IV", "V"].map((a) => <option key={a} value={a}>Anexo {a}</option>)}</select></Campo>}
        <Campo rotulo="INSS patronal %"><input className={inp} value={v.inss_patronal_pct} onChange={set("inss_patronal_pct")} /></Campo>
        <Campo rotulo="RAT %"><input className={inp} value={v.rat_pct} onChange={set("rat_pct")} /></Campo>
        <Campo rotulo="FAP"><input className={inp} value={v.fap} onChange={set("fap")} /></Campo>
        <Campo rotulo="Terceiros %"><input className={inp} value={v.terceiros_pct} onChange={set("terceiros_pct")} /></Campo>
        <Campo rotulo="FGTS %"><input className={inp} value={v.fgts_pct} onChange={set("fgts_pct")} /></Campo>
        <Campo rotulo="13º %"><input className={inp} value={v.prov_13_pct} onChange={set("prov_13_pct")} /></Campo>
        <Campo rotulo="Férias + 1/3 %"><input className={inp} value={v.prov_ferias_pct} onChange={set("prov_ferias_pct")} /></Campo>
        <Campo rotulo="Rescisão %"><input className={inp} value={v.prov_rescisao_pct} onChange={set("prov_rescisao_pct")} /></Campo>
        <Campo rotulo="Vale a partir de"><input type="date" className={inp} value={v.vigencia_inicio} onChange={set("vigencia_inicio")} /></Campo>
      </div>
      <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={!!v.desoneracao} onChange={(e) => setV((o) => ({ ...o, desoneracao: e.target.checked ? "1" : "" }))} data-testid="encargos-desoneracao" /> Desoneração da folha (CPRB) — reoneração gradual</label>
      {v.desoneracao && (
        <div className="grid grid-cols-2 gap-2">
          <Campo rotulo={`Parte do INSS patronal na folha (${new Date().getFullYear()}: ${fatorFolhaReoneracao(new Date().getFullYear()) * 100}%)`}><input className={inp} value={v.desoneracao_fator_folha} onChange={set("desoneracao_fator_folha")} /></Campo>
          <Campo rotulo="CPRB sobre a receita % (vai para os impostos da venda, não para a hora)"><input className={inp} value={v.cprb_pct} onChange={set("cprb_pct")} /></Campo>
        </div>
      )}
      <div className="text-[12.5px]">Encargos da folha: <b>{pct(total)}</b></div>
      <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={confirmar} onChange={(e) => setConfirmar(e.target.checked)} data-testid="encargos-confirmar" /> O contador confirmou estes percentuais</label>
      <div className="flex justify-end gap-2">
        <button className={btnSec} onClick={onClose}>Voltar</button>
        <button className={btnPri} data-testid="encargos-salvar" onClick={async () => {
          const dados = { ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, ["regime", "simples_anexo", "vigencia_inicio"].includes(k) ? x : k === "desoneracao" ? !!x : x === "" ? null : numBR(x)])) };
          if (await onSalvar("fn_mao_obra_encargos_salvar", { p_company_id: companyId, p_dados: dados, p_confirmar: confirmar }, confirmar ? "Encargos confirmados pelo contador." : "Encargos salvos (provisórios até o contador confirmar).")) onClose();
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
