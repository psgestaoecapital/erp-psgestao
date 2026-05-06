// src/app/dashboard/compliance/epi/ficha/[funcionario_id]/page.tsx
// Ficha Individual EPI: header, EPIs em uso e timeline imutavel.

'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ModalEntregarEPI } from '../../_components/ModalEntregarEPI'

const C = {
  espresso: '#3D2314',
  espressoLt: '#5D4534',
  offwhite: '#FAF7F2',
  gold: '#C8941A',
  beigeLt: '#f5f0e8',
  borderLt: '#ece3d2',
  ink: '#1a1a1a',
  muted: 'rgba(61, 35, 20, 0.55)',
  green: '#16a34a',
  yellow: '#eab308',
  red: '#dc2626',
}

interface Funcionario {
  id: string
  nome_completo: string
  cpf: string | null
  cargo: string | null
  setor: string | null
  vinculo_tipo: string | null
  prestador_id: string | null
  prestador_nome?: string | null
  company_id: string
}

interface EpiEmUso {
  id: string
  catalogo_id: string
  status: string
  data_entrega: string | null
  proxima_troca_em: string | null
  quantidade: number | null
  catalogo: {
    id: string
    nome: string
    modelo: string | null
    ca_numero: string
    ca_validade: string
    fabricante_nome: string
  } | null
}

interface MovimentacaoRow {
  id: string
  tipo_movimento: string
  quantidade: number
  motivo: string | null
  observacoes: string | null
  data_movimento: string
  registrado_por_nome: string | null
  catalogo: {
    nome: string
    modelo: string | null
    ca_numero: string
  } | null
}

const TIPO_LABEL: Record<string, string> = {
  entrega_inicial: 'Entrega inicial',
  reposicao: 'Reposição',
  troca_vida_util: 'Troca por vida útil',
  troca_dano: 'Troca por dano',
  devolucao: 'Devolução',
  descarte: 'Descarte',
}

const TIPO_ICON: Record<string, string> = {
  entrega_inicial: '🟢',
  reposicao: '🔁',
  troca_vida_util: '⏱️',
  troca_dano: '⚠️',
  devolucao: '↩️',
  descarte: '🗑️',
}

