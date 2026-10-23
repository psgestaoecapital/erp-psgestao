'use client'
// Aba Codes · "Qualidade por vertical" (CEO 23/10): por vertical, quanto está CONSTRUÍDO e quanto está
// AUDITADO · VALIDADO (qualidade das telas/funções). Leitura única da RPC fn_dev_central_barras (mesma
// fonte das três barras da Central), que já calcula tudo no banco. Recarrega a cada 60 s. Só performance.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', BRANCO = '#FFFFFF', BD = '#E7DED3', TXM = '#6B5D4F', TRK = '#EDE7DF'
const OURO = '#B98900', VERDE = '#166534', ROTA = '/dashboard/dev/codes'

type Barra = {
  area_slug: string
  status_comercial: string
  telas: number
  construido_pct: number | string | null
  construido_sem_dado: boolean
  telas_auditadas: number
  auditado_pct: number | string | null
  auditado_sem_dado: boolean
  em_uso_empresas: number | null
  em_uso_sem_dado: boolean
}

// Nome amigável por vertical (o resto cai no próprio slug, capitalizado).
const NOME: Record<string, string> = {
  hub: 'Hub · Construção', pm: 'P&M · Agência', oficina: 'Oficina', revenda_veiculos: 'Revenda de veículos',
  industrial: 'Indústria', compliance: 'Compliance · NR-36', bpo: 'BPO Financeiro', gestao_empresarial: 'Gestão Empresarial',
  wealth: 'Wealth', odonto: 'Odonto', agro: 'Agro', ecommerce: 'E-commerce', medica: 'Médica',
  custeio_a: 'Custeio A', custeio_b: 'Custeio B',
}
const nomeVertical = (slug: string) => NOME[slug] ?? slug.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
const pct = (v: number | string | null): number | null => (v === null || v === '' ? null : Number(v))

function BarraMedidor({ rotulo, valor, semDado, cor, detalhe }: { rotulo: string; valor: number | null; semDado: boolean; cor: string; detalhe?: string }) {
  return (
    <div style={{ display: 'grid', gap: 2 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: TXM }}>
        <span>{rotulo}</span>
        <span style={{ fontWeight: 700, color: ESP }}>{semDado || valor === null ? 'sem dado' : `${valor}%`}{detalhe ? <span style={{ fontWeight: 400, color: TXM }}> · {detalhe}</span> : null}</span>
      </div>
      <div style={{ height: 8, background: TRK, borderRadius: 999, overflow: 'hidden' }}>
        {!semDado && valor !== null && <div style={{ width: `${Math.max(0, Math.min(100, valor))}%`, height: '100%', background: cor, borderRadius: 999 }} />}
      </div>
    </div>
  )
}

export default function BarrasQualidadeVertical() {
  const [linhas, setLinhas] = useState<Barra[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('fn_dev_central_barras')
    if (error) { setErro(error.message); return }
    setErro(null); setLinhas((data ?? []) as Barra[])
  }, [])
  useEffect(() => {
    void carregar()
    const i = setInterval(() => void carregar(), 60_000)
    return () => clearInterval(i)
  }, [carregar])

  // Só verticais com tela mapeada; as maiores construídas primeiro.
  const comDado = (linhas ?? [])
    .filter((l) => l.telas > 0)
    .slice()
    .sort((a, b) => (pct(b.construido_pct) ?? -1) - (pct(a.construido_pct) ?? -1))

  return (
    <section data-testid="codes-qualidade-vertical" style={{ background: BRANCO, border: `1px solid ${BD}`, borderRadius: 12, padding: 14, marginBottom: 12, color: ESP }}>
      <h3 style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 700 }}>
        Qualidade por vertical <AjudaCampo chave="dev.codes.qualidade_vertical" rota={ROTA} />
      </h3>
      <div style={{ fontSize: 12, color: TXM, marginBottom: 10 }}>% construído e % auditado · validado das telas e funções de cada vertical · ao vivo</div>
      {erro && <div role="alert" style={{ fontSize: 12 }}>Não consegui ler a qualidade por vertical: {erro}</div>}
      {!linhas && !erro && <div style={{ fontSize: 12, color: TXM }}>Carregando…</div>}
      {linhas && comDado.length === 0 && !erro && <div style={{ fontSize: 12, color: TXM }}>Nenhuma vertical com telas mapeadas ainda.</div>}
      <div style={{ display: 'grid', gap: 12 }}>
        {comDado.map((l) => (
          <div key={l.area_slug} data-testid={`qualidade-${l.area_slug}`} style={{ border: `1px solid ${BD}`, borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{nomeVertical(l.area_slug)}</span>
              <span style={{ fontSize: 11, color: TXM }}>{l.telas} tela{l.telas === 1 ? '' : 's'} · {l.status_comercial.replace(/_/g, ' ')}{l.em_uso_sem_dado ? '' : ` · ${l.em_uso_empresas ?? 0} em uso`}</span>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <BarraMedidor rotulo="Construído" valor={pct(l.construido_pct)} semDado={l.construido_sem_dado} cor={OURO} />
              <BarraMedidor rotulo="Auditado · validado" valor={pct(l.auditado_pct)} semDado={l.auditado_sem_dado} cor={VERDE} detalhe={l.auditado_sem_dado ? undefined : `${l.telas_auditadas}/${l.telas} telas`} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
