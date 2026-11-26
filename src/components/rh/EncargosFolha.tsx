'use client'
// Indústria · RH · Folha › Encargos (CEO 25/11) — editor FOCADO nos encargos do empregador (quem emprega): regime,
// INSS patronal, RAT, FAP, terceiros, FGTS, provisões (13º/férias/rescisão), desoneração (CPRB) e a confirmação do
// contador. Lê e grava pelos MESMOS RPCs da tela de Mão de obra (fn_mao_obra_encargos_vigentes /
// fn_mao_obra_encargos_salvar) — os percentuais já alimentam o custo da hora. Os PADRÕES DA FICHA (benefícios,
// vínculo, horas, incidência) continuam na tela de Mão de obra; aqui eles são PRESERVADOS intactos no salvar
// (round-trip), porque o salvar faz INSERT…ON CONFLICT com defaults e, sem o round-trip, zeraria a configuração da
// empresa (RD-97). Design PS premium (RD-96); "?" por campo (RD-95), reusando a ajuda publicada da Mão de obra.
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'
import { encargosFolhaPct, fatorFolhaReoneracao, rpaInssPadrao } from '@/lib/hub/custoMaoObra'

// A ajuda ("?") é buscada por rota (fn_ajuda_campo_listar). Os campos de encargos têm a ajuda publicada na tela de
// Mão de obra; apontamos o "?" para lá em vez de duplicar o conteúdo no banco.
const AJUDA_ROTA = '/dashboard/projetos/mao-obra'

type Padroes = {
  vinculo?: string; forma_pagamento?: string; horas_produtivas_mes?: number; dsr_fator?: number
  rpa_inss_pct?: number; salario_minimo?: number; incidencia?: Record<string, unknown>
  beneficio_vt?: number; beneficio_alimentacao?: number; beneficio_saude?: number; beneficio_seguro?: number; beneficio_epi?: number
}
type EncargosVig = {
  provisorio: boolean; regime: 'simples' | 'presumido' | 'real'; simples_anexo: string | null
  inss_patronal_pct: number; rat_pct: number; fap: number; terceiros_pct: number; fgts_pct: number
  desoneracao: boolean; desoneracao_fator_folha: number; cprb_pct: number | null
  prov_13_pct: number; prov_ferias_pct: number; prov_rescisao_pct: number; encargos_folha_pct: number
  confirmado_em: string | null; vigencia_inicio: string | null; fonte?: string; padroes?: Padroes
}