export default function FichaIndividualPage() {
  const params = useParams<{ funcionario_id: string }>()
  const funcionarioId = params?.funcionario_id

  const [funcionario, setFuncionario] = useState<Funcionario | null>(null)
  const [emUso, setEmUso] = useState<EpiEmUso[]>([])
  const [historico, setHistorico] = useState<MovimentacaoRow[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [modalAberto, setModalAberto] = useState(false)

  const carregar = useCallback(async () => {
    if (!funcionarioId) return
    setLoading(true)
    setErro(null)
    try {
      const { data: func, error: fErr } = await supabase
        .from('compliance_funcionarios')
        .select('id, nome_completo, cpf, cargo, setor, vinculo_tipo, prestador_id, company_id')
        .eq('id', funcionarioId)
        .maybeSingle()
      if (fErr) throw fErr
      if (!func) throw new Error('Funcionário não encontrado')

      let prestadorNome: string | null = null
      if (func.prestador_id) {
        const { data: prest } = await supabase
          .from('prestadores_servico')
          .select('nome_fantasia, razao_social')
          .eq('id', func.prestador_id)
          .maybeSingle()
        prestadorNome = (prest?.nome_fantasia || prest?.razao_social) ?? null
      }

      setFuncionario({ ...func, prestador_nome: prestadorNome } as Funcionario)

      const { data: fichaRows, error: fcErr } = await supabase
        .from('epi_ficha')
        .select('id, catalogo_id, status, data_entrega, proxima_troca_em, quantidade, catalogo:epi_catalogo(id, nome, modelo, ca_numero, ca_validade, fabricante_nome)')
        .eq('funcionario_id', funcionarioId)
        .eq('status', 'em_uso')
      if (fcErr) throw fcErr
      setEmUso((fichaRows || []) as any)

      const { data: movs, error: mErr } = await supabase
        .from('epi_movimentacao')
        .select('id, tipo_movimento, quantidade, motivo, observacoes, data_movimento, registrado_por_nome, catalogo:epi_catalogo(nome, modelo, ca_numero)')
        .eq('funcionario_id', funcionarioId)
        .order('data_movimento', { ascending: false })
        .limit(200)
      if (mErr) throw mErr
      setHistorico((movs || []) as any)
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar ficha')
    } finally {
      setLoading(false)
    }
  }, [funcionarioId])

  useEffect(() => { carregar() }, [carregar])

  const iniciais = useMemo(() => {
    if (!funcionario) return '?'
    return funcionario.nome_completo.split(' ').slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?'
  }, [funcionario])

  function statusTroca(d: string | null): { label: string; cor: string } {
    if (!d) return { label: 'sem prazo', cor: C.muted }
    const dt = new Date(d)
    const hoje = new Date()
    const diff = Math.ceil((dt.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24))
    if (diff < 0) return { label: `vencido há ${Math.abs(diff)}d`, cor: C.red }
    if (diff <= 30) return { label: `troca em ${diff}d`, cor: C.yellow }
    return { label: `troca em ${diff}d`, cor: C.green }
  }

  return (
    <div style={{ background: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
        <div style={{ marginBottom: 16 }}>
          <Link href="/dashboard/compliance/epi/fichas" style={btnSec}>← Fichas</Link>
        </div>

        {erro && <div style={{ background: '#fce8e8', color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{erro}</div>}

        {loading || !funcionario ? (
          <p style={{ textAlign: 'center', color: C.muted, padding: 40 }}>Carregando…</p>
        ) : (
          <>
            {/* Header funcionario */}
            <header style={{ background: '#FFFFFF', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(61,35,20,0.06)', marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
              <div style={{ width: 64, height: 64, borderRadius: 64, background: C.beigeLt, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: C.espresso, fontSize: 22 }}>{iniciais}</div>
              <div style={{ flex: '1 1 280px', minWidth: 0 }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: C.gold, letterSpacing: 1.2, textTransform: 'uppercase', margin: 0 }}>Ficha de EPI</p>
                <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, fontWeight: 400, margin: '4px 0 4px' }}>{funcionario.nome_completo}</h1>
                <div style={{ fontSize: 13, color: C.espressoLt }}>
                  {funcionario.cpf && <span style={{ fontFamily: 'ui-monospace, monospace' }}>{funcionario.cpf}</span>}
                  {funcionario.cpf && (funcionario.cargo || funcionario.setor) && <span style={{ margin: '0 6px', color: C.muted }}>·</span>}
                  {funcionario.cargo}
                  {funcionario.setor && <> · {funcionario.setor}</>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  {funcionario.vinculo_tipo === 'terceirizado' ? (
                    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: C.gold + '22', color: C.gold, fontWeight: 700 }}>TERCEIRIZADO</span>
                  ) : (
                    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: C.green + '22', color: C.green, fontWeight: 700 }}>DIRETO</span>
                  )}
                  {funcionario.prestador_nome && funcionario.prestador_id && (
                    <Link href={`/dashboard/compliance/prestadores/${funcionario.prestador_id}`} style={{ fontSize: 12, color: C.espressoLt, textDecoration: 'underline' }}>
                      {funcionario.prestador_nome}
                    </Link>
                  )}
                </div>
              </div>
              <button onClick={() => setModalAberto(true)} style={btnPri}>+ Entregar Novo EPI</button>
            </header>

            {/* EPIs em uso */}
            <section style={{ marginBottom: 24 }}>
              <h2 style={subTitulo}>EPIs em uso · {emUso.length}</h2>
              {emUso.length === 0 ? (
                <div style={vazioStyle}>Nenhum EPI ativo. Use o botão acima para registrar a primeira entrega.</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
                  {emUso.map((f) => {
                    const st = statusTroca(f.proxima_troca_em)
                    return (
                      <div key={f.id} style={{ background: '#FFFFFF', borderRadius: 12, padding: 14, boxShadow: '0 1px 3px rgba(61,35,20,0.06)', borderLeft: `4px solid ${st.cor}` }}>
                        <div style={{ fontWeight: 600, color: C.espresso, fontSize: 14 }}>
                          {f.catalogo?.nome || '—'}{f.catalogo?.modelo && <> · {f.catalogo.modelo}</>}
                        </div>
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                          CA {f.catalogo?.ca_numero || '—'} · {f.catalogo?.fabricante_nome || '—'}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.borderLt}`, fontSize: 12 }}>
                          <div style={{ color: C.espressoLt }}>
                            Entrega: <strong>{fmtData(f.data_entrega)}</strong>
                            {(f.quantidade || 0) > 1 && <> · qtd {f.quantidade}</>}
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: st.cor, textTransform: 'uppercase' }}>{st.label}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            {/* Historico */}
            <section style={{ marginBottom: 24 }}>
              <h2 style={subTitulo}>Histórico completo · imutável (NR-6)</h2>
              {historico.length === 0 ? (
                <div style={vazioStyle}>Nenhuma movimentação registrada.</div>
              ) : (
                <div style={{ background: '#FFFFFF', borderRadius: 12, padding: 0, boxShadow: '0 1px 3px rgba(61,35,20,0.06)', overflow: 'hidden' }}>
                  {historico.map((m, idx) => (
                    <div key={m.id} style={{ display: 'grid', gridTemplateColumns: '40px 1fr auto', gap: 12, padding: '14px 16px', borderTop: idx === 0 ? 'none' : `1px solid ${C.borderLt}` }}>
                      <div style={{ fontSize: 22, lineHeight: 1, paddingTop: 2 }}>{TIPO_ICON[m.tipo_movimento] || '•'}</div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.espresso }}>
                          {TIPO_LABEL[m.tipo_movimento] || m.tipo_movimento} · {m.catalogo?.nome || '—'}
                          {m.catalogo?.modelo && <span style={{ color: C.muted, fontWeight: 400 }}> · {m.catalogo.modelo}</span>}
                        </div>
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                          CA {m.catalogo?.ca_numero || '—'} · qtd {m.quantidade}
                          {m.registrado_por_nome && <> · por {m.registrado_por_nome}</>}
                        </div>
                        {m.motivo && <div style={{ fontSize: 12, color: C.espressoLt, marginTop: 4, fontStyle: 'italic' }}>“{m.motivo}”</div>}
                        {m.observacoes && <div style={{ fontSize: 12, color: C.espressoLt, marginTop: 2 }}>{m.observacoes}</div>}
                      </div>
                      <div style={{ fontSize: 11, color: C.muted, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {fmtDataHora(m.data_movimento)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {funcionario && (
        <ModalEntregarEPI
          isOpen={modalAberto}
          onClose={() => setModalAberto(false)}
          onSuccess={() => carregar()}
          funcionario={{
            id: funcionario.id,
            nome_completo: funcionario.nome_completo,
            cpf: funcionario.cpf,
            cargo: funcionario.cargo,
            setor: funcionario.setor,
          }}
          companyId={funcionario.company_id}
        />
      )}
    </div>
  )
}

function fmtData(s: string | null | undefined): string {
  if (!s) return '—'
  try {
    const [y, m, d] = s.split('T')[0].split('-')
    return `${d}/${m}/${y}`
  } catch { return s }
}

function fmtDataHora(s: string | null | undefined): string {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return s }
}

const subTitulo: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 12px' }
const vazioStyle: React.CSSProperties = { textAlign: 'center', padding: 28, color: C.muted, background: '#FFFFFF', borderRadius: 12, fontSize: 13 }
const btnSec: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, border: '1px solid #ece3d2', background: '#FFFFFF', color: '#3D2314', fontSize: 13, fontWeight: 600, textDecoration: 'none', cursor: 'pointer', display: 'inline-block' }
const btnPri: React.CSSProperties = { padding: '12px 18px', borderRadius: 8, background: '#3D2314', color: '#FFFFFF', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer' }
