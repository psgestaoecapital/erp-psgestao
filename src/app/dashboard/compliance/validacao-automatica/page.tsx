'use client'

// PS Gestão ERP — Compliance › Validação Automática (/dashboard/compliance/validacao-automatica)
// Tela funcional: histórico de consultas (CNDT, CND Federal, CRF FGTS), indicadores e consulta avulsa.
// Backend já ativo: GET/POST /api/compliance/consultas (idempotente via fn_compliance_enfileirar_consulta);
// o worker (/api/compliance/worker, cron) processa a fila. RFB e Caixa usam CAPTCHA → marcados como indisponíveis
// até integração via API licenciada. RD-95 "?" em todo campo/filtro/coluna/ação; RD-98 origem do dado em system_screens.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { authFetch } from '@/lib/authFetch'
import AjudaCampo from '@/components/ajuda/AjudaCampo'
import { PSGC_COLORS, PSGC_RADIUS } from '@/lib/psgc-tokens'

export const dynamic = 'force-dynamic'

const ROTA_AJUDA = '/dashboard/compliance/validacao-automatica'

const C = PSGC_COLORS

type Consulta = {
  id: string
  alvo_tipo: string
  alvo_documento: string
  alvo_nome: string | null
  provedor_codigo: string
  status: string
  resultado: string | null
  numero_documento_emitido: string | null
  data_emissao: string | null
  data_validade: string | null
  erro_mensagem: string | null
  created_at: string
}

type Provedor = { codigo: string; nome: string; curto: string; disponivel: boolean }

const PROVEDORES: Provedor[] = [
  { codigo: 'cndt_tst', nome: 'CNDT — Débitos Trabalhistas (TST)', curto: 'CNDT', disponivel: true },
  { codigo: 'negativa_federal', nome: 'CND Federal — Receita Federal', curto: 'CND Federal', disponivel: false },
  { codigo: 'negativa_fgts', nome: 'CRF FGTS — Caixa', curto: 'CRF FGTS', disponivel: false },
]
const provedorNome = (cod: string) => PROVEDORES.find((p) => p.codigo === cod)?.curto ?? cod

const ALVO_TIPOS: { v: string; label: string }[] = [
  { v: 'empresa_propria', label: 'Minha empresa' },
  { v: 'funcionario', label: 'Funcionário' },
  { v: 'prestador', label: 'Prestador' },
  { v: 'fornecedor', label: 'Fornecedor' },
  { v: 'cliente', label: 'Cliente' },
  { v: 'avulso', label: 'Avulso (digitar documento)' },
]

// Classificação honesta do desfecho, tolerante a vocabulário do worker.
function classe(c: Consulta): 'ok' | 'pendencia' | 'aguardando' | 'indisponivel' | 'erro' {
  const s = (c.status || '').toLowerCase()
  const r = (c.resultado || '').toLowerCase()
  if (s === 'captcha_required' || r === 'captcha_required') return 'indisponivel'
  if (s === 'erro') return 'erro'
  if (s === 'pendente' || s === 'processando' || s === 'enfileirada' || s === 'em_processamento') return 'aguardando'
  if (r === 'negativa' || r === 'sem_pendencias') return 'ok'
  if (r === 'positiva' || r === 'com_pendencias' || r === 'positiva_com_efeito_negativa') return 'pendencia'
  if (r === 'inconclusivo') return 'erro'
  return 'aguardando'
}

const SELO: Record<ReturnType<typeof classe>, { txt: string; cor: string; bg: string }> = {
  ok: { txt: 'Sem pendências', cor: '#1f6b3a', bg: '#e8f3ec' },
  pendencia: { txt: 'Com pendências', cor: '#9a2a2a', bg: '#fbe9e9' },
  aguardando: { txt: 'Processando', cor: '#6b6b6b', bg: '#efefef' },
  indisponivel: { txt: 'Indisponível (CAPTCHA)', cor: '#8a6a10', bg: '#fdf4e0' },
  erro: { txt: 'Não concluída', cor: '#8a6a10', bg: '#fdf4e0' },
}

