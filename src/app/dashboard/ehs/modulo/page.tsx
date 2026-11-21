// src/app/dashboard/ehs/modulo/page.tsx
// PS EHS · Plano completo por módulo (CEO 20/11/2026 16:46) — vitrine do blueprint vivo dentro do sistema.
// Cada um dos 22 módulos do PS EHS V11 (M1–M22) tem um item no menu lateral (só em empresa DEMO) que abre
// esta tela; cada FUNÇÃO planejada do módulo é uma aba, com a situação medida contra o blueprint
// (blueprint_tela_requisito + última blueprint_tela_cobertura) e o atalho para a tela real quando ela já existe.
// Lê só fn_ehs_plano_modulo (blueprint, sem dado de empresa).

'use client'

import Link from 'next/link'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const C = {
  espresso: '#3D2314', offwhite: '#FAF7F2', gold: '#C8941A', beigeLt: '#f5f0e8',
  borderLt: '#ece3d2', ink: '#1a1a1a', muted: 'rgba(61, 35, 20, 0.6)', green: '#16a34a', red: '#b91c1c',
}

type Funcao = { requisito: string; prioridade: string; status: string }
type Detalhe = { m: number; nome: string; rota: string | null; funcoes: Funcao[] }
type Resumo = { m: number; nome: string; total: number; atendido: number; parcial: number; ausente: number }

const SITUACAO: Record<string, { rotulo: string; cor: string; fundo: string }> = {
  atendido: { rotulo: 'Pronto', cor: C.green, fundo: '#e7f6ec' },
  parcial: { rotulo: 'Parcial', cor: C.gold, fundo: '#C8941A1f' },
  ausente: { rotulo: 'Planejado', cor: '#64748b', fundo: '#f1f5f9' },
  travado: { rotulo: 'Travado', cor: C.red, fundo: '#fce8e8' },
}
const sit = (s: string) => SITUACAO[s] ?? SITUACAO.ausente

// "Função: detalhe [PS EHS V11 · M2 · onda E2]" → partes para exibir
function partes(req: string) {
  const tag = req.match(/\[PS EHS V11 · M\d+ · onda ([^\]]+)\]\s*$/)
  const corpo = req.replace(/\s*\[PS EHS V11[^\]]*\]\s*$/, '')
  const i = corpo.indexOf(': ')
  return {
    titulo: i > 0 ? corpo.slice(0, i) : corpo,
    detalhe: i > 0 ? corpo.slice(i + 2) : '',
    onda: tag ? tag[1] : '—',
  }
}
const nomeCurto = (nome: string) => nome.replace(/^PS EHS · /, '')

