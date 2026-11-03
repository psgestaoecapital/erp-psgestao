'use client'
// P&M · CONTRATADO × REALIZADO (Blueprint P&M §2 · Fase 1 · P6 — META CEO 02/11). Code: code-desenvolvedor-3.
// Por cliente e item do contrato: o contratado (ex.: 4 posts/mês), o realizado (jobs do serviço no período),
// saldo, % e situação (verde/amarelo/vermelho). O alerta amarelo de ultrapassagem ao criar/mover job usa a RPC
// fn_pm_contrato_item_previa (nunca bloqueia). Escopo por company_id (RD-45). Tema Espresso (RD-96/RD-99). "?" RD-95.
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESPRESSO = '#3D2314', OFFWHITE = '#FAF7F2', DOURADO = '#C8941A', BORDA = '#E7DED3', TEXTM = '#6b5444'
const GREEN = '#1F5A1F', YELLOW = '#7A5A0F', RED = '#7A1F1F'

type Linha = {
  contrato_id: string; item_id: string; cliente_id: string | null; cliente_nome: string
  tipo_servico: string | null; servico_id: string | null; servico_nome: string | null
  unidade: string | null; periodicidade: string | null
  contratado: number; realizado: number; saldo: number; pct: number | null; status: 'ok' | 'atencao' | 'estourado'
}

const mesAtual = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const nfmt = (v: number | null) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 }))

const SELO: Record<Linha['status'], { txt: string; bg: string; fg: string }> = {
  ok: { txt: 'No prazo', bg: '#E8F3E8', fg: GREEN },
  atencao: { txt: 'No limite', bg: '#FBF3DE', fg: YELLOW },
  estourado: { txt: 'Ultrapassou', bg: '#F6E4E4', fg: RED },
}

