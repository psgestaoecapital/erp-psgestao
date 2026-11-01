'use client'
// Tela 297 (H9 · Gestão de Obras) — Relatório ao cliente da obra. Só leitura: reúne numa página o que o cliente
// precisa ver (avanço, prazo, valor previsto × medido, registros do diário) e permite "Imprimir / Salvar PDF".
// Dado vem de fn_obra_relatorio_cliente (SECURITY INVOKER, guarda por empresa, REVOKE anon) — a tela não acessa
// tabela direta. RD-95: "?" nos indicadores (erp_ajuda_campo). RD-100: nenhum nome de outro sistema.
import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { ehUuid, erroAmigavel } from '@/lib/erroAmigavel'
import { comPrazo, MSG_CARREGAMENTO_FALHOU } from '@/lib/comPrazo'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/projetos/obras/[id]/relatorio'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', MUT = 'rgba(61,35,20,0.55)', VERDE = '#16A34A'
const brl = (n: number | null | undefined) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const num = (n: number | null | undefined) => (n ?? 0).toLocaleString('pt-BR')
const dia = (d: string | null | undefined) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR') : '—')

type Relatorio = {
  obra_id: string; numero: string | null; nome: string | null; cliente_nome: string | null; status: string | null
  endereco: string | null; cidade: string | null; uf: string | null
  data_inicio: string | null; data_prevista_fim: string | null
  pct_conclusao: number | null; valor_previsto: number | null; valor_medido: number | null
  dias_diario: number | null; fotos_total: number | null; medicoes_total: number | null
  gerado_em: string | null
}

const STATUS_ROTULO: Record<string, string> = {
  planejada: 'Planejada', em_andamento: 'Em andamento', concluida: 'Concluída',
  entregue: 'Entregue', pausada: 'Pausada', cancelada: 'Cancelada',
}

