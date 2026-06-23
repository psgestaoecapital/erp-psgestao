'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Conta } from './ContasBancariasForm'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = 'rgba(61,35,20,0.12)'
const ESP60 = 'rgba(61,35,20,0.65)'
const RED = '#A32D2D'
const GREEN = '#3F8D3F'
const YELLOW = '#854F0B'

const BANCOS: Array<{ codigo: string; nome: string; provider: string }> = [
  { codigo: '237', nome: '237 — Bradesco', provider: 'bradesco' },
]

type Estado = {
  existe: boolean
  ambiente: string
  client_id: string | null
  tem_client_secret: boolean
  tem_certificado_a1: boolean
  cap_boleto: boolean
  cap_extrato: boolean
  cap_pagamento: boolean
  agencia: string | null
  conta: string | null
  carteira: string | null
  convenio: string | null
  codigo_beneficiario: string | null
  juros_pct: number | null
  multa_pct: number | null
  dias_compensacao: number | null
  dias_protesto: number | null
  instrucao_linha1: string | null
  instrucao_linha2: string | null
  instrucao_linha3: string | null
  instrucao_linha4: string | null
  gerar_pix: boolean
  banco_conta_id: string | null
  integracao_habilitada: boolean
}

const VAZIO: Estado = {
  existe: false, ambiente: 'producao', client_id: null, tem_client_secret: false, tem_certificado_a1: false,
  cap_boleto: false, cap_extrato: false, cap_pagamento: false,
  agencia: null, conta: null, carteira: null, convenio: null, codigo_beneficiario: null,
  juros_pct: null, multa_pct: null, dias_compensacao: null, dias_protesto: null,
  instrucao_linha1: null, instrucao_linha2: null, instrucao_linha3: null, instrucao_linha4: null,
  gerar_pix: false, banco_conta_id: null, integracao_habilitada: false,
}

type Tab = 'dados' | 'integracao' | 'boletos'

