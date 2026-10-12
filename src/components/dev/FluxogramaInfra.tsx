'use client'
// Aba Codes · card "Fluxograma da Infra" (Eng. Chefe 12/10): diagrama vivo da máquina, lê fn_infra_fluxograma(). Poll de 25 s.
// Semáforo só de performance. SVG simples, rolagem horizontal no celular. "?" inline (sem migration: via rápida).
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { corCode, corPortao, corPublicacao, corVigilancia, type Cor, type FluxogramaInfra as Flux } from '@/lib/dev/fluxogramaInfra'

const ESP = '#3D2314', BRANCO = '#FFFFFF', BD = '#E7DED3', TXM = '#6B5D4F'
const COR: Record<Cor, { bg: string; fg: string }> = {
  verde: { bg: '#DCFCE7', fg: '#166534' }, amarelo: { bg: '#FEF3C7', fg: '#92400E' }, vermelho: { bg: '#FEE2E2', fg: '#B91C1C' },
}

function No({ x, y, w, titulo, sub, cor, id }: { x: number; y: number; w: number; titulo: string; sub?: string; cor?: Cor; id: string }) {
  const c = cor ? COR[cor] : { bg: '#F5EFE6', fg: ESP }
  return (
    <g data-testid={`fluxo-${id}`} data-semaforo={cor ?? 'neutro'}>
      <rect x={x} y={y} width={w} height={46} rx={8} fill={c.bg} stroke={c.fg} />
      <text x={x + w / 2} y={y + 20} textAnchor="middle" fontSize={12} fontWeight={700} fill={c.fg}>{titulo}</text>
      {sub && <text x={x + w / 2} y={y + 36} textAnchor="middle" fontSize={10} fill={c.fg}>{sub}</text>}
    </g>
  )
}

export default function FluxogramaInfra() {
  const [f, setF] = useState<Flux | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('fn_infra_fluxograma')
    if (error) { setErro(error.message); return }
    setErro(null); setF(data as Flux)
  }, [])
  useEffect(() => {
    void carregar()
    const i = setInterval(() => void carregar(), 25_000)
    return () => clearInterval(i)
  }, [carregar])

  const e = f?.esteira
  const etapas: { id: string; t: string; s?: string; cor?: Cor }[] = f && e ? [
    { id: 'spec', t: 'Spec' }, { id: 'code', t: 'Code constrói' },
    { id: 'pr', t: 'PR', s: `${f.em_teste ?? 0} em teste` }, { id: 'checks', t: 'Checks', s: `${f.esperando ?? 0} esperando` },
    { id: 'merge', t: 'Merge', s: f.ult_publicada_min === null ? 'sem dado' : `há ${f.ult_publicada_min} min`, cor: corPublicacao(f.ult_publicada_min) },
    { id: 'pos', t: '@pos' },
    { id: 'portao', t: 'Portão', s: e.portao_verde ? 'verde' : `vermelho${e.portao_spec_falha ? ` · ${e.portao_spec_falha}` : ''}`, cor: corPortao(f) },
    { id: 'producao', t: 'Produção' },
  ] : []
  const W = 104, G = 14

  return (
    <section data-testid="codes-fluxograma-infra" style={{ background: BRANCO, border: `1px solid ${BD}`, borderRadius: 12, padding: 14, marginBottom: 12, color: ESP }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Fluxograma da Infra <span style={{ fontWeight: 400, fontSize: 12, color: TXM }}>· ao vivo</span></h3>
      {erro && <div role="alert" style={{ fontSize: 12 }}>Não consegui ler o fluxograma: {erro}</div>}
      {!f && !erro && <div style={{ fontSize: 12, color: TXM }}>Carregando…</div>}
      {f && e && (
        <>
          <div data-testid="fluxo-metricas" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, marginBottom: 8 }}>
            <span><b>{e.intervalo_mediano_merge_min ?? '–'}</b> min/PR</span>
            <span><b>{e.merges_24h ?? 0}</b> publicações em 24 h</span>
            <span><b>{e.fila_parada ?? 0}</b> paradas</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <svg viewBox={`0 0 ${etapas.length * (W + G)} 250`} width={etapas.length * (W + G)} height={250} role="img" aria-label="Fluxo da esteira e estado dos Codes">
              {etapas.map((n, i) => (
                <g key={n.id}>
                  <No x={i * (W + G)} y={10} w={W} titulo={n.t} sub={n.s} cor={n.cor} id={n.id} />
                  {i < etapas.length - 1 && <text x={i * (W + G) + W + G / 2} y={38} textAnchor="middle" fontSize={14} fill={TXM}>›</text>}
                </g>
              ))}
              {f.codes.map((c, i) => (
                <No key={c.code} id={`code-${c.code}`} x={i * (W + 40)} y={90} w={W + 30} titulo={c.code} sub={`${f.papeis[c.code] ?? ''} · ${c.status}`} cor={corCode(c)} />
              ))}
              <No id="vigilancia" x={0} y={170} w={W + 90} titulo="Autovigilância" sub={`Relógio ${f.relogio_ativo ? '5 min' : 'parado'} · ${f.auditores_ativos ?? 0} auditores → Monitor`} cor={corVigilancia(f)} />
            </svg>
          </div>
          <details style={{ fontSize: 12, marginTop: 6 }}>
            <summary style={{ cursor: 'pointer' }} aria-label="O que significa o fluxograma">?</summary>
            Mostra o caminho de uma entrega (Spec → Code → PR → Checks → Merge → @pos → Portão → Produção) e o estado dos Codes. Verde: tudo andando.
            Amarelo: atenção (publicação há mais de 30 min, Code ocioso, vigilância parcial). Vermelho: portão vermelho, publicação há mais de 90 min, Code travado ou vigilância parada.
          </details>
        </>
      )}
    </section>
  )
}
