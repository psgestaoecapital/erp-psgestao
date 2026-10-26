'use client'

// HB0 · Cockpit — visão de todas as obras (avanço, custo, margem, pendências) e porta para /obras/[id]/cockpit (1 obra = abre direto).
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { comPrazo, MSG_CARREGAMENTO_FALHOU } from '@/lib/comPrazo'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.65)', VERDE = '#15803D', VERM = '#B91C1C'
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const ROTA = '/dashboard/projetos/cockpit'
// Cada situação tem cor e fundo próprios (pílula) com contraste forte — leitura imediata.
const STATUS: Record<string, { rotulo: string; cor: string; fundo: string }> = {
  em_andamento: { rotulo: 'Em andamento', cor: '#78350F', fundo: 'rgba(200,148,26,0.28)' },
  concluida: { rotulo: 'Concluída', cor: '#14532D', fundo: 'rgba(21,128,61,0.22)' },
  pausada: { rotulo: 'Pausada', cor: '#44403C', fundo: 'rgba(61,35,20,0.14)' },
  cancelada: { rotulo: 'Cancelada', cor: '#7F1D1D', fundo: 'rgba(185,28,28,0.18)' },
}
const situacao = (s: string) => STATUS[s] ?? { rotulo: s, cor: ESP, fundo: 'rgba(200,148,26,0.2)' }

type ObraLinha = {
  obra_id: string; numero: string; nome: string | null; status: string
  custo_previsto: number | null; receita_prevista: number | null; receita_servico: number | null; receita_material: number | null
  custo_material: number | null; custo_viagens: number | null; custo_mao_obra: number | null; custo_rateio: number | null
  margem_alocada: number | null; margem_realizada: number | null
}

const n = (v: number | null | undefined) => Number(v ?? 0)
function indicadores(o: ObraLinha) {
  const receita = n(o.receita_servico) + n(o.receita_material)
  const custo = n(o.custo_material) + n(o.custo_viagens) + n(o.custo_mao_obra) + n(o.custo_rateio)
  const margem = o.margem_alocada ?? o.margem_realizada ?? receita - custo
  const prev = n(o.receita_prevista)
  const avanco = prev > 0 ? Math.min(100, (n(o.receita_servico) / prev) * 100) : null
  const pend: string[] = []
  if (prev === 0) pend.push('Sem itens contratados')
  if (n(o.custo_previsto) > 0 && custo > n(o.custo_previsto)) pend.push('Custo acima do previsto')
  if (Number(margem) < 0) pend.push('Margem negativa')
  return { receita, custo, margem: Number(margem), avanco, pend, estouro: pend.includes('Custo acima do previsto') }
}

