'use client'
// PORTFOLIO (P&M). Jobs publicados (entregas concluídas) por cliente/período. Galeria simples.
// Escopo por company_id (RD-45). Tema Espresso.
// Capa real da entrega: usa a 1ª imagem de agency_jobs.arquivos quando houver (fallback para o ícone por tipo).
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type Arquivo = { url?: string | null; nome?: string | null }
type Job = { id: string; titulo: string; tipo: string | null; valor_job: number | null; cliente_id: string | null; data_entrega: string | null; data_prazo: string | null; arquivos: Arquivo[] | null }
type Cli = { id: string; nome: string; nome_fantasia: string | null }

const IMG_RE = /\.(png|jpe?g|webp|gif|svg|avif)(\?|#|$)/i
const emojiTipo = (tipo: string | null) => (tipo === 'design' ? '🎨' : tipo === 'video' ? '🎬' : '📣')
// 1ª imagem anexada ao job (por extensão do nome ou da url); null quando não há.
function capaDoJob(j: Job): string | null {
  const arr = Array.isArray(j.arquivos) ? j.arquivos : []
  for (const a of arr) {
    const u = (a?.url ?? '').trim(); const n = (a?.nome ?? '').trim()
    if (u && (IMG_RE.test(n) || IMG_RE.test(u))) return u
  }
  return null
}

function Capa({ job }: { job: Job }) {
  const [erro, setErro] = useState(false)
  const url = capaDoJob(job)
  const base: CSSProperties = { height: 120, background: 'linear-gradient(135deg,#F2EBDF,#E7DED3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34 }
  if (url && !erro) {
    return (
      <div style={base}>
        <img src={url} alt={`Capa da entrega: ${job.titulo}`} loading="lazy" referrerPolicy="no-referrer"
          onError={() => setErro(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </div>
    )
  }
  return <div style={base} aria-label="Entrega sem imagem de capa; ícone por tipo" title="Sem imagem de capa">{emojiTipo(job.tipo)}</div>
}

export default function PortfolioPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [jobs, setJobs] = useState<Job[]>([]); const [clientes, setClientes] = useState<Cli[]>([]); const [loading, setLoading] = useState(true)
  const [fCli, setFCli] = useState('todos')

  useEffect(() => {
    if (!empresa) { setLoading(false); return }
    setLoading(true)
    Promise.all([
      supabase.from('agency_jobs').select('id, titulo, tipo, valor_job, cliente_id, data_entrega, data_prazo, arquivos').eq('company_id', empresa).in('status', ['publicado', 'concluida']).is('excluido_em', null).order('data_prazo', { ascending: false }),
      supabase.from('agency_clientes').select('id, nome, nome_fantasia').eq('company_id', empresa),
    ]).then(([j, c]) => { setJobs((j.data ?? []) as Job[]); setClientes((c.data ?? []) as Cli[]); setLoading(false) })
  }, [empresa])

  const nomeCli = (id: string | null) => { const c = clientes.find((x) => x.id === id); return c ? (c.nome_fantasia ?? c.nome) : '—' }
  const filtrados = useMemo(() => fCli === 'todos' ? jobs : jobs.filter((j) => j.cliente_id === fCli), [jobs, fCli])

  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>🏭 P&amp;M · Produção</div>
            <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0' }}>Portfolio</h1>
            <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0' }}>Entregas publicadas por cliente.</p>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <select aria-label="Filtrar por cliente" value={fCli} onChange={(e) => setFCli(e.target.value)} style={inp}>
              <option value="todos">Todos os clientes</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome_fantasia ?? c.nome}</option>)}
            </select>
            <AjudaCampo chave="pm.portfolio.filtro_cliente" />
          </div>
        </header>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div>
          : filtrados.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM, background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 12 }}>Sem entregas publicadas ainda.</div>
          : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '0 0 8px', fontSize: 12, color: TEXTM }}>
                <span>{filtrados.length} {filtrados.length === 1 ? 'entrega' : 'entregas'}</span>
                <AjudaCampo chave="pm.portfolio.card" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px,1fr))', gap: 12 }}>
                {filtrados.map((j) => (
                  <Link key={j.id} href={`/dashboard/pm/pauta?job=${j.id}`} title={`Abrir o job: ${j.titulo}`}
                    aria-label={`Abrir o job ${j.titulo}`}
                    style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, overflow: 'hidden', display: 'block', color: 'inherit', textDecoration: 'none' }}>
                    <Capa job={j} />
                    <div style={{ padding: '10px 12px' }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{j.titulo}</div>
                      <div style={{ fontSize: 12, color: TEXTM, marginTop: 2 }}>{nomeCli(j.cliente_id)}{j.valor_job ? ` · ${brl(Number(j.valor_job))}` : ''}</div>
                      {(j.data_entrega ?? j.data_prazo) && <div style={{ fontSize: 11, color: TEXTM, marginTop: 2 }}>publicado {j.data_entrega ?? j.data_prazo}</div>}
                      <div style={{ fontSize: 11, color: DOURADO, fontWeight: 600, marginTop: 6 }}>Abrir job →</div>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
      </div>
    </div>
  )
}
const inp: CSSProperties = { border: `1px solid ${BORDA}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, minHeight: 40, background: '#fff', color: ESPRESSO }