export default function BancoIntegracaoPanel({
  companyId, conta, onClose,
}: { companyId: string; conta: Conta; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('integracao')
  const [bancoCodigo, setBancoCodigo] = useState('237')
  const [ambiente, setAmbiente] = useState<'producao' | 'sandbox'>('producao')
  const [estado, setEstado] = useState<Estado>(VAZIO)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro' | 'info'; texto: string } | null>(null)

  // form Integração
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('') // só envia se digitado
  const [a1Senha, setA1Senha] = useState('') // senha do A1 fiscal para uso bancário (Vault)
  const [agencia, setAgencia] = useState('')
  const [contaInput, setContaInput] = useState('')
  const [capBoleto, setCapBoleto] = useState(true)
  const [capExtrato, setCapExtrato] = useState(true)

  // form Boletos
  const [carteira, setCarteira] = useState('')
  const [convenio, setConvenio] = useState('')
  const [codBenef, setCodBenef] = useState('')
  const [jurosPct, setJurosPct] = useState('')
  const [multaPct, setMultaPct] = useState('')
  const [diasCompens, setDiasCompens] = useState('')
  const [diasProtesto, setDiasProtesto] = useState('')
  const [instr1, setInstr1] = useState('')
  const [instr2, setInstr2] = useState('')
  const [instr3, setInstr3] = useState('')
  const [instr4, setInstr4] = useState('')
  const [gerarPix, setGerarPix] = useState(false)

  const carregarEstado = useCallback(async () => {
    setLoading(true); setMsg(null)
    const { data, error } = await supabase.rpc('fn_banco_integracao_estado', {
      p_company_id: companyId, p_banco_codigo: bancoCodigo, p_ambiente: ambiente,
    })
    setLoading(false)
    if (error) { setMsg({ tipo: 'erro', texto: error.message }); return }
    const e = (data as Estado | null) ?? VAZIO
    setEstado(e)
    setClientId(e.client_id ?? '')
    setClientSecret('')
    setAgencia(e.agencia ?? conta.agencia ?? '')
    setContaInput(e.conta ?? conta.conta ?? '')
    setCapBoleto(e.cap_boleto)
    setCapExtrato(e.cap_extrato)
    setCarteira(e.carteira ?? '')
    setConvenio(e.convenio ?? '')
    setCodBenef(e.codigo_beneficiario ?? '')
    setJurosPct(e.juros_pct?.toString() ?? '')
    setMultaPct(e.multa_pct?.toString() ?? '')
    setDiasCompens(e.dias_compensacao?.toString() ?? '')
    setDiasProtesto(e.dias_protesto?.toString() ?? '')
    setInstr1(e.instrucao_linha1 ?? '')
    setInstr2(e.instrucao_linha2 ?? '')
    setInstr3(e.instrucao_linha3 ?? '')
    setInstr4(e.instrucao_linha4 ?? '')
    setGerarPix(e.gerar_pix)
  }, [companyId, bancoCodigo, ambiente, conta.agencia, conta.conta])

  useEffect(() => { carregarEstado() }, [carregarEstado])

  const salvarIntegracao = async () => {
    setBusy(true); setMsg(null)
    const provider = BANCOS.find((b) => b.codigo === bancoCodigo)?.provider ?? 'bradesco'
    const { error } = await supabase.rpc('fn_banco_salvar_credencial', {
      p_company_id: companyId, p_banco_codigo: bancoCodigo, p_provider: provider, p_ambiente: ambiente,
      p_client_id: clientId || null,
      p_client_secret: clientSecret || null,
      p_cert_base64: null, p_cert_senha: a1Senha || null,
      p_agencia: agencia || null, p_conta: contaInput || null,
      p_cooperativa: null,
      p_codigo_beneficiario: codBenef || null, p_convenio: convenio || null, p_carteira: carteira || null,
      p_cap_extrato: capExtrato, p_cap_boleto: capBoleto, p_cap_pagamento: false,
      p_ativo: true,
    })
    setBusy(false)
    if (error) { setMsg({ tipo: 'erro', texto: error.message }); return }
    setMsg({ tipo: 'ok', texto: 'Integração ALTEROU com sucesso.' })
    setClientSecret('')
    setA1Senha('')
    carregarEstado()
  }

  const salvarBoletos = async () => {
    setBusy(true); setMsg(null)
    const provider = BANCOS.find((b) => b.codigo === bancoCodigo)?.provider ?? 'bradesco'
    // carteira/convênio/beneficiário vão pela RPC de credencial
    const r1 = await supabase.rpc('fn_banco_salvar_credencial', {
      p_company_id: companyId, p_banco_codigo: bancoCodigo, p_provider: provider, p_ambiente: ambiente,
      p_client_id: null, p_client_secret: null, p_cert_base64: null, p_cert_senha: null,
      p_agencia: null, p_conta: null, p_cooperativa: null,
      p_codigo_beneficiario: codBenef || null, p_convenio: convenio || null, p_carteira: carteira || null,
      p_cap_extrato: capExtrato, p_cap_boleto: capBoleto, p_cap_pagamento: false, p_ativo: true,
    })
    if (r1.error) { setBusy(false); setMsg({ tipo: 'erro', texto: r1.error.message }); return }
    const { error } = await supabase.rpc('fn_banco_boleto_params_salvar', {
      p_company_id: companyId, p_banco_codigo: bancoCodigo, p_ambiente: ambiente,
      p_juros_pct: jurosPct === '' ? null : Number(jurosPct),
      p_multa_pct: multaPct === '' ? null : Number(multaPct),
      p_dias_compensacao: diasCompens === '' ? null : Number(diasCompens),
      p_dias_protesto: diasProtesto === '' ? null : Number(diasProtesto),
      p_instrucao_linha1: instr1 || null,
      p_instrucao_linha2: instr2 || null,
      p_instrucao_linha3: instr3 || null,
      p_instrucao_linha4: instr4 || null,
      p_gerar_pix: gerarPix,
      p_banco_conta_id: conta.id,
    })
    setBusy(false)
    if (error) { setMsg({ tipo: 'erro', texto: error.message }); return }
    setMsg({ tipo: 'ok', texto: 'Parâmetros de boleto ALTEROU com sucesso.' })
    carregarEstado()
  }

  const testarConexao = async () => {
    setBusy(true); setMsg(null)
    await carregarEstado()
    setBusy(false)
    if (estado.integracao_habilitada) {
      setMsg({ tipo: 'ok', texto: '✅ Integração habilitada — credenciais e certificado OK' })
    } else {
      const falta: string[] = []
      if (!estado.client_id) falta.push('client_id')
      if (!estado.tem_client_secret) falta.push('client_secret')
      if (!estado.tem_certificado_a1) falta.push('certificado A1 válido')
      setMsg({ tipo: 'info', texto: `⚠️ Falta: ${falta.join(' · ') || 'configurar integração'}` })
    }
  }

  const TabBtn = ({ id, label }: { id: Tab; label: string }) => (
    <button onClick={() => setTab(id)} type="button"
      style={{
        padding: '10px 14px', border: 'none', borderBottom: `2px solid ${tab === id ? GOLD : 'transparent'}`,
        background: 'transparent', color: tab === id ? ESP : ESP60, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
      }}>
      {label}
    </button>
  )

  const inp: React.CSSProperties = {
    width: '100%', padding: '8px 10px', borderRadius: 6, border: `1px solid ${LINE}`,
    background: '#fff', color: ESP, fontSize: 13, outline: 'none', colorScheme: 'light',
  }
  const lbl: React.CSSProperties = { fontSize: 11, color: ESP60, marginBottom: 4, display: 'block' }

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.45)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: BG, borderRadius: 12, width: '100%', maxWidth: 720, maxHeight: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <header style={{ padding: '16px 20px', borderBottom: `1px solid ${LINE}` }}>
          <div style={{ fontSize: 10, color: ESP60, textTransform: 'uppercase', letterSpacing: 1 }}>Integração bancária</div>
          <div style={{ fontSize: 18, color: ESP, fontWeight: 600, marginTop: 2 }}>{conta.nome}</div>
          <div style={{ fontSize: 11, color: ESP60, marginTop: 2 }}>
            {conta.banco ?? ''}{conta.agencia ? ` · Ag. ${conta.agencia}` : ''}{conta.conta ? ` · CC ${conta.conta}` : ''}
          </div>
        </header>

        <nav style={{ display: 'flex', gap: 4, padding: '0 12px', borderBottom: `1px solid ${LINE}`, overflowX: 'auto' }}>
          <TabBtn id="dados" label="Dados da Conta" />
          <TabBtn id="integracao" label="Integração API" />
          <TabBtn id="boletos" label="Boletos de Cobrança" />
        </nav>

        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ color: ESP60, fontSize: 13 }}>Carregando…</div>
          ) : (
            <>
              {tab === 'dados' && (
                <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Info label="Nome" value={conta.nome} />
                  <Info label="Banco" value={conta.banco ?? '—'} />
                  <Info label="Agência" value={conta.agencia ?? '—'} />
                  <Info label="Conta" value={conta.conta ?? '—'} />
                  <Info label="Tipo" value={conta.tipo_conta ?? '—'} />
                </section>
              )}

              {tab === 'integracao' && (
                <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div><label style={lbl}>Banco</label>
                      <select style={inp} value={bancoCodigo} onChange={(e) => setBancoCodigo(e.target.value)}>
                        {BANCOS.map((b) => <option key={b.codigo} value={b.codigo}>{b.nome}</option>)}
                      </select>
                    </div>
                    <div><label style={lbl}>Ambiente</label>
                      <select style={inp} value={ambiente} onChange={(e) => setAmbiente(e.target.value as 'producao' | 'sandbox')}>
                        <option value="producao">Produção</option>
                        <option value="sandbox">Sandbox</option>
                      </select>
                    </div>
                  </div>
                  <div><label style={lbl}>Client ID</label>
                    <input style={inp} value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="ex.: 5fd6ceed-1de2-488d-bef0-bd90b8750c47" />
                  </div>
                  <div><label style={lbl}>Client Secret</label>
                    <input style={inp} type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)}
                      placeholder={estado.tem_client_secret ? '•••••••• (já configurado — só preencha para trocar)' : 'cole aqui o client_secret'} />
                  </div>
                  <div><label style={lbl}>Senha do certificado A1 (uso bancário)</label>
                    <input style={inp} type="password" value={a1Senha} onChange={(e) => setA1Senha(e.target.value)}
                      placeholder="Necessária para mTLS no Bradesco. Só preencha uma vez ou para trocar." />
                    <div style={{ fontSize: 10, color: ESP60, marginTop: 4 }}>
                      Cripotgrafada no Vault, usada apenas pelo backend bancário (mTLS). O certificado em si vem do A1 fiscal.
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div><label style={lbl}>Agência</label>
                      <input style={inp} value={agencia} onChange={(e) => setAgencia(e.target.value)} placeholder="0376" />
                    </div>
                    <div><label style={lbl}>Conta</label>
                      <input style={inp} value={contaInput} onChange={(e) => setContaInput(e.target.value)} placeholder="0024955-6" />
                    </div>
                  </div>
                  <fieldset style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: 12 }}>
                    <legend style={{ fontSize: 11, color: ESP60, padding: '0 6px' }}>Automação</legend>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: ESP, marginBottom: 6 }}>
                      <input type="checkbox" checked={capBoleto} onChange={(e) => setCapBoleto(e.target.checked)} />
                      Registrar boletos automaticamente
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: ESP, marginBottom: 6 }}>
                      <input type="checkbox" checked={capExtrato} onChange={(e) => setCapExtrato(e.target.checked)} />
                      Processar extrato automaticamente
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'rgba(61,35,20,0.4)' }}>
                      <input type="checkbox" disabled />
                      Processar pagamentos <span style={{ fontSize: 10, marginLeft: 4 }}>(em breve)</span>
                    </label>
                  </fieldset>
                  <div style={{ background: '#FFF7E0', border: `1px solid ${GOLD}`, borderRadius: 8, padding: 10, fontSize: 12, color: ESP }}>
                    🔒 Usaremos automaticamente o certificado A1 da empresa (o mesmo da nota fiscal). Não é preciso enviar de novo.
                  </div>
                  <StatusBanner estado={estado} />
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button onClick={salvarIntegracao} disabled={busy} type="button"
                      style={{ background: GOLD, color: ESP, border: 'none', padding: '10px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}>
                      Salvar integração
                    </button>
                    <button onClick={testarConexao} disabled={busy} type="button"
                      style={{ background: 'transparent', color: ESP, border: `1px solid ${ESP}`, padding: '10px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}>
                      Testar conexão
                    </button>
                  </div>
                </section>
              )}

              {tab === 'boletos' && (
                <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                    <div><label style={lbl}>Carteira</label>
                      <input style={inp} value={carteira} onChange={(e) => setCarteira(e.target.value)} placeholder="09" />
                    </div>
                    <div><label style={lbl}>Convênio</label>
                      <input style={inp} value={convenio} onChange={(e) => setConvenio(e.target.value)} placeholder="6078117" />
                    </div>
                    <div><label style={lbl}>Cód. beneficiário</label>
                      <input style={inp} value={codBenef} onChange={(e) => setCodBenef(e.target.value)} placeholder="6078117" />
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
                    <div><label style={lbl}>% Juros ao mês</label>
                      <input style={inp} inputMode="decimal" value={jurosPct} onChange={(e) => setJurosPct(e.target.value)} placeholder="1.5" />
                    </div>
                    <div><label style={lbl}>% Multa</label>
                      <input style={inp} inputMode="decimal" value={multaPct} onChange={(e) => setMultaPct(e.target.value)} placeholder="2" />
                    </div>
                    <div><label style={lbl}>Dias compensação</label>
                      <input style={inp} inputMode="numeric" value={diasCompens} onChange={(e) => setDiasCompens(e.target.value)} placeholder="1" />
                    </div>
                    <div><label style={lbl}>Dias protesto</label>
                      <input style={inp} inputMode="numeric" value={diasProtesto} onChange={(e) => setDiasProtesto(e.target.value)} placeholder="0" />
                    </div>
                  </div>
                  <fieldset style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: 12 }}>
                    <legend style={{ fontSize: 11, color: ESP60, padding: '0 6px' }}>Instruções do boleto (4 linhas)</legend>
                    {[
                      { v: instr1, set: setInstr1, ph: 'Linha 1 (ex.: Após o vencimento, juros de 1% ao mês)' },
                      { v: instr2, set: setInstr2, ph: 'Linha 2' },
                      { v: instr3, set: setInstr3, ph: 'Linha 3' },
                      { v: instr4, set: setInstr4, ph: 'Linha 4' },
                    ].map((it, i) => (
                      <input key={i} style={{ ...inp, marginBottom: 6 }} value={it.v} onChange={(e) => it.set(e.target.value)} placeholder={it.ph} />
                    ))}
                  </fieldset>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: ESP }}>
                    <input type="checkbox" checked={gerarPix} onChange={(e) => setGerarPix(e.target.checked)} />
                    Gerar boleto com PIX
                  </label>
                  <div>
                    <button onClick={salvarBoletos} disabled={busy} type="button"
                      style={{ background: GOLD, color: ESP, border: 'none', padding: '10px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}>
                      Salvar boletos
                    </button>
                  </div>
                </section>
              )}
            </>
          )}

          {msg && (
            <div style={{
              marginTop: 14, padding: 10, borderRadius: 8, fontSize: 12,
              background: msg.tipo === 'ok' ? '#E8F5E8' : msg.tipo === 'erro' ? '#FCE4E4' : '#FFF7E0',
              color: msg.tipo === 'ok' ? GREEN : msg.tipo === 'erro' ? RED : YELLOW,
              border: `1px solid ${msg.tipo === 'ok' ? GREEN : msg.tipo === 'erro' ? RED : GOLD}`,
            }}>
              {msg.texto}
            </div>
          )}
        </div>

        <footer style={{ padding: 12, borderTop: `1px solid ${LINE}`, textAlign: 'right' }}>
          <button onClick={onClose} type="button"
            style={{ background: 'transparent', color: ESP, border: `1px solid ${LINE}`, padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Fechar
          </button>
        </footer>
      </div>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: ESP60, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 14, color: ESP, marginTop: 2 }}>{value}</div>
    </div>
  )
}

function StatusBanner({ estado }: { estado: Estado }) {
  const ok = estado.integracao_habilitada
  if (ok) {
    return (
      <div style={{ background: '#E8F5E8', border: `1px solid ${GREEN}`, borderRadius: 8, padding: 10, fontSize: 12, color: GREEN }}>
        ✅ Integração habilitada — credenciais e certificado A1 OK
      </div>
    )
  }
  const falta: string[] = []
  if (!estado.client_id) falta.push('client_id')
  if (!estado.tem_client_secret) falta.push('client_secret')
  if (!estado.tem_certificado_a1) falta.push('certificado A1 válido')
  return (
    <div style={{ background: '#FFF7E0', border: `1px solid ${GOLD}`, borderRadius: 8, padding: 10, fontSize: 12, color: YELLOW }}>
      ⚠️ Falta: {falta.join(' · ') || 'configurar integração'}
    </div>
  )
}