function Selo({ status }: { status: string }) {
  const s = sit(status)
  return (
    <span style={{ fontSize: 12, fontWeight: 700, color: s.cor, background: s.fundo, borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap' }}>
      {s.rotulo}
    </span>
  )
}

function Conteudo() {
  const params = useSearchParams()
  const m = Number(params.get('m') || '0')
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null)
  const [resumo, setResumo] = useState<Resumo[]>([])
  const [aba, setAba] = useState(0)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setLoading(true); setErro(null); setAba(0)
    Promise.all([
      supabase.rpc('fn_ehs_plano_modulo', { p_modulo: null }),
      m >= 1 && m <= 22 ? supabase.rpc('fn_ehs_plano_modulo', { p_modulo: m }) : Promise.resolve({ data: null, error: null }),
    ]).then(([r, d]) => {
      if (!vivo) return
      if (r.error || d.error) { setErro('Não foi possível carregar o plano do módulo. Tente de novo em instantes.'); return }
      setResumo((r.data as Resumo[]) || [])
      setDetalhe((d.data as Detalhe) || null)
    }).finally(() => { if (vivo) setLoading(false) })
    return () => { vivo = false }
  }, [m])

  const funcoes = useMemo(() => detalhe?.funcoes ?? [], [detalhe])
  const atual = funcoes[aba]
  const p = atual ? partes(atual.requisito) : null
  const prontas = funcoes.filter((f) => f.status === 'atendido').length
  const parciais = funcoes.filter((f) => f.status === 'parcial').length

  return (
    <div style={{ background: C.offwhite, minHeight: '100vh', padding: '24px 16px', color: C.ink }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <p style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1, color: C.gold, margin: 0 }}>PS EHS · PLANO COMPLETO DO MÓDULO</p>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: C.espresso, margin: '6px 0 4px' }}>
          {detalhe ? nomeCurto(detalhe.nome) : 'Os 22 módulos do PS EHS'}
        </h1>
        <p style={{ fontSize: 15, color: C.muted, margin: '0 0 18px', maxWidth: 820 }}>
          Tudo o que este módulo vai ter, função por função, e o que já está pronto. As telas reais entram no lugar de cada aba
          conforme cada onda é entregue.
        </p>

        {erro && <div style={{ background: '#fce8e8', color: C.red, borderRadius: 12, padding: 14, marginBottom: 16 }}>{erro}</div>}
        {loading && <p style={{ color: C.muted }}>Carregando o plano…</p>}

        {!loading && !detalhe && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
            {resumo.map((r) => (
              <Link key={r.m} href={`/dashboard/ehs/modulo?m=${r.m}&area=compliance`}
                style={{ background: '#fff', border: `1px solid ${C.borderLt}`, borderRadius: 14, padding: 16, textDecoration: 'none', color: C.ink }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.espresso }}>{nomeCurto(r.nome)}</div>
                <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>
                  {r.total} funções · {r.atendido} prontas · {r.parcial} parciais · {r.ausente} planejadas
                </div>
              </Link>
            ))}
          </div>
        )}

        {!loading && detalhe && (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
              <span style={{ fontSize: 14, color: C.espresso, fontWeight: 600 }}>
                {funcoes.length} funções · {prontas} prontas · {parciais} parciais · {funcoes.length - prontas - parciais} planejadas
              </span>
              <AjudaCampo chave="ehs.modulo.situacao" />
              {detalhe.rota && (
                <Link href={`${detalhe.rota}?area=compliance`} style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 700, color: '#fff', background: C.espresso, borderRadius: 10, padding: '8px 14px', textDecoration: 'none' }}>
                  Abrir a tela que já existe
                </Link>
              )}
            </div>

            <div role="tablist" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 6, borderBottom: `1px solid ${C.borderLt}` }}>
              {funcoes.map((f, i) => {
                const t = partes(f.requisito)
                const ativa = i === aba
                return (
                  <button key={i} type="button" role="tab" aria-selected={ativa} onClick={() => setAba(i)}
                    style={{ flex: '0 0 auto', border: 'none', cursor: 'pointer', borderRadius: '10px 10px 0 0', padding: '10px 14px', fontSize: 14,
                      fontWeight: ativa ? 700 : 500, background: ativa ? '#fff' : 'transparent', color: ativa ? C.espresso : C.muted,
                      borderBottom: ativa ? `3px solid ${C.gold}` : '3px solid transparent' }}>
                    {t.titulo}
                  </button>
                )
              })}
            </div>

            {atual && p && (
              <section style={{ background: '#fff', border: `1px solid ${C.borderLt}`, borderTop: 'none', borderRadius: '0 0 14px 14px', padding: 20 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <h2 style={{ fontSize: 22, fontWeight: 800, color: C.espresso, margin: 0 }}>{p.titulo}</h2>
                  <Selo status={atual.status} />
                  {atual.prioridade === 'diferencial' && (
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.espresso, background: C.beigeLt, borderRadius: 999, padding: '3px 10px' }}>Diferencial</span>
                  )}
                </div>
                {p.detalhe && <p style={{ fontSize: 16, lineHeight: 1.55, margin: '12px 0 0', maxWidth: 820 }}>{p.detalhe}</p>}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16, fontSize: 14, color: C.muted }}>
                  <span>Onda de construção: <b style={{ color: C.espresso }}>{p.onda}</b></span>
                  <AjudaCampo chave="ehs.modulo.onda" />
                </div>
                {atual.status !== 'atendido' && (
                  <div style={{ marginTop: 16, background: C.beigeLt, borderRadius: 12, padding: 14, fontSize: 14, color: C.espresso }}>
                    {atual.status === 'parcial'
                      ? 'Parte desta função já existe no sistema; o restante está na fila da onda indicada.'
                      : 'Função planejada: entra no sistema na onda indicada. Até lá, esta aba mostra o que ela vai fazer.'}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function EhsPlanoModuloPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Carregando…</div>}>
      <Conteudo />
    </Suspense>
  )
}