export default function RelatorioClienteObraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [r, setR] = useState<Relatorio | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const consulta = useCallback(async () => await supabase.rpc('fn_obra_relatorio_cliente', { p_obra_id: id }), [id])
  const carregar = useCallback(async () => {
    if (!ehUuid(id)) { setLoading(false); setErro('Obra não encontrada. Abra pela lista de obras.'); return }
    setLoading(true); setErro(null)
    let res: Awaited<ReturnType<typeof consulta>>
    try { res = await comPrazo(consulta, { ms: 8000, tentativas: 1, label: 'obra-relatorio' }) } catch { setLoading(false); setErro(MSG_CARREGAMENTO_FALHOU); return }
    const { data, error } = res
    setLoading(false)
    if (error) { setErro(erroAmigavel(error, 'Não foi possível carregar o relatório. Tente de novo.')); return }
    const linha = Array.isArray(data) ? (data[0] as Relatorio | undefined) : null
    if (!linha) { setErro('Esta obra não existe ou você não tem acesso a ela na empresa ativa. Troque de empresa ou abra pela lista de obras.'); return }
    setR(linha)
  }, [consulta, id])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  const pct = r?.pct_conclusao == null ? null : Math.max(0, Math.min(100, Number(r.pct_conclusao)))
  const endereco = r ? [r.endereco, [r.cidade, r.uf].filter(Boolean).join('/')].filter(Boolean).join(' · ') : ''

  return (
    <div style={{ minHeight: '100vh', background: BG, padding: '20px 16px 48px' }}>
      <style>{`@media print { .no-print { display: none !important; } body { background: #fff !important; } .rel-card { box-shadow: none !important; border: none !important; } }`}</style>

      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <div className="no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <Link href={`/dashboard/projetos/obras/${id}/cockpit?area=hub`} style={{ fontSize: 12, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>← Cockpit da obra</Link>
          <button
            type="button"
            data-testid="btn-imprimir-relatorio"
            onClick={() => window.print()}
            disabled={!r}
            style={{ background: ESP, color: BG, border: 'none', borderRadius: 10, padding: '10px 18px', fontSize: 13, fontWeight: 700, cursor: r ? 'pointer' : 'default', opacity: r ? 1 : 0.5 }}
          >Imprimir / Salvar PDF</button>
        </div>

        {loading && <div style={{ color: MUT, fontSize: 14, padding: '40px 0', textAlign: 'center' }}>Carregando relatório…</div>}

        {!loading && erro && (
          <div className="rel-card" style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: 28, textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: ESP, marginBottom: 16 }}>{erro}</div>
            <Link href="/dashboard/projetos/obras?area=hub" style={{ display: 'inline-block', background: ESP, color: BG, borderRadius: 10, padding: '10px 20px', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>Voltar para Obras</Link>
          </div>
        )}

        {!loading && !erro && r && (
          <div className="rel-card" style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: '28px 28px 22px', boxShadow: '0 1px 2px rgba(61,35,20,0.06)' }}>
            <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: GOLD, fontWeight: 700 }}>Relatório da obra</div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: ESP, margin: '6px 0 2px', lineHeight: 1.2 }}>{r.nome || 'Obra'}</h1>
            <div style={{ fontSize: 13, color: MUT }}>
              {r.numero ? `Nº ${r.numero}` : ''}{r.numero && r.cliente_nome ? ' · ' : ''}{r.cliente_nome ? `Cliente: ${r.cliente_nome}` : ''}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: ESP, background: '#F3ECE1', border: `1px solid ${LINE}`, borderRadius: 999, padding: '3px 12px' }}>
                {r.status ? (STATUS_ROTULO[r.status] ?? r.status) : '—'}
              </span>
              {endereco && <span style={{ fontSize: 12.5, color: MUT }}>{endereco}</span>}
            </div>

            {/* Avanço */}
            <div style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${LINE}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: MUT, fontWeight: 700 }}>
                Avanço da obra<AjudaCampo chave="projetos.obra.relatorio.conclusao" rota={ROTA} />
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
                <div style={{ fontSize: 30, fontWeight: 800, color: ESP }}>{pct == null ? '—' : `${pct.toFixed(0)}%`}</div>
                <div style={{ fontSize: 12, color: MUT }}>{pct == null ? 'Avanço ainda não lançado' : 'executado'}</div>
              </div>
              <div style={{ height: 10, background: '#EFE7DB', borderRadius: 999, overflow: 'hidden', marginTop: 8 }}>
                <div style={{ height: '100%', width: `${pct ?? 0}%`, background: GOLD }} />
              </div>
            </div>

            {/* Prazo + valores */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginTop: 20 }}>
              <Indicador titulo="Prazo" ajuda="projetos.obra.relatorio.prazo" valor={`${dia(r.data_inicio)} → ${dia(r.data_prevista_fim)}`} />
              <Indicador titulo="Valor previsto" ajuda="projetos.obra.relatorio.valor_previsto" valor={brl(Number(r.valor_previsto))} />
              <Indicador titulo="Valor medido" ajuda="projetos.obra.relatorio.valor_medido" valor={brl(Number(r.valor_medido))} cor={VERDE} />
            </div>

            {/* Registros */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14, marginTop: 14 }}>
              <Indicador titulo="Dias de diário" ajuda="projetos.obra.relatorio.diario" valor={num(r.dias_diario)} />
              <Indicador titulo="Fotos do diário" ajuda="projetos.obra.relatorio.fotos" valor={num(r.fotos_total)} />
              <Indicador titulo="Medições" ajuda="projetos.obra.relatorio.medicoes" valor={num(r.medicoes_total)} />
            </div>

            <div style={{ marginTop: 22, paddingTop: 14, borderTop: `1px solid ${LINE}`, fontSize: 11.5, color: MUT }}>
              Gerado em {r.gerado_em ? new Date(r.gerado_em).toLocaleString('pt-BR') : '—'}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Indicador({ titulo, ajuda, valor, cor }: { titulo: string; ajuda: string; valor: string; cor?: string }) {
  return (
    <div style={{ background: '#FBF8F3', border: `1px solid ${LINE}`, borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, fontWeight: 700 }}>
        {titulo}<AjudaCampo chave={ajuda} rota={ROTA} />
      </div>
      <div style={{ fontSize: 17, fontWeight: 800, color: cor ?? ESP, marginTop: 4 }}>{valor}</div>
    </div>
  )
}