const soDigitos = (s: string) => (s || '').replace(/\D+/g, '')
const fmtDoc = (d: string) => {
  const n = soDigitos(d)
  if (n.length === 11) return n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  if (n.length === 14) return n.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  return d
}
const fmtData = (s: string | null) => (s ? new Date(s).toLocaleDateString('pt-BR') : '—')
const fmtDataHora = (s: string) => new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

export default function ValidacaoAutomaticaPage() {
  const { companyIds } = useCompanyIds()
  const empresaUnica = companyIds.length === 1 ? companyIds[0] : null

  const [consultas, setConsultas] = useState<Consulta[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [fProvedor, setFProvedor] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [busca, setBusca] = useState('')

  const [aTipo, setATipo] = useState('empresa_propria')
  const [aDoc, setADoc] = useState('')
  const [aNome, setANome] = useState('')
  const [aProvedor, setAProvedor] = useState('cndt_tst')
  const [enviando, setEnviando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; txt: string } | null>(null)

  const carregar = useCallback(async () => {
    if (!empresaUnica) return
    setCarregando(true)
    setErro(null)
    try {
      const r = await authFetch(`/api/compliance/consultas?company_id=${empresaUnica}&limit=200`)
      const d = await r.json()
      if (!r.ok || d?.ok === false) {
        setErro(d?.mensagem_humana || 'Não foi possível carregar as consultas agora. Tente novamente em instantes.')
        setConsultas([])
      } else {
        setConsultas((d.consultas || []) as Consulta[])
      }
    } catch {
      setErro('Falha de conexão ao buscar as consultas. Verifique a internet e tente de novo.')
    } finally {
      setCarregando(false)
    }
  }, [empresaUnica])

  useEffect(() => { carregar() }, [carregar])

  const consultar = useCallback(async () => {
    setMsg(null)
    const doc = soDigitos(aDoc)
    if (doc.length !== 11 && doc.length !== 14) {
      setMsg({ tipo: 'erro', txt: 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.' })
      return
    }
    if (!empresaUnica) return
    setEnviando(true)
    try {
      const r = await authFetch('/api/compliance/consultas', {
        method: 'POST',
        body: JSON.stringify({
          company_id: empresaUnica,
          alvo_tipo: aTipo,
          alvo_documento: doc,
          alvo_nome: aNome.trim() || null,
          provedor_codigo: aProvedor,
        }),
      })
      const d = await r.json()
      if (!r.ok || d?.ok === false) {
        setMsg({ tipo: 'erro', txt: d?.mensagem_humana || 'Não foi possível enfileirar a consulta.' })
      } else {
        const reaproveitada = d.status === 'reaproveitada'
        setMsg({
          tipo: 'ok',
          txt: reaproveitada
            ? 'Já havia uma consulta recente para este documento — reaproveitada (evita duplicar).'
            : 'Consulta enfileirada. O resultado aparece na lista assim que o robô processar (atualize em instantes).',
        })
        setADoc(''); setANome('')
        await carregar()
      }
    } catch {
      setMsg({ tipo: 'erro', txt: 'Falha de conexão ao enviar a consulta. Tente novamente.' })
    } finally {
      setEnviando(false)
    }
  }, [aDoc, aTipo, aNome, aProvedor, empresaUnica, carregar])

  const filtradas = useMemo(() => {
    const b = busca.trim().toLowerCase()
    const bDig = soDigitos(busca)
    return consultas.filter((c) => {
      if (fProvedor && c.provedor_codigo !== fProvedor) return false
      if (fStatus && classe(c) !== fStatus) return false
      if (b) {
        const alvo = (c.alvo_nome || '').toLowerCase()
        const docMatch = bDig && soDigitos(c.alvo_documento).includes(bDig)
        if (!alvo.includes(b) && !docMatch) return false
      }
      return true
    })
  }, [consultas, fProvedor, fStatus, busca])

  const kpis = useMemo(() => {
    const k = { total: consultas.length, ok: 0, pendencia: 0, aguardando: 0, indisponivel: 0 }
    for (const c of consultas) {
      const cl = classe(c)
      if (cl === 'ok') k.ok++
      else if (cl === 'pendencia') k.pendencia++
      else if (cl === 'aguardando') k.aguardando++
      else if (cl === 'indisponivel' || cl === 'erro') k.indisponivel++
    }
    return k
  }, [consultas])

  if (!empresaUnica) {
    return (
      <Shell>
        <div style={card()}>
          <p style={{ color: C.espresso, fontSize: 14, margin: 0 }}>
            Selecione <strong>uma empresa específica</strong> no topo para ver e disparar as validações dela.
            As consultas de certidões são sempre por empresa.
          </p>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
        <Kpi chave="compliance.validacao.kpi.total" rotulo="Consultas" valor={kpis.total} cor={C.espresso} />
        <Kpi chave="compliance.validacao.kpi.sem_pendencia" rotulo="Sem pendências" valor={kpis.ok} cor="#1f6b3a" />
        <Kpi chave="compliance.validacao.kpi.com_pendencia" rotulo="Com pendências" valor={kpis.pendencia} cor="#9a2a2a" />
        <Kpi chave="compliance.validacao.kpi.pendente" rotulo="Processando" valor={kpis.aguardando} cor="#6b6b6b" />
        <Kpi chave="compliance.validacao.kpi.indisponivel" rotulo="Indisponível" valor={kpis.indisponivel} cor="#8a6a10" />
      </div>

      {/* Consulta avulsa */}
      <div style={card()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
          <h2 style={h2()}>Nova consulta</h2>
          <AjudaCampo chave="compliance.validacao.acao.consultar" rota={ROTA_AJUDA} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
          <label style={lbl()}>
            <span style={lblTxt()}>Tipo<AjudaCampo chave="compliance.validacao.consulta.tipo" rota={ROTA_AJUDA} /></span>
            <select value={aTipo} onChange={(e) => setATipo(e.target.value)} style={inp()}>
              {ALVO_TIPOS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
            </select>
          </label>
          <label style={lbl()}>
            <span style={lblTxt()}>CPF/CNPJ<AjudaCampo chave="compliance.validacao.consulta.documento" rota={ROTA_AJUDA} /></span>
            <input
              value={aDoc}
              onChange={(e) => setADoc(e.target.value)}
              placeholder="Somente números ou formatado"
              inputMode="numeric"
              style={inp()}
            />
          </label>
          <label style={lbl()}>
            <span style={lblTxt()}>Provedor<AjudaCampo chave="compliance.validacao.consulta.provedor" rota={ROTA_AJUDA} /></span>
            <select value={aProvedor} onChange={(e) => setAProvedor(e.target.value)} style={inp()}>
              {PROVEDORES.map((p) => (
                <option key={p.codigo} value={p.codigo}>{p.nome}{p.disponivel ? '' : ' (indisponível)'}</option>
              ))}
            </select>
          </label>
          <label style={lbl()}>
            <span style={lblTxt()}>Nome (opcional)<AjudaCampo chave="compliance.validacao.consulta.nome" rota={ROTA_AJUDA} /></span>
            <input value={aNome} onChange={(e) => setANome(e.target.value)} placeholder="Para identificar na lista" style={inp()} />
          </label>
        </div>

        {!PROVEDORES.find((p) => p.codigo === aProvedor)?.disponivel && (
          <p style={{ fontSize: 12, color: '#8a6a10', background: '#fdf4e0', padding: '8px 10px', borderRadius: 8, margin: '12px 0 0' }}>
            Este provedor usa CAPTCHA no portal oficial e ainda depende de integração por API licenciada (gov.br Conecta+ / Serpro / Serasa).
            A consulta fica registrada como <strong>indisponível</strong> até a liberação. A CNDT (Trabalhista) já funciona ao vivo.
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
          <button onClick={consultar} disabled={enviando} style={btnPrimario(enviando)}>
            {enviando ? 'Enviando…' : 'Consultar'}
          </button>
          {msg && (
            <span style={{ fontSize: 13, color: msg.tipo === 'ok' ? '#1f6b3a' : '#9a2a2a' }}>{msg.txt}</span>
          )}
        </div>
      </div>

      {/* Filtros + lista */}
      <div style={{ ...card(), marginTop: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <h2 style={{ ...h2(), marginRight: 'auto' }}>Histórico de consultas</h2>
          <label style={lbl()}>
            <span style={lblTxt()}>Buscar<AjudaCampo chave="compliance.validacao.busca" rota={ROTA_AJUDA} /></span>
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou documento" style={{ ...inp(), minWidth: 180 }} />
          </label>
          <label style={lbl()}>
            <span style={lblTxt()}>Provedor<AjudaCampo chave="compliance.validacao.filtro.provedor" rota={ROTA_AJUDA} /></span>
            <select value={fProvedor} onChange={(e) => setFProvedor(e.target.value)} style={inp()}>
              <option value="">Todos</option>
              {PROVEDORES.map((p) => <option key={p.codigo} value={p.codigo}>{p.curto}</option>)}
            </select>
          </label>
          <label style={lbl()}>
            <span style={lblTxt()}>Situação<AjudaCampo chave="compliance.validacao.filtro.status" rota={ROTA_AJUDA} /></span>
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} style={inp()}>
              <option value="">Todas</option>
              <option value="ok">Sem pendências</option>
              <option value="pendencia">Com pendências</option>
              <option value="aguardando">Processando</option>
              <option value="indisponivel">Indisponível</option>
              <option value="erro">Não concluída</option>
            </select>
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={carregar} disabled={carregando} style={btnSecundario(carregando)}>
              {carregando ? 'Atualizando…' : '↻ Atualizar'}
            </button>
            <AjudaCampo chave="compliance.validacao.acao.atualizar" rota={ROTA_AJUDA} />
          </div>
        </div>

        {erro && (
          <p style={{ fontSize: 13, color: '#9a2a2a', background: '#fbe9e9', padding: '10px 12px', borderRadius: 8 }}>{erro}</p>
        )}

        {!erro && consultas.length === 0 && !carregando && (
          <div style={{ textAlign: 'center', padding: '36px 16px', color: C.espressoLight }}>
            <p style={{ fontSize: 15, color: C.espresso, margin: '0 0 6px', fontWeight: 600 }}>Nenhuma validação ainda</p>
            <p style={{ fontSize: 13, margin: '0 0 14px' }}>
              Use <strong>Nova consulta</strong> acima: informe o CPF/CNPJ e escolha o provedor (a CNDT já responde ao vivo).
              O resultado aparece aqui assim que o robô processar.
            </p>
          </div>
        )}

        {filtradas.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={th()}>Provedor<AjudaCampo chave="compliance.validacao.col.provedor" rota={ROTA_AJUDA} /></th>
                  <th style={th()}>Alvo<AjudaCampo chave="compliance.validacao.col.alvo" rota={ROTA_AJUDA} /></th>
                  <th style={th()}>Situação<AjudaCampo chave="compliance.validacao.col.status" rota={ROTA_AJUDA} /></th>
                  <th style={th()}>Certidão nº<AjudaCampo chave="compliance.validacao.col.numero" rota={ROTA_AJUDA} /></th>
                  <th style={th()}>Validade<AjudaCampo chave="compliance.validacao.col.validade" rota={ROTA_AJUDA} /></th>
                  <th style={th()}>Consultado<AjudaCampo chave="compliance.validacao.col.quando" rota={ROTA_AJUDA} /></th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map((c) => {
                  const selo = SELO[classe(c)]
                  const alvoNome = (c.alvo_nome && c.alvo_nome.trim()) || '—'
                  return (
                    <tr key={c.id} style={{ borderTop: `1px solid ${C.offWhiteDarker}` }}>
                      <td style={td()}>{provedorNome(c.provedor_codigo)}</td>
                      <td style={td()}>
                        <div style={{ color: C.espresso }}>{alvoNome}</div>
                        <div style={{ color: C.espressoLight, fontSize: 12 }}>{fmtDoc(c.alvo_documento)}</div>
                      </td>
                      <td style={td()}>
                        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 12, fontWeight: 600, color: selo.cor, background: selo.bg }}>
                          {selo.txt}
                        </span>
                        {c.erro_mensagem && classe(c) === 'erro' && (
                          <div style={{ color: C.espressoLight, fontSize: 11, marginTop: 2 }}>{c.erro_mensagem}</div>
                        )}
                      </td>
                      <td style={td()}>{c.numero_documento_emitido || '—'}</td>
                      <td style={td()}>{fmtData(c.data_validade)}</td>
                      <td style={td()}>{fmtDataHora(c.created_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {consultas.length > 0 && filtradas.length === 0 && (
          <p style={{ fontSize: 13, color: C.espressoLight, textAlign: 'center', padding: '20px 0' }}>
            Nenhuma consulta com esses filtros. Ajuste a busca, o provedor ou a situação.
          </p>
        )}
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ backgroundColor: C.offWhite, minHeight: '100vh', color: C.espresso }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 16px' }}>
        <header style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.2, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>
            <Link href="/dashboard/compliance" style={{ color: 'inherit', textDecoration: 'none' }}>Compliance</Link>
            {' '}&gt;{' '}Validação Automática
          </p>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 30, fontWeight: 400, margin: '4px 0 6px' }}>
            Validação Automática
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: C.espressoLight }}>
            Certidões de regularidade — CNDT (Trabalhista), CND Federal e CRF FGTS — consultadas e guardadas por empresa.
          </p>
        </header>
        {children}
      </div>
    </div>
  )
}

function Kpi({ chave, rotulo, valor, cor }: { chave: string; rotulo: string; valor: number; cor: string }) {
  return (
    <div style={{ background: 'white', border: `1px solid ${C.offWhiteDarker}`, borderRadius: PSGC_RADIUS?.md ?? 12, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: C.espressoLight }}>
        {rotulo}<AjudaCampo chave={chave} rota={ROTA_AJUDA} />
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: cor, marginTop: 4 }}>{valor}</div>
    </div>
  )
}

const card = (): React.CSSProperties => ({
  background: 'white', borderRadius: PSGC_RADIUS?.md ?? 12, padding: '20px 20px',
  boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', border: `1px solid ${C.offWhiteDarker}`,
})
const h2 = (): React.CSSProperties => ({ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, fontWeight: 400, margin: 0, color: C.espresso })
const lbl = (): React.CSSProperties => ({ display: 'flex', flexDirection: 'column', gap: 4 })
const lblTxt = (): React.CSSProperties => ({ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: C.espressoLight })
const inp = (): React.CSSProperties => ({
  padding: '9px 10px', borderRadius: 8, border: `1px solid ${C.offWhiteDarker}`,
  fontSize: 14, color: C.espresso, background: 'white', outline: 'none',
})
const th = (): React.CSSProperties => ({ textAlign: 'left', padding: '8px 10px', fontSize: 12, fontWeight: 600, color: C.espressoLight, whiteSpace: 'nowrap' })
const td = (): React.CSSProperties => ({ padding: '10px', verticalAlign: 'top', color: C.espresso })
const btnPrimario = (disabled: boolean): React.CSSProperties => ({
  padding: '10px 20px', borderRadius: 8, border: 'none', cursor: disabled ? 'default' : 'pointer',
  background: disabled ? C.douradoSoft : C.dourado, color: 'white', fontSize: 14, fontWeight: 600,
})
const btnSecundario = (disabled: boolean): React.CSSProperties => ({
  padding: '9px 14px', borderRadius: 8, border: `1px solid ${C.offWhiteDarker}`, cursor: disabled ? 'default' : 'pointer',
  background: 'white', color: C.espresso, fontSize: 13, fontWeight: 600,
})
