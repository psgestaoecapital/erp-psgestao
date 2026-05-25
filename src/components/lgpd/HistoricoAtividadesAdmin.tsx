'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface EventoAudit {
  id: string
  user_email: string | null
  tabela: string
  registro_id: string | null
  acao: string
  valor_anterior: unknown
  valor_novo: unknown
  ip: string | null
  user_agent?: string | null
  created_at: string
}

interface Resposta {
  erro?: boolean
  mensagem?: string
  total?: number
  resultados?: EventoAudit[]
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  border: '0.5px solid rgba(61,35,20,0.25)',
  borderRadius: 6,
  fontSize: 12,
  background: '#FFFFFF',
  color: '#3D2314',
  boxSizing: 'border-box',
}

export default function HistoricoAtividadesAdmin({ companyId }: { companyId: string }) {
  const router = useRouter()
  const [resultados, setResultados] = useState<EventoAudit[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [eventoExpandido, setEventoExpandido] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [filtroTabela, setFiltroTabela] = useState('')
  const [filtroAcao, setFiltroAcao] = useState('')
  const [filtroUserEmail, setFiltroUserEmail] = useState('')

  async function buscar() {
    setLoading(true)
    setErro(null)
    const { data, error } = await supabase.rpc('fn_audit_consulta_admin', {
      p_company_id: companyId,
      p_data_inicio: dataInicio || null,
      p_data_fim: dataFim || null,
      p_tabela: filtroTabela || null,
      p_acao: filtroAcao || null,
      p_user_email: filtroUserEmail || null,
      p_limit: 100,
    })
    setLoading(false)

    if (error) {
      setErro(error.message)
      setResultados([])
      setTotal(0)
      return
    }
    const resp = data as Resposta | null
    if (resp?.erro) {
      setErro(resp.mensagem ?? 'Acesso negado ou erro na consulta.')
      setResultados([])
      setTotal(0)
      return
    }
    setResultados(resp?.resultados ?? [])
    setTotal(resp?.total ?? 0)
  }

  function limparFiltros() {
    setDataInicio('')
    setDataFim('')
    setFiltroTabela('')
    setFiltroAcao('')
    setFiltroUserEmail('')
    setTimeout(buscar, 0)
  }

  useEffect(() => {
    if (companyId) buscar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  return (
    <div style={{ background: '#FAF7F2', minHeight: '100vh', padding: '32px 28px' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
          Administração · Pilar 1 Legal LGPD
        </div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, color: '#3D2314', margin: 0, fontWeight: 400 }}>
          Histórico de Atividades
        </h1>
        <div style={{ fontSize: 13, color: 'rgba(61,35,20,0.65)', marginTop: 4 }}>
          Tudo que aconteceu no sistema · quem fez · quando · o quê
        </div>
        <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.5)', marginTop: 2 }}>
          Cumprimento LGPD Art. 37 · registro de operações de tratamento de dados
        </div>
      </div>

      <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 12, padding: '18px 22px', marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <Campo label="📅 De">
            <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} style={inputStyle} />
          </Campo>
          <Campo label="📅 Até">
            <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} style={inputStyle} />
          </Campo>
          <Campo label="📂 Onde">
            <input value={filtroTabela} onChange={(e) => setFiltroTabela(e.target.value)} placeholder="ex: erp_clientes" style={inputStyle} />
          </Campo>
          <Campo label="🎬 O quê">
            <select value={filtroAcao} onChange={(e) => setFiltroAcao(e.target.value)} style={inputStyle}>
              <option value="">— qualquer ação —</option>
              <option value="INSERT">Criou (INSERT)</option>
              <option value="UPDATE">Alterou (UPDATE)</option>
              <option value="DELETE">Excluiu (DELETE)</option>
            </select>
          </Campo>
          <Campo label="👤 Quem">
            <input value={filtroUserEmail} onChange={(e) => setFiltroUserEmail(e.target.value)} placeholder="email parcial" style={inputStyle} />
          </Campo>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={limparFiltros}
            style={{ background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.25)', padding: '8px 16px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
          >
            Limpar
          </button>
          <button
            type="button"
            onClick={buscar}
            disabled={loading}
            style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '8px 20px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.6 : 1 }}
          >
            {loading ? 'Buscando…' : '🔍 Filtrar'}
          </button>
        </div>
      </div>

      {erro && (
        <div style={{ background: '#FCEBEB', color: '#A32D2D', padding: '10px 14px', borderRadius: 6, marginBottom: 16, fontSize: 13 }}>{erro}</div>
      )}

      <div style={{ display: 'flex', gap: 16, marginBottom: 14, fontSize: 12, color: 'rgba(61,35,20,0.6)', flexWrap: 'wrap' }}>
        <span>Total no período: <strong style={{ color: '#3D2314' }}>{total.toLocaleString('pt-BR')}</strong></span>
        <span>·</span>
        <span>Mostrando: <strong style={{ color: '#3D2314' }}>{resultados.length}</strong></span>
        {total > 100 && <span style={{ color: '#854F0B' }}>· refine os filtros para ver mais</span>}
      </div>

      {resultados.length === 0 ? (
        <div style={{ background: '#FFFFFF', borderRadius: 12, padding: 60, textAlign: 'center', color: 'rgba(61,35,20,0.6)', fontSize: 13 }}>
          {loading ? 'Carregando…' : (
            <>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
              Nenhuma atividade encontrada nesse período com esses filtros.
            </>
          )}
        </div>
      ) : (
        <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 12, overflow: 'hidden' }}>
          {resultados.map((ev) => (
            <EventoRow
              key={ev.id}
              evento={ev}
              expandido={eventoExpandido === ev.id}
              onToggle={() => setEventoExpandido(eventoExpandido === ev.id ? null : ev.id)}
            />
          ))}
        </div>
      )}

      <div style={{ marginTop: 32, textAlign: 'center' }}>
        <button
          type="button"
          onClick={() => router.push('/dashboard/gestao-empresarial')}
          style={{ background: 'transparent', color: '#C8941A', border: '0.5px solid #C8941A', padding: '10px 24px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          ← Voltar ao painel
        </button>
      </div>
    </div>
  )
}

function EventoRow({ evento, expandido, onToggle }: { evento: EventoAudit; expandido: boolean; onToggle: () => void }) {
  const acaoCor = evento.acao === 'INSERT' ? '#3B6D11' : evento.acao === 'UPDATE' ? '#BA7517' : '#A32D2D'
  const acaoBg = evento.acao === 'INSERT' ? 'rgba(59,109,17,0.15)' : evento.acao === 'UPDATE' ? 'rgba(186,117,23,0.15)' : 'rgba(163,45,45,0.15)'
  const acaoLabel = evento.acao === 'INSERT' ? 'CRIOU' : evento.acao === 'UPDATE' ? 'ALTEROU' : evento.acao === 'DELETE' ? 'EXCLUIU' : evento.acao

  return (
    <div style={{ borderBottom: '0.5px solid rgba(61,35,20,0.08)' }}>
      <button
        type="button"
        onClick={onToggle}
        style={{ width: '100%', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', flexWrap: 'wrap', background: 'transparent', border: 'none', textAlign: 'left', font: 'inherit' }}
      >
        <div style={{ minWidth: 130, fontSize: 11, color: 'rgba(61,35,20,0.6)', fontVariantNumeric: 'tabular-nums' }}>
          {new Date(evento.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </div>
        <div style={{ minWidth: 80 }}>
          <span style={{ background: acaoBg, color: acaoCor, fontSize: 10, padding: '3px 8px', borderRadius: 3, fontWeight: 700, letterSpacing: 0.5 }}>{acaoLabel}</span>
        </div>
        <div style={{ flex: 1, fontSize: 12, color: '#3D2314', minWidth: 200 }}>
          <strong>{evento.user_email || 'usuário do sistema'}</strong>{' '}em{' '}<strong>{evento.tabela}</strong>
          {evento.registro_id && (
            <span style={{ color: 'rgba(61,35,20,0.5)' }}>
              {' · '}registro {evento.registro_id.slice(0, 8)}…
            </span>
          )}
        </div>
        {evento.ip && (
          <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.5)', fontFamily: 'monospace' }}>{evento.ip}</div>
        )}
        <div style={{ fontSize: 14, color: 'rgba(61,35,20,0.4)' }}>{expandido ? '▼' : '▶'}</div>
      </button>
      {expandido && (
        <div style={{ padding: '14px 20px', background: 'rgba(61,35,20,0.03)', fontSize: 11 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            <div>
              <div style={{ fontWeight: 700, color: 'rgba(61,35,20,0.7)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10 }}>Antes</div>
              <pre style={{ background: '#FFFFFF', padding: 10, borderRadius: 6, overflow: 'auto', maxHeight: 200, fontSize: 10, margin: 0 }}>
                {evento.valor_anterior ? JSON.stringify(evento.valor_anterior, null, 2) : '— (registro novo)'}
              </pre>
            </div>
            <div>
              <div style={{ fontWeight: 700, color: 'rgba(61,35,20,0.7)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10 }}>Depois</div>
              <pre style={{ background: '#FFFFFF', padding: 10, borderRadius: 6, overflow: 'auto', maxHeight: 200, fontSize: 10, margin: 0 }}>
                {evento.valor_novo ? JSON.stringify(evento.valor_novo, null, 2) : '— (registro excluído)'}
              </pre>
            </div>
          </div>
          {evento.user_agent && (
            <div style={{ marginTop: 10, fontSize: 10, color: 'rgba(61,35,20,0.5)' }}>
              <strong>Navegador:</strong> {evento.user_agent}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 9, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, fontWeight: 700 }}>
        {label}
      </label>
      {children}
    </div>
  )
}
