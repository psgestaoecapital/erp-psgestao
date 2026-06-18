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
  total: number
  concluidos: number
  pronto_para_emitir?: boolean
  itens: ChecklistItem[]
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

  // carrega checklist inicial pra pre-preencher
  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data, error } = await supabase.rpc('fn_fiscal_config_checklist', { p_company_id: companyId })
      if (!alive || error) return
      const c = data as ChecklistResp
      setResumo(c)
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
      if (passo3?.valor) setMunicipio(passo3.valor)
      if (passo3?.aderido != null) setAderidoSelo(passo3.aderido)
      if (passo4?.valor) setInscricaoMunicipal(passo4.valor)
      else if (imAtual) setInscricaoMunicipal(imAtual)
      if (passo5?.serie) setSerie(passo5.serie)
      if (passo5?.proximo != null) setProximo(String(passo5.proximo))
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  async function checarAderencia(codigo: string) {
    if (!/^\d{7}$/.test(codigo)) { setAderidoSelo(null); return }
    setCheckingAderencia(true)
    const { data, error } = await supabase.rpc('fn_gov_nfse_municipio_aderiu', { p_codigo: codigo })
    setCheckingAderencia(false)
    if (error) { setAderidoSelo(null); return }
    setAderidoSelo(Boolean(data))
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
    const passo3 = c.itens.find((i) => i.passo === 3)
    if (passo3?.aderido != null) setAderidoSelo(passo3.aderido)
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
              const passo6 = resumo?.itens.find((i) => i.passo === 6)
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
