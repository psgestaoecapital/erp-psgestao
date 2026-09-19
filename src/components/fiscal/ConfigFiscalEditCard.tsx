'use client'

// fiscal-config-tela-editavel-v1
// Card editavel pros passos 2-5 do checklist fiscal:
//   2) Emissor (NFSe Nacional gov.br ou Focus NFe)
//   3) Municipio IBGE (com checagem de adesao on-blur)
//   4) Inscricao Municipal
//   5) Serie + proximo numero
// RPC: fn_fiscal_salvar_config(...)

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ChevronDown, ChevronUp, Loader2, CheckCircle2, XCircle, Save } from 'lucide-react'

type Provider = 'gov_nfse_nacional' | 'focusnfe'
type Ambiente = 'producao' | 'homologacao'

interface ChecklistItem {
  passo: number
  titulo: string
  ok: boolean
  valor?: string | null
  ambiente?: string | null
  aderido?: boolean | null
  serie?: string | null
  proximo?: number | null
  opcao_sn?: number | null
  apuracao_sn?: number | null
  pct_trib?: number | string | null
  regime?: string | null
  vault_id_presente?: boolean
}

interface ChecklistResp {
  ok: boolean
  total?: number
  concluidos?: number
  pronto_para_emitir?: boolean
  // Opcional de propósito: quando ok===false (ex.: sem vínculo à empresa) a RPC NÃO manda `itens`.
  itens?: ChecklistItem[]
  erro?: string
}

interface Props {
  companyId: string
  imAtual?: string | null
  onSalvo?: () => void
}

