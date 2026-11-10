'use client'
// Painel Comercial v6 — aba "Cidades": onde a empresa vende. Do motor-v5 (cidM por cidade, cidVen = vendedores
// que atuam em cada cidade). A tela só desenha.
import { useMemo, useState } from 'react'
import type { BaseV5, ModeloV5, ResumoV5 } from '../../meu-painel/motor-v5'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { Bloco } from './ui'
import { C, ROTA, brl0, brl2, int, pct } from './fmt'

export function Cidades({ base, modelo, r }: { base: BaseV5; modelo: ModeloV5; r: ResumoV5 }) {
  const tot = modelo.tot.val || 1
  const [busca, setBusca] = useState('')

  const cidades = useMemo(() => {
    return [...modelo.cidM.entries()]
      .map(([idx, a]) => ({
        nome: base.cid[idx] ?? `Cidade ${idx}`,
        val: a.val, part: a.val / tot,
        clientes: a.clis.size,
        rkg: a.kgP > 0 ? a.valP / a.kgP : null,
        vendedores: modelo.cidVen.get(idx)?.size ?? 0,
      }))
      .sort((a, b) => b.val - a.val)
  }, [modelo, base, tot])

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return q ? cidades.filter((c) => c.nome.toLowerCase().includes(q)) : cidades
  }, [cidades, busca])

  if (!modelo.its.length) {
    return (
      <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 24, textAlign: 'center', color: C.m }}>
        Nenhuma venda no período. Nada a mostrar por cidade.
      </div>
    )
  }

  const top = cidades.slice(0, 10)
  const topPart = top.reduce((s, c) => s + c.part, 0)

  return (
    <>
      <Bloco titulo="Onde a Frioeste vende" chave="comv6.cid_onde">
        <p style={{ fontSize: 14, color: C.m, margin: '0 0 12px' }}>
          São <b>{int(cidades.length)} cidades</b>. As 10 maiores concentram <b>{pct(topPart)}</b> do faturamento; <b>{top[0]?.nome}</b> lidera com <b>{brl0(top[0]?.val)}</b>.
        </p>
        <div style={{ display: 'grid', gap: 8 }}>
          {top.map((c) => (
            <div key={c.nome}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nome}</span>
                <span style={{ color: C.m, flexShrink: 0 }}>{brl0(c.val)} · {pct(c.part)}</span>
              </div>
              <div style={{ height: 8, background: C.bd, borderRadius: 4, marginTop: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.max(2, Math.round((c.val / (top[0]?.val || 1)) * 100))}%`, background: C.gold }} />
              </div>
            </div>
          ))}
        </div>
      </Bloco>

      <Bloco titulo="Todas as cidades" chave="comv6.cid_todas">
        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: C.m, display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>Buscar cidade<AjudaCampo chave="comv6.cid_busca" rota={ROTA} /></span>
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar cidade…"
            aria-label="Buscar cidade"
            style={{ display: 'block', width: '100%', maxWidth: 320, padding: '8px 10px', border: `1px solid ${C.bd}`, borderRadius: 8, fontSize: 14, background: '#fff', color: C.esp }}
          />
        </label>
        {filtradas.length ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 420 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: C.m, borderBottom: `1px solid ${C.bd}` }}>
                  <th style={{ padding: '6px 8px' }}>Cidade</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Faturamento</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Clientes</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>R$/kg</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Vend.</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map((c) => (
                  <tr key={c.nome} style={{ borderBottom: `1px solid ${C.off}` }}>
                    <td style={{ padding: '6px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{c.nome}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{brl0(c.val)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{int(c.clientes)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{c.rkg == null ? '—' : brl2(c.rkg)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{int(c.vendedores)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 11, color: C.d, marginTop: 6 }}>Total vendido em {int(cidades.length)} cidades: {brl0(r.totalValor)}.</div>
          </div>
        ) : (
          <p style={{ fontSize: 14, color: C.m, margin: 0 }}>Nenhuma cidade encontrada para “{busca}”.</p>
        )}
      </Bloco>
    </>
  )
}