export default function CockpitEscolherObraPage() {
  const router = useRouter()
  const { companyIds } = useCompanyIds()
  const [obras, setObras] = useState<ObraLinha[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState('todas')

  useEffect(() => {
    if (!companyIds?.length) { setLoading(false); return }
    let vivo = true
    ;(async () => {
      try {
        const { data, error } = await comPrazo(
          async () => await supabase.from('v_obra_resultado_alocado').select('*').in('company_id', companyIds).order('numero', { ascending: false }),
          { ms: 8000, tentativas: 1, label: 'cockpit-obras' },
        )
        if (!vivo) return
        if (error) { setErro(error.message); return }
        const lista = (data ?? []) as ObraLinha[]
        if (lista.length === 1) { router.replace(`/dashboard/projetos/obras/${lista[0].obra_id}/cockpit?area=hub`); return }
        setObras(lista)
      } catch { if (vivo) setErro(MSG_CARREGAMENTO_FALHOU) } finally { if (vivo) setLoading(false) }
    })()
    return () => { vivo = false }
  }, [companyIds, router])

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return obras.filter(o => (filtro === 'todas' || o.status === filtro) && (!q || `${o.numero} ${o.nome ?? ''}`.toLowerCase().includes(q)))
  }, [obras, busca, filtro])

  return (
    <div style={{ background: BG, padding: '20px 24px', color: ESP }} data-testid="cockpit-escolher">
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Cockpit da obra <AjudaCampo chave="projetos.cockpit.escolher_obra" rota={ROTA} /></h1>
      <p style={{ color: MUT, fontSize: 13, margin: '4px 0 16px' }}>Avanço, custo, margem e pendências de cada obra. Toque numa obra para abrir o cockpit completo.</p>
      {obras.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input data-testid="cockpit-busca" aria-label="Buscar obra" placeholder="Buscar por número ou nome" value={busca} onChange={e => setBusca(e.target.value)}
              style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, minWidth: 220, background: '#fff', color: ESP }} />
            <AjudaCampo chave="projetos.cockpit.busca" rota={ROTA} />
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <select data-testid="cockpit-filtro" aria-label="Situação" value={filtro} onChange={e => setFiltro(e.target.value)}
              style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, background: '#fff', color: ESP }}>
              <option value="todas">Todas as situações</option>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.rotulo}</option>)}
            </select>
            <AjudaCampo chave="projetos.cockpit.filtro_situacao" rota={ROTA} />
          </span>
          <span style={{ fontSize: 12, color: MUT }}>{visiveis.length} de {obras.length} obras</span>
        </div>
      )}
      {loading && <div style={{ color: MUT }}>Carregando…</div>}
      {erro && <div style={{ background: '#FBEAEA', color: VERM, borderRadius: 8, padding: '8px 10px', fontSize: 13 }}>{erro}</div>}
      {!loading && !erro && obras.length === 0 && (
        <div style={{ color: MUT, fontSize: 14 }}>Nenhuma obra ainda. Aprove um orçamento para criar a primeira obra em <Link href="/dashboard/projetos/obras?area=hub" style={{ color: ESP, textDecoration: 'underline' }}>Obras</Link>.</div>
      )}
      {!loading && obras.length > 0 && visiveis.length === 0 && <div style={{ color: MUT, fontSize: 14 }}>Nenhuma obra com esse filtro.</div>}
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))' }}>
        {visiveis.map(o => {
          const i = indicadores(o)
          return (
            <Link key={o.obra_id} href={`/dashboard/projetos/obras/${o.obra_id}/cockpit?area=hub`} data-testid="cockpit-obra-link"
              style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: '12px 14px', textDecoration: 'none', color: ESP }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{o.numero}</div>
              <div style={{ fontSize: 13, color: MUT, marginTop: 2 }}>{o.nome || 'Sem nome'}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, color: situacao(o.status).cor, background: situacao(o.status).fundo, borderRadius: 999, padding: '2px 9px' }}>{situacao(o.status).rotulo}</span>
                <AjudaCampo chave="projetos.cockpit.status_obra" rota={ROTA} />
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: MUT }}>Avanço <AjudaCampo chave="projetos.cockpit.card_avanco" rota={ROTA} /> <b style={{ color: ESP }}>{i.avanco == null ? '—' : `${i.avanco.toFixed(0)}%`}</b></div>
              <div role="progressbar" aria-valuenow={Math.round(i.avanco ?? 0)} aria-valuemin={0} aria-valuemax={100} style={{ height: 6, background: LINE, borderRadius: 3, marginTop: 3 }}>
                <div style={{ width: `${i.avanco ?? 0}%`, height: 6, background: GOLD, borderRadius: 3 }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 10, fontSize: 12 }}>
                <div><div style={{ color: MUT }}>Custo <AjudaCampo chave="projetos.cockpit.card_custo" rota={ROTA} /></div><b style={{ color: i.estouro ? VERM : ESP }}>{brl(i.custo)}</b></div>
                <div style={{ textAlign: 'right' }}><div style={{ color: MUT }}>Margem <AjudaCampo chave="projetos.cockpit.card_margem" rota={ROTA} /></div><b style={{ color: i.margem < 0 ? VERM : VERDE }}>{brl(i.margem)}</b></div>
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: i.pend.length ? VERM : VERDE }}>
                {i.pend.length ? `${i.pend.length} pendência${i.pend.length > 1 ? 's' : ''}: ${i.pend.join(', ')}` : 'Sem pendências'} <AjudaCampo chave="projetos.cockpit.card_pendencias" rota={ROTA} />
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