export default function ConfigFiscalEditCard({ companyId, imAtual, onSalvo }: Props) {
  const [aberto, setAberto] = useState(true)
  const [provider, setProvider] = useState<Provider>('gov_nfse_nacional')
  const [ambiente, setAmbiente] = useState<Ambiente>('homologacao')
  const [municipio, setMunicipio] = useState('')
  const [inscricaoMunicipal, setInscricaoMunicipal] = useState('')
  const [serie, setSerie] = useState('900')
  const [proximo, setProximo] = useState('1')
  const [regime, setRegime] = useState('simples_nacional')
  const [opcaoSN, setOpcaoSN] = useState('3')
  const [apuracaoSN, setApuracaoSN] = useState('1')
  const [pctTrib, setPctTrib] = useState('')
  const [aderidoSelo, setAderidoSelo] = useState<null | boolean>(null)
  const [checkingAderencia, setCheckingAderencia] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [resumo, setResumo] = useState<ChecklistResp | null>(null)
  // fiscal-token-vault-self-service-v1
  const [token, setToken] = useState('')
  const [salvandoToken, setSalvandoToken] = useState(false)
  const [trocarToken, setTrocarToken] = useState(false)
  // #90 / Focus #242149 · Reforma Tributária (IBS/CBS) — OPCIONAL, recolhida, desligada por padrão.
  const [reformaAberto, setReformaAberto] = useState(false)
  const [rfFinalidade, setRfFinalidade] = useState('')
  const [rfConsumidor, setRfConsumidor] = useState('')
  const [rfIndDest, setRfIndDest] = useState('')
  const [rfCst, setRfCst] = useState('')
  const [rfClassif, setRfClassif] = useState('')
  const [salvandoReforma, setSalvandoReforma] = useState(false)
  // #90 paridade OMIE · alíquota efetiva do Simples por competência (mês). Bloqueia a emissão quando falta.
  const mesAtualISO = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })()
  const [aliqCompetencia, setAliqCompetencia] = useState(mesAtualISO)
  const [aliqValor, setAliqValor] = useState('')
  const [salvandoAliq, setSalvandoAliq] = useState(false)

  // carrega checklist inicial pra pre-preencher
  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data, error } = await supabase.rpc('fn_fiscal_config_checklist', { p_company_id: companyId })
      if (!alive || error) return
      const c = data as ChecklistResp
      setResumo(c)
      // HOTFIX 0829eca5: quando o usuário não tem vínculo à empresa, a RPC devolve {ok:false} SEM
      // `itens`. NUNCA acessar .itens sem checar o array — era o TypeError que derrubava a tela.
      if (!c || c.ok === false || !Array.isArray(c.itens)) {
        if (c?.erro) setErro(c.erro)
        return
      }
      const passo2 = c.itens.find((i) => i.passo === 2)
      const passo3 = c.itens.find((i) => i.passo === 3)
      const passo4 = c.itens.find((i) => i.passo === 4)
      const passo5 = c.itens.find((i) => i.passo === 5)
      if (passo2?.valor) setProvider(passo2.valor as Provider)
      if (passo2?.ambiente) setAmbiente(passo2.ambiente as Ambiente)
      if (passo2?.opcao_sn != null) setOpcaoSN(String(passo2.opcao_sn))
      if (passo2?.apuracao_sn != null) setApuracaoSN(String(passo2.apuracao_sn))
      if (passo2?.pct_trib != null) setPctTrib(String(passo2.pct_trib))
      if (passo2?.regime) setRegime(passo2.regime)
      // Badge de adesão vem SEMPRE do vivo (erp_gov_nfse_municipios via RPC), nunca do valor
      // persistido no checklist — que fica stale (RD-52: uma fonte só de verdade).
      if (passo3?.valor) { setMunicipio(passo3.valor); void checarAderencia(passo3.valor) }
      if (passo4?.valor) setInscricaoMunicipal(passo4.valor)
      else if (imAtual) setInscricaoMunicipal(imAtual)
      if (passo5?.serie) setSerie(passo5.serie)
      if (passo5?.proximo != null) setProximo(String(passo5.proximo))
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  // #90 · carrega os valores atuais da Reforma (IBS/CBS) da config, para pré-preencher a seção recolhida.
  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data } = await supabase
        .from('erp_fiscal_provider_config')
        .select('reforma_finalidade_emissao, reforma_consumidor_final, reforma_indicador_destinatario, reforma_ibs_cbs_cst, reforma_ibs_cbs_classif_trib')
        .eq('company_id', companyId).eq('provider', 'focusnfe').eq('ativo', true).maybeSingle()
      if (!alive || !data) return
      const d = data as Record<string, unknown>
      setRfFinalidade(d.reforma_finalidade_emissao != null ? String(d.reforma_finalidade_emissao) : '')
      setRfConsumidor(d.reforma_consumidor_final != null ? String(d.reforma_consumidor_final) : '')
      setRfIndDest(d.reforma_indicador_destinatario != null ? String(d.reforma_indicador_destinatario) : '')
      setRfCst((d.reforma_ibs_cbs_cst as string | null) ?? '')
      setRfClassif((d.reforma_ibs_cbs_classif_trib as string | null) ?? '')
    })()
    return () => { alive = false }
  }, [companyId])

  async function salvarReforma() {
    setErro(null); setToast(null); setSalvandoReforma(true)
    const { data, error } = await supabase.rpc('fn_fiscal_reforma_salvar', {
      p_company_id: companyId,
      p_campos: {
        finalidade_emissao: rfFinalidade, consumidor_final: rfConsumidor, indicador_destinatario: rfIndDest,
        ibs_cbs_cst: rfCst, ibs_cbs_classif_trib: rfClassif,
      },
    })
    setSalvandoReforma(false)
    if (error) { setErro(error.message); return }
    const r = data as { ok?: boolean; erro?: string }
    if (!r?.ok) { setErro(r?.erro === 'config_focusnfe_nao_encontrada' ? 'Configure o emissor Focus antes de preencher a Reforma.' : (r?.erro ?? 'Erro ao salvar')); return }
    setToast('✅ Campos da Reforma (IBS/CBS) salvos.')
    onSalvo?.(); setTimeout(() => setToast(null), 4000)
  }

  async function salvarAliquota() {
    setErro(null); setToast(null)
    const v = Number(String(aliqValor).replace(',', '.'))
    if (!aliqCompetencia || !Number.isFinite(v) || v < 0 || v > 100) { setErro('Informe a competência (mês) e a alíquota (0–100).'); return }
    setSalvandoAliq(true)
    const { data, error } = await supabase.rpc('fn_fiscal_aliquota_sn_salvar', {
      p_company_id: companyId, p_competencia: `${aliqCompetencia}-01`, p_aliquota: v,
    })
    setSalvandoAliq(false)
    if (error) { setErro(error.message); return }
    const r = data as { ok?: boolean; erro?: string }
    if (!r?.ok) { setErro(r?.erro ?? 'Erro ao salvar alíquota'); return }
    setToast(`✅ Alíquota do Simples de ${aliqCompetencia} salva: ${v}%`)
    onSalvo?.(); setTimeout(() => setToast(null), 4000)
  }

  async function checarAderencia(codigo: string) {
    if (!/^\d{7}$/.test(codigo)) { setAderidoSelo(null); return }
    setCheckingAderencia(true)
    // param correto é p_codigo_ibge (era p_codigo → a RPC errava sempre e o selo caía em null)
    const { data, error } = await supabase.rpc('fn_gov_nfse_municipio_aderiu', { p_codigo_ibge: codigo })
    setCheckingAderencia(false)
    if (error) { setAderidoSelo(null); return }
    // 3 estados (RD-51): lê o CAMPO aderido do RPC — Boolean(data) era sempre true (data é objeto).
    // true = aderido · false = não aderido · null = adesão não verificada (não alarma).
    const r = data as { aderido?: boolean | null } | null
    setAderidoSelo(r?.aderido ?? null)
  }

  const isNacional = provider === 'gov_nfse_nacional'
  const isSN = regime === 'simples_nacional'

  const concluidos = resumo?.concluidos ?? 0
  const total = resumo?.total ?? 5
  const completo = concluidos === total

  const podeSalvar = useMemo(() => {
    if (!inscricaoMunicipal.trim()) return false
    if (!serie.trim()) return false
    if (!Number.isFinite(Number(proximo)) || Number(proximo) <= 0) return false
    return true
  }, [inscricaoMunicipal, serie, proximo])

  async function salvarToken() {
    setErro(null)
    setToast(null)
    if (!token || token.trim().length < 8) {
      setErro('Token inválido (mínimo 8 caracteres).')
      return
    }
    setSalvandoToken(true)
    const { data, error } = await supabase.rpc('fn_fiscal_salvar_token', {
      p_company_id: companyId,
      p_token: token.trim(),
      p_ambiente: ambiente,
    })
    setSalvandoToken(false)
    if (error) { setErro(error.message); return }
    const r = data as { ok?: boolean; erro?: string; vault_id?: string }
    if (!r.ok) { setErro(r.erro ?? 'Erro ao salvar token'); return }
    setToken('')
    setTrocarToken(false)
    setToast('🔒 ALTEROU o token (cofre cifrado) · vault_id ' + (r.vault_id ?? '').slice(0, 8) + '…')
    // recarregar checklist
    const { data: novo } = await supabase.rpc('fn_fiscal_config_checklist', { p_company_id: companyId })
    if (novo) setResumo(novo as ChecklistResp)
    onSalvo?.()
    setTimeout(() => setToast(null), 4000)
  }

  async function salvar() {
    setErro(null)
    setToast(null)
    if (!podeSalvar) {
      setErro('Preencha Inscrição Municipal, Série e Próximo número.')
      return
    }
    setSalvando(true)
    const { data, error } = await supabase.rpc('fn_fiscal_salvar_config', {
      p_company_id: companyId,
      p_provider: provider,
      p_ambiente: ambiente,
      p_municipio_ibge: municipio || null,
      p_inscricao_municipal: inscricaoMunicipal,
      p_serie_nfse: serie || null,
      p_proximo_numero: Number(proximo) || 1,
      p_regime: regime,
      p_opcao_sn: isSN && opcaoSN ? Number(opcaoSN) : null,
      p_apuracao_sn: isSN && apuracaoSN ? Number(apuracaoSN) : null,
      p_pct_trib: isSN && pctTrib ? Number(pctTrib.replace(',', '.')) : null,
    })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    const c = data as ChecklistResp
    if (!c.ok) { setErro(c.erro ?? 'Erro ao salvar'); return }
    setResumo(c)
    const passo3 = c.itens?.find((i) => i.passo === 3)
    if (passo3?.valor) void checarAderencia(passo3.valor)   // re-verifica no vivo, não confia no persistido
    setToast(`✅ ALTEROU a configuração fiscal · ${c.concluidos} de ${c.total} OK`)
    onSalvo?.()
    setTimeout(() => setToast(null), 4000)
  }

  return (
    <div className="bg-white border border-[#3D2314]/10 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3 border-b border-[#3D2314]/10"
      >
        <div className="text-left">
          <div className="text-[11px] text-[#3D2314]/55 tracking-[0.8px] uppercase font-medium">Passos 2-5 · editar</div>
          <h2 className="text-[14px] font-medium text-[#3D2314]">
            Configuração fiscal {completo ? '· ✅ completa' : `· ${concluidos} de ${total} OK`}
          </h2>
        </div>
        {aberto ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>

      {aberto && (
        <div className="px-5 py-4 space-y-4">
          {/* Passo 2 · Emissor */}
          <Section titulo="2. Emissor de NFS-e">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Emissor">
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as Provider)}
                  className="w-full bg-white border border-[#3D2314]/20 rounded-md px-3 py-2 text-[13px]"
                >
                  <option value="gov_nfse_nacional">NFSe Nacional gov.br (Receita)</option>
                  <option value="focusnfe">Focus NFe (3rd party)</option>
                </select>
              </Field>
              {isNacional && (
                <Field label="Ambiente">
                  <select
                    value={ambiente}
                    onChange={(e) => setAmbiente(e.target.value as Ambiente)}
                    className="w-full bg-white border border-[#3D2314]/20 rounded-md px-3 py-2 text-[13px]"
                  >
                    <option value="homologacao">Produção restrita (teste)</option>
                    <option value="producao">Produção</option>
                  </select>
                </Field>
              )}
            </div>

            {isSN && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                <Field label="Opção SN">
                  <select
                    value={opcaoSN}
                    onChange={(e) => setOpcaoSN(e.target.value)}
                    className="w-full bg-white border border-[#3D2314]/20 rounded-md px-3 py-2 text-[13px]"
                  >
                    <option value="2">2 · MEI</option>
                    <option value="3">3 · ME/EPP optante</option>
                  </select>
                </Field>
                <Field label="Regime de apuração">
                  <select
                    value={apuracaoSN}
                    onChange={(e) => setApuracaoSN(e.target.value)}
                    className="w-full bg-white border border-[#3D2314]/20 rounded-md px-3 py-2 text-[13px]"
                  >
                    <option value="1">1 · Fed + ISS pelo SN</option>
                    <option value="2">2 · Fed SN, ISS fora</option>
                    <option value="3">3 · Fed e ISS fora</option>
                  </select>
                </Field>
                <Field label="% total tributos aprox.">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={pctTrib}
                    onChange={(e) => setPctTrib(e.target.value)}
                    placeholder="ex.: 8,55"
                    className="w-full bg-white border border-[#3D2314]/20 rounded-md px-3 py-2 text-[13px]"
                  />
                </Field>
              </div>
            )}
          </Section>

          {/* Passo 3 · Municipio */}
          <Section titulo="3. Município IBGE">
            <div className="flex items-center gap-2">
              <input
                type="text"
                maxLength={7}
                value={municipio}
                onChange={(e) => setMunicipio(e.target.value.replace(/\D/g, ''))}
                onBlur={() => void checarAderencia(municipio)}
                placeholder="7 dígitos (ex.: 4217204)"
                className="flex-1 bg-white border border-[#3D2314]/20 rounded-md px-3 py-2 text-[13px]"
              />
              {checkingAderencia ? (
                <Loader2 size={16} className="animate-spin text-[#C8941A]" />
              ) : aderidoSelo === true ? (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] bg-[#E8F4DC] text-[#1B3608] font-medium">
                  <CheckCircle2 size={12} /> aderido
                </span>
              ) : aderidoSelo === false ? (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] bg-[#FCEBEB] text-[#791F1F] font-medium">
                  <XCircle size={12} /> não aderido
                </span>
              ) : /^\d{7}$/.test(municipio) ? (
                // NULL = adesão não verificada (RD-51 · desconhecido ≠ não aderido) — badge neutro, não alarma
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] bg-[#F0ECE3] text-[#6B5D4F] font-medium">
                  adesão não verificada
                </span>
              ) : null}
            </div>
          </Section>

          {/* Passo 4 · IM */}
          <Section titulo="4. Inscrição Municipal *">
            <input
              type="text"
              value={inscricaoMunicipal}
              onChange={(e) => setInscricaoMunicipal(e.target.value)}
              placeholder="ex.: 207969"
              className="w-full bg-white border border-[#3D2314]/20 rounded-md px-3 py-2 text-[13px]"
            />
          </Section>

          {/* Passo 5 · Serie + proximo */}
          <Section titulo="5. Numeração da série">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Série">
                <input
                  type="text"
                  value={serie}
                  onChange={(e) => setSerie(e.target.value)}
                  className="w-full bg-white border border-[#3D2314]/20 rounded-md px-3 py-2 text-[13px]"
                />
              </Field>
              <Field label="Próximo número DPS">
                <input
                  type="number"
                  min={1}
                  value={proximo}
                  onChange={(e) => setProximo(e.target.value)}
                  className="w-full bg-white border border-[#3D2314]/20 rounded-md px-3 py-2 text-[13px]"
                />
              </Field>
            </div>
          </Section>

          {/* Passo 6 · Token do emissor (Vault cifrado) */}
          <Section titulo="6. Token do emissor (cofre cifrado)">
            {(() => {
              const passo6 = resumo?.itens?.find((i) => i.passo === 6)
              const temToken = passo6?.ok === true
              if (temToken && !trocarToken) {
                return (
                  <div className="flex items-center justify-between gap-2 px-3 py-2 bg-[#FAF7F2] border border-[#3D2314]/15 rounded-md">
                    <div className="text-[12px] text-[#3D2314]">
                      🔒 Token cifrado no cofre · <code>••••••••</code>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTrocarToken(true)}
                      className="text-[11px] text-[#BA7517] font-medium hover:underline"
                    >
                      Trocar
                    </button>
                  </div>
                )
              }
              return (
                <div className="space-y-2">
                  <input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Cole o token Focus (ambiente atual: este wizard)"
                    autoComplete="off"
                    className="w-full bg-white border border-[#3D2314]/20 rounded-md px-3 py-2 text-[13px] font-mono"
                  />
                  <div className="flex items-center gap-2 justify-end">
                    {trocarToken && (
                      <button
                        type="button"
                        onClick={() => { setToken(''); setTrocarToken(false) }}
                        className="text-[12px] text-[#3D2314]/70 hover:underline"
                      >
                        Cancelar
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void salvarToken()}
                      disabled={salvandoToken || token.trim().length < 8}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#3D2314] text-white text-[12px] font-medium disabled:opacity-40"
                    >
                      {salvandoToken ? 'Salvando…' : '🔒 Salvar no cofre'}
                    </button>
                  </div>
                  <div className="text-[10.5px] text-[#3D2314]/55">
                    O token vai cifrado pro Vault (Pilar 2). Nem o ERP nem logs registram em texto.
                  </div>
                </div>
              )
            })()}
          </Section>

          {/* #90 paridade OMIE · Alíquota do Simples por competência (pAliq) — exigida na emissão (regime 1) */}
          <Section titulo="Alíquota do ISS (Simples Nacional) por mês">
            <div className="text-[11px] text-[#3D2314]/60 mb-2">Informe a alíquota efetiva do Simples do mês (o contador calcula). Sem ela, a emissão do mês fica bloqueada.</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <Field label="Competência (mês)">
                <input type="month" value={aliqCompetencia} onChange={(e) => setAliqCompetencia(e.target.value)}
                  className="w-full bg-white border border-[#3D2314]/20 rounded-md px-3 py-2 text-[13px]" />
              </Field>
              <Field label="Alíquota (%)">
                <input type="text" inputMode="decimal" value={aliqValor} onChange={(e) => setAliqValor(e.target.value)} placeholder="ex.: 3,68"
                  className="w-full bg-white border border-[#3D2314]/20 rounded-md px-3 py-2 text-[13px]" />
              </Field>
              <button type="button" onClick={() => void salvarAliquota()} disabled={salvandoAliq}
                className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-[#C8941A] text-white text-[12px] font-medium disabled:opacity-40">
                {salvandoAliq ? 'Salvando…' : 'Salvar alíquota do mês'}
              </button>
            </div>
          </Section>

          {/* #90 / Focus #242149 · Reforma Tributária (IBS/CBS) — recolhida, opcional, desligada por padrão */}
          <div className="border border-[#3D2314]/10 rounded-lg">
            <button type="button" onClick={() => setReformaAberto((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-left">
              <span className="text-[12px] font-semibold text-[#3D2314]">Reforma Tributária (IBS/CBS)</span>
              {reformaAberto ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {reformaAberto && (
              <div className="px-3 pb-3 space-y-3">
                <div className="text-[11px] text-[#3D2314]/60">Preencha só quando o emissor ou o contador pedir. Vazio = não vai na nota.</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Field label="Finalidade (finNFSe)">
                    <input type="text" inputMode="numeric" value={rfFinalidade} onChange={(e) => setRfFinalidade(e.target.value.replace(/\D/g, ''))} placeholder="ex.: 0" className="w-full bg-white border border-[#3D2314]/20 rounded-md px-3 py-2 text-[13px]" />
                  </Field>
                  <Field label="Consumidor final (indFinal)">
                    <input type="text" inputMode="numeric" value={rfConsumidor} onChange={(e) => setRfConsumidor(e.target.value.replace(/\D/g, ''))} placeholder="0 = não · 1 = sim" className="w-full bg-white border border-[#3D2314]/20 rounded-md px-3 py-2 text-[13px]" />
                  </Field>
                  <Field label="Indicador destinatário (indDest)">
                    <input type="text" inputMode="numeric" value={rfIndDest} onChange={(e) => setRfIndDest(e.target.value.replace(/\D/g, ''))} placeholder="0 = tomador · 1 = outro" className="w-full bg-white border border-[#3D2314]/20 rounded-md px-3 py-2 text-[13px]" />
                  </Field>
                  <Field label="CST IBS/CBS">
                    <input type="text" maxLength={3} value={rfCst} onChange={(e) => setRfCst(e.target.value.replace(/\D/g, ''))} placeholder="3 dígitos" className="w-full bg-white border border-[#3D2314]/20 rounded-md px-3 py-2 text-[13px]" />
                  </Field>
                  <Field label="Classificação (cClassTrib)">
                    <input type="text" maxLength={6} value={rfClassif} onChange={(e) => setRfClassif(e.target.value.replace(/\D/g, ''))} placeholder="6 dígitos" className="w-full bg-white border border-[#3D2314]/20 rounded-md px-3 py-2 text-[13px]" />
                  </Field>
                </div>
                <div className="flex justify-end">
                  <button type="button" onClick={() => void salvarReforma()} disabled={salvandoReforma}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#3D2314] text-white text-[12px] font-medium disabled:opacity-40">
                    {salvandoReforma ? 'Salvando…' : 'Salvar campos da Reforma'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {erro && (
            <div className="bg-[#FCEBEB] border-l-4 border-[#C94544] rounded-md px-3 py-2 text-[12px] text-[#791F1F]">
              {erro}
            </div>
          )}
          {toast && (
            <div className="bg-[#E8F4DC] border-l-4 border-[#3F7012] rounded-md px-3 py-2 text-[12px] text-[#1B3608]">
              {toast}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={salvar}
              disabled={salvando || !podeSalvar}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#C8941A] text-white text-[13px] font-medium hover:bg-[#A87810] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {salvando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {salvando ? 'Salvando…' : 'Salvar configuração'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[12px] font-semibold text-[#3D2314] mb-2">{titulo}</div>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] text-[#3D2314]/60 uppercase tracking-[0.6px] font-semibold block mb-1">
        {label}
      </span>
      {children}
    </label>
  )
}