export default function ContratadoRealizadoPage() {
  const { companyIds, loading: loadingCompany } = useCompanyIds()
  const empresa = companyIds[0] ?? null
  const [mes, setMes] = useState(mesAtual())
  const [cliente, setCliente] = useState<string>('todos')
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!empresa) { setLoading(false); return }
    setLoading(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_pm_contratado_realizado', { p_mes: `${mes}-01`, p_cliente_id: null })
    if (error) { setErro('Não foi possível carregar o acompanhamento agora.'); setLinhas([]); setLoading(false); return }
    setLinhas((data ?? []) as Linha[])
    setLoading(false)
  }, [empresa, mes])

  useEffect(() => { void carregar() }, [carregar])

  const clientes = useMemo(() => {
    const m = new Map<string, string>()
    linhas.forEach((l) => { if (l.cliente_id) m.set(l.cliente_id, l.cliente_nome) })
    return Array.from(m, ([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [linhas])

  const visiveis = useMemo(
    () => (cliente === 'todos' ? linhas : linhas.filter((l) => l.cliente_id === cliente)),
    [linhas, cliente],
  )
  const resumo = useMemo(() => ({
    estourado: visiveis.filter((l) => l.status === 'estourado').length,
    atencao: visiveis.filter((l) => l.status === 'atencao').length,
    ok: visiveis.filter((l) => l.status === 'ok').length,
  }), [visiveis])

  const card: CSSProperties = { background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 14, boxShadow: '0 1px 2px rgba(61,35,20,.04)' }
  const th: CSSProperties = { textAlign: 'left', padding: '10px 12px', fontSize: 12, fontWeight: 700, color: TEXTM, textTransform: 'uppercase', letterSpacing: '.03em', whiteSpace: 'nowrap' }
  const td: CSSProperties = { padding: '12px', borderTop: `1px solid ${BORDA}`, color: ESPRESSO, fontSize: 14, verticalAlign: 'middle' }

  const Selo = ({ s }: { s: Linha['status'] }) => {
    const v = SELO[s]
    return <span style={{ background: v.bg, color: v.fg, fontWeight: 700, fontSize: 12, padding: '3px 10px', borderRadius: 999, whiteSpace: 'nowrap' }}>{v.txt}</span>
  }

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '20px 16px 64px' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto' }}>
        <h1 style={{ color: ESPRESSO, fontSize: 24, fontWeight: 800, margin: '0 0 4px', letterSpacing: '-.01em' }}>Contratado × realizado</h1>
        <p style={{ color: TEXTM, margin: '0 0 20px', fontSize: 14, maxWidth: 640 }}>
          O que cada cliente contratou e o que já virou job no período. O amarelo avisa que está no limite; o vermelho, que
          passou do contratado — sempre como aviso, nunca como bloqueio.
        </p>

        {/* filtros */}
        <div style={{ ...card, padding: 16, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end', marginBottom: 16 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: TEXTM, fontWeight: 600 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Mês <AjudaCampo chave="pm.contratado.filtro_mes" /></span>
            <input type="month" value={mes} onChange={(e) => setMes(e.target.value || mesAtual())}
              style={{ padding: '9px 12px', border: `1px solid ${BORDA}`, borderRadius: 10, fontSize: 14, color: ESPRESSO, background: '#fff', minWidth: 160 }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: TEXTM, fontWeight: 600 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Cliente <AjudaCampo chave="pm.contratado.filtro_cliente" /></span>
            <select value={cliente} onChange={(e) => setCliente(e.target.value)}
              style={{ padding: '9px 12px', border: `1px solid ${BORDA}`, borderRadius: 10, fontSize: 14, color: ESPRESSO, background: '#fff', minWidth: 200 }}>
              <option value="todos">Todos</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: TEXTM, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              Situação <AjudaCampo chave="pm.contratado.alerta" />
            </span>
            {resumo.estourado > 0 && <Selo s="estourado" />}
            {resumo.atencao > 0 && <Selo s="atencao" />}
          </div>
        </div>

        {/* conteúdo */}
        {loading || loadingCompany ? (
          <div style={{ ...card, padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div>
        ) : erro ? (
          <div style={{ ...card, padding: 24, color: RED }}>{erro}</div>
        ) : visiveis.length === 0 ? (
          <div style={{ ...card, padding: 40, textAlign: 'center', color: TEXTM }}>
            Nenhum item contratado para mostrar neste mês. Cadastre os itens do contrato em P&amp;M › Contratos.
          </div>
        ) : (
          <>
            {/* tabela (telas largas) */}
            <div className="cr-tabela" style={{ ...card, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#FBF8F3' }}>
                    <th style={th}>Cliente <AjudaCampo chave="pm.contratado.col_cliente" /></th>
                    <th style={th}>Item / serviço <AjudaCampo chave="pm.contratado.col_item" /></th>
                    <th style={{ ...th, textAlign: 'right' }}>Contratado <AjudaCampo chave="pm.contratado.col_contratado" /></th>
                    <th style={{ ...th, textAlign: 'right' }}>Realizado <AjudaCampo chave="pm.contratado.col_realizado" /></th>
                    <th style={{ ...th, textAlign: 'right' }}>Saldo <AjudaCampo chave="pm.contratado.col_saldo" /></th>
                    <th style={{ ...th, textAlign: 'right' }}>% <AjudaCampo chave="pm.contratado.col_pct" /></th>
                    <th style={th}>Situação <AjudaCampo chave="pm.contratado.col_status" /></th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((l) => (
                    <tr key={l.item_id}>
                      <td style={td}>{l.cliente_nome}</td>
                      <td style={td}>{l.servico_nome || l.tipo_servico || '—'}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{nfmt(l.contratado)} {l.unidade ? <span style={{ color: TEXTM, fontSize: 12 }}>{l.unidade}</span> : null}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{nfmt(l.realizado)}</td>
                      <td style={{ ...td, textAlign: 'right', color: l.saldo < 0 ? RED : ESPRESSO }}>{nfmt(l.saldo)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{l.pct == null ? '—' : `${nfmt(l.pct)}%`}</td>
                      <td style={td}><Selo s={l.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* cards (celular) */}
            <div className="cr-cards" style={{ display: 'none', flexDirection: 'column', gap: 12 }}>
              {visiveis.map((l) => (
                <div key={l.item_id} style={{ ...card, padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 800, color: ESPRESSO, fontSize: 15 }}>{l.servico_nome || l.tipo_servico || '—'}</div>
                      <div style={{ color: TEXTM, fontSize: 13 }}>{l.cliente_nome}</div>
                    </div>
                    <Selo s={l.status} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginTop: 12, textAlign: 'center' }}>
                    {[
                      ['Contratado', `${nfmt(l.contratado)}${l.unidade ? ' ' + l.unidade : ''}`],
                      ['Realizado', nfmt(l.realizado)],
                      ['Saldo', nfmt(l.saldo)],
                      ['%', l.pct == null ? '—' : `${nfmt(l.pct)}%`],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <div style={{ fontSize: 11, color: TEXTM, textTransform: 'uppercase', letterSpacing: '.03em' }}>{k}</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: k === 'Saldo' && l.saldo < 0 ? RED : ESPRESSO }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <p style={{ color: TEXTM, fontSize: 12, marginTop: 20, borderTop: `1px solid ${BORDA}`, paddingTop: 12 }}>
          O realizado conta os jobs do serviço no contrato, no período — jobs excluídos não entram. Itens por projeto ou
          único somam o contrato inteiro.
        </p>
      </div>

      <style>{`
        @media (max-width: 720px) {
          .cr-tabela { display: none !important; }
          .cr-cards { display: flex !important; }
        }
      `}</style>
    </div>
  )
}