const inp = 'w-full border border-[#3D2314]/15 rounded-md px-2 py-1.5 text-[13px] text-[#3D2314] bg-white'
const btnPri = 'px-3 py-2 rounded-md bg-[#C8941A] text-[#3D2314] font-medium text-[13px] hover:bg-[#B07F12] disabled:opacity-50 inline-flex items-center gap-1.5'
const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${Number(x).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`)
const numBR = (s: string) => { const n = Number(String(s ?? '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0 }
const txt = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n).replace('.', ','))
// "hoje" no fuso de Brasília (evita virar o dia no UTC).
function hojeBR() { return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10) }

function Campo({ rotulo, ajuda, children }: { rotulo: React.ReactNode; ajuda?: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-[12px]"><span className="text-[#3D2314]/70">{rotulo}{ajuda && <AjudaCampo chave={ajuda} rota={AJUDA_ROTA} />}</span>{children}</label>
}

export function EncargosFolha() {
  const { sel, companies } = useCompanyIds()
  const companyId = sel && !sel.startsWith('group_') && sel !== 'consolidado' ? sel : null
  const empresa = companies.find((c) => c.id === companyId)

  const [enc, setEnc] = useState<EncargosVig | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [v, setV] = useState<Record<string, string>>({})
  const [confirmar, setConfirmar] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!companyId) return
    setCarregando(true); setErro(null); setMsg(null)
    const { data, error } = await supabase.rpc('fn_mao_obra_encargos_vigentes', { p_company_id: companyId })
    setCarregando(false)
    if (error || !data) { setErro(erroAmigavel(error)); return }
    const e = data as EncargosVig
    setEnc(e)
    setConfirmar(false)
    setV({
      regime: e.regime, simples_anexo: e.simples_anexo ?? '',
      inss_patronal_pct: txt(e.inss_patronal_pct), rat_pct: txt(e.rat_pct), fap: txt(e.fap),
      terceiros_pct: txt(e.terceiros_pct), fgts_pct: txt(e.fgts_pct),
      prov_13_pct: txt(e.prov_13_pct), prov_ferias_pct: txt(e.prov_ferias_pct), prov_rescisao_pct: txt(e.prov_rescisao_pct),
      desoneracao: e.desoneracao ? '1' : '',
      desoneracao_fator_folha: txt(e.desoneracao ? e.desoneracao_fator_folha : fatorFolhaReoneracao(new Date().getFullYear())),
      cprb_pct: e.cprb_pct != null ? txt(e.cprb_pct) : '',
      vigencia_inicio: hojeBR(),
    })
  }, [companyId])

  useEffect(() => { void carregar() }, [carregar])

  const set = (k: string) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((o) => ({ ...o, [k]: ev.target.value }))

  // Presets por regime/anexo (mesma regra da tela de Mão de obra).
  function aplicarPadrao(anexo: string) {
    if (v.regime !== 'simples') setV((o) => ({ ...o, inss_patronal_pct: '20', rat_pct: '3', terceiros_pct: '5,8', fgts_pct: '8' }))
    else if (anexo === 'IV') setV((o) => ({ ...o, simples_anexo: anexo, inss_patronal_pct: '20', rat_pct: '3', terceiros_pct: '0', fgts_pct: '8' }))
    else setV((o) => ({ ...o, simples_anexo: anexo, inss_patronal_pct: '0', rat_pct: '0', terceiros_pct: '0', fgts_pct: '8' }))
  }

  const total = encargosFolhaPct({
    inss_patronal_pct: numBR(v.inss_patronal_pct), desoneracao_fator_folha: v.desoneracao ? numBR(v.desoneracao_fator_folha) : 1,
    rat_pct: numBR(v.rat_pct), fap: numBR(v.fap), terceiros_pct: numBR(v.terceiros_pct), fgts_pct: numBR(v.fgts_pct),
  })

  async function salvar() {
    if (!companyId || !enc) return
    if (!['simples', 'presumido', 'real'].includes(v.regime)) { setErro('Informe o regime (Simples, Lucro Presumido ou Lucro Real).'); return }
    setSalvando(true); setErro(null); setMsg(null)
    const p = enc.padroes ?? {}
    const forma = p.forma_pagamento === 'm2' ? 'producao' : (p.forma_pagamento ?? 'mensal')
    const dados: Record<string, unknown> = {
      regime: v.regime, simples_anexo: v.simples_anexo || null, vigencia_inicio: v.vigencia_inicio,
      inss_patronal_pct: numBR(v.inss_patronal_pct), rat_pct: numBR(v.rat_pct), fap: numBR(v.fap),
      terceiros_pct: numBR(v.terceiros_pct), fgts_pct: numBR(v.fgts_pct),
      prov_13_pct: numBR(v.prov_13_pct), prov_ferias_pct: numBR(v.prov_ferias_pct), prov_rescisao_pct: numBR(v.prov_rescisao_pct),
      desoneracao: !!v.desoneracao,
      desoneracao_fator_folha: v.desoneracao ? numBR(v.desoneracao_fator_folha) : 1,
      cprb_pct: v.desoneracao && v.cprb_pct !== '' ? numBR(v.cprb_pct) : null,
      // PADRÕES DA FICHA — enviados de volta INTACTOS; sem isto o salvar (INSERT…ON CONFLICT com defaults) os zeraria (RD-97).
      horas_produtivas_padrao: p.horas_produtivas_mes ?? 176,
      vinculo_padrao: p.vinculo ?? 'clt', forma_padrao: forma,
      beneficio_vt_padrao: p.beneficio_vt ?? 0, beneficio_alimentacao_padrao: p.beneficio_alimentacao ?? 0,
      beneficio_saude_padrao: p.beneficio_saude ?? 0, beneficio_seguro_padrao: p.beneficio_seguro ?? 0, beneficio_epi_padrao: p.beneficio_epi ?? 0,
      dsr_fator: p.dsr_fator ?? 0.16667, salario_minimo_ref: p.salario_minimo ?? 1518,
      incidencia_padrao: p.incidencia ?? {},
    }
    // INSS do autônomo (RPA) igual à regra do regime = sem valor próprio (segue o regime se ele mudar).
    const rpaAtual = p.rpa_inss_pct
    dados.rpa_inss_pct = (rpaAtual == null || rpaAtual === rpaInssPadrao(v.regime, v.simples_anexo)) ? null : rpaAtual
    const { error } = await supabase.rpc('fn_mao_obra_encargos_salvar', { p_company_id: companyId, p_dados: dados, p_confirmar: confirmar })
    setSalvando(false)
    if (error) { setErro(erroAmigavel(error)); return }
    setMsg(confirmar ? 'Padrões salvos — encargos confirmados pelo contador.' : 'Padrões salvos.')
    await carregar()
  }

  if (!companyId) {
    return (
      <div className="rounded-md border border-[#3D2314]/15 bg-white px-4 py-6 text-[13px] text-[#3D2314]/70" data-testid="folha-encargos-sem-empresa">
        Selecione uma empresa (no seletor do topo) para ver e ajustar os encargos da folha.
      </div>
    )
  }

  return (
    <div className="space-y-4" data-testid="folha-encargos">
      {/* Resumo do que vale hoje */}
      {enc && (
        <div className={`rounded-md border px-3 py-2 text-[12.5px] ${enc.provisorio ? 'border-[#C8941A]/60 bg-[#FAEEDA]/60' : 'border-[#3D2314]/15 bg-[#FAF7F2]'}`} data-testid="folha-encargos-resumo">
          {enc.provisorio
            ? <><AlertTriangle size={13} className="inline -mt-0.5 mr-1" /><b>Encargos provisórios</b> — valem até o contador confirmar; o custo da hora já usa estes valores. </>
            : <><CheckCircle2 size={13} className="inline -mt-0.5 mr-1" />Encargos confirmados pelo contador. </>}
          <AjudaCampo chave="projetos.mao_obra.padrao.resumo" rota={AJUDA_ROTA} />
          {empresa?.nome_fantasia ? <> · {empresa.nome_fantasia}</> : null}
          {' '}· encargos da folha <b data-testid="folha-encargos-total">{pct(total)}</b>
          {' '}· 13º {pct(numBR(v.prov_13_pct))} · férias {pct(numBR(v.prov_ferias_pct))} · rescisão {pct(numBR(v.prov_rescisao_pct))}
        </div>
      )}

      {erro && <div className="rounded-md border border-[#791F1F]/30 bg-[#FBEAEA] px-3 py-2 text-[12.5px] text-[#791F1F]" data-testid="folha-encargos-erro">{erro}</div>}
      {msg && <div className="rounded-md border border-[#2E8B57]/30 bg-[#EAF6EE] px-3 py-2 text-[12.5px] text-[#1F5130]" data-testid="folha-encargos-ok">{msg}</div>}

      <p className="text-[12px] text-[#3D2314]/70">
        Ficam “provisórios” até o contador confirmar. Nos Anexos III e V do Simples o INSS patronal está dentro do DAS
        (só FGTS na folha); no Anexo IV (obra) o INSS patronal e o RAT são pagos fora do DAS.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Campo ajuda="projetos.mao_obra.padrao.regime" rotulo="Regime">
          <select className={inp} value={v.regime ?? ''} onChange={set('regime')} data-testid="folha-regime">
            <option value="simples">Simples</option><option value="presumido">Lucro Presumido</option><option value="real">Lucro Real</option>
          </select>
        </Campo>
        {v.regime === 'simples' && (
          <Campo ajuda="projetos.mao_obra.padrao.anexo" rotulo="Anexo do Simples">
            <select className={inp} value={v.simples_anexo ?? ''} onChange={(e) => aplicarPadrao(e.target.value)} data-testid="folha-anexo">
              <option value="">—</option>{['I', 'II', 'III', 'IV', 'V'].map((a) => <option key={a} value={a}>Anexo {a}</option>)}
            </select>
          </Campo>
        )}
        <Campo ajuda="projetos.mao_obra.padrao.inss" rotulo="INSS patronal %"><input className={inp} value={v.inss_patronal_pct ?? ''} onChange={set('inss_patronal_pct')} inputMode="decimal" data-testid="folha-inss" /></Campo>
        <Campo ajuda="projetos.mao_obra.padrao.rat" rotulo="RAT %"><input className={inp} value={v.rat_pct ?? ''} onChange={set('rat_pct')} inputMode="decimal" data-testid="folha-rat" /></Campo>
        <Campo ajuda="projetos.mao_obra.padrao.fap" rotulo="FAP"><input className={inp} value={v.fap ?? ''} onChange={set('fap')} inputMode="decimal" data-testid="folha-fap" /></Campo>
        <Campo ajuda="projetos.mao_obra.padrao.terceiros" rotulo="Terceiros %"><input className={inp} value={v.terceiros_pct ?? ''} onChange={set('terceiros_pct')} inputMode="decimal" data-testid="folha-terceiros" /></Campo>
        <Campo ajuda="projetos.mao_obra.padrao.fgts" rotulo="FGTS %"><input className={inp} value={v.fgts_pct ?? ''} onChange={set('fgts_pct')} inputMode="decimal" data-testid="folha-fgts" /></Campo>
        <Campo ajuda="projetos.mao_obra.padrao.provisoes" rotulo="13º %"><input className={inp} value={v.prov_13_pct ?? ''} onChange={set('prov_13_pct')} inputMode="decimal" data-testid="folha-13" /></Campo>
        <Campo ajuda="projetos.mao_obra.padrao.provisoes" rotulo="Férias + 1/3 %"><input className={inp} value={v.prov_ferias_pct ?? ''} onChange={set('prov_ferias_pct')} inputMode="decimal" data-testid="folha-ferias" /></Campo>
        <Campo ajuda="projetos.mao_obra.padrao.provisoes" rotulo="Rescisão %"><input className={inp} value={v.prov_rescisao_pct ?? ''} onChange={set('prov_rescisao_pct')} inputMode="decimal" data-testid="folha-rescisao" /></Campo>
        <Campo ajuda="projetos.mao_obra.padrao.vigencia" rotulo="Vale a partir de"><input type="date" className={inp} value={v.vigencia_inicio ?? ''} onChange={set('vigencia_inicio')} data-testid="folha-vigencia" /></Campo>
      </div>

      <label className="flex items-center gap-2 text-[12.5px]">
        <input type="checkbox" checked={!!v.desoneracao} onChange={(e) => setV((o) => ({ ...o, desoneracao: e.target.checked ? '1' : '' }))} data-testid="folha-encargos-desoneracao" />
        Desoneração da folha (CPRB) — reoneração gradual<AjudaCampo chave="projetos.mao_obra.padrao.desoneracao" rota={AJUDA_ROTA} />
      </label>
      {v.desoneracao && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Campo ajuda="projetos.mao_obra.padrao.desoneracao" rotulo={`Parte do INSS patronal na folha (${new Date().getFullYear()}: ${fatorFolhaReoneracao(new Date().getFullYear()) * 100}%)`}>
            <input className={inp} value={v.desoneracao_fator_folha ?? ''} onChange={set('desoneracao_fator_folha')} inputMode="decimal" data-testid="folha-desoneracao-fator" />
          </Campo>
          <Campo ajuda="projetos.mao_obra.padrao.desoneracao" rotulo="CPRB sobre a receita % (vai para os impostos da venda, não para a hora)">
            <input className={inp} value={v.cprb_pct ?? ''} onChange={set('cprb_pct')} inputMode="decimal" data-testid="folha-cprb" />
          </Campo>
        </div>
      )}

      <div className="text-[13px]">Encargos da folha: <b>{pct(total)}</b></div>

      <label className="flex items-center gap-2 text-[12.5px]">
        <input type="checkbox" checked={confirmar} onChange={(e) => setConfirmar(e.target.checked)} data-testid="folha-encargos-confirmar" />
        O contador confirmou estes percentuais<AjudaCampo chave="projetos.mao_obra.padrao.confirmado" rota={AJUDA_ROTA} />
      </label>

      <div className="flex justify-end">
        <button className={btnPri} onClick={() => void salvar()} disabled={salvando || carregando} data-testid="folha-encargos-salvar">
          {salvando ? 'Salvando…' : 'Salvar encargos'}
        </button>
      </div>
    </div>
  )
}

export default EncargosFolha
