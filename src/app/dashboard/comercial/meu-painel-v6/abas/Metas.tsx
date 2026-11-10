'use client'
// Painel Comercial v6 — aba "Metas". Enquanto não há meta oficial cadastrada (erp_meta vazio para a empresa),
// mostramos a PROJEÇÃO factual do mês pelo ritmo atual — nunca um alvo inventado (RD-38). Quando houver meta
// cadastrada, este bloco passa a comparar realizado × meta. Só desenha; os dados vêm do motor-v5.
import { useMemo } from 'react'
import type { BaseV5, ModeloV5, ResumoV5 } from '../../meu-painel/motor-v5'
import { Bloco } from './ui'
import { C, brl0, pct, diaISO } from './fmt'

export function Metas({ base, modelo }: { base: BaseV5; modelo: ModeloV5; r: ResumoV5 }) {
  const proj = useMemo(() => {
    const anoMes = base.ate.slice(0, 7)
    const [y, m] = base.ate.split('-').map(Number)
    let mesAtual = 0
    for (const [d, a] of modelo.diaM) { if (diaISO(base.de, d).slice(0, 7) === anoMes) mesAtual += a.val }
    const diaDoMes = Number(base.ate.slice(8, 10))
    const diasNoMes = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const projecao = diaDoMes > 0 ? (mesAtual / diaDoMes) * diasNoMes : null
    const sugerida = mesAtual // referência mínima = já realizado; alvo oficial é decisão do gestor
    return { anoMes, mesAtual, diaDoMes, diasNoMes, projecao, sugerida, inicioNoMes: base.de.slice(0, 7) === anoMes }
  }, [modelo, base])

  if (!modelo.its.length) {
    return (
      <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 24, textAlign: 'center', color: C.m }}>
        Nenhuma venda no período. Nada a projetar.
      </div>
    )
  }

  const andamento = proj.projecao ? proj.mesAtual / proj.projecao : null

  return (
    <>
      <Bloco titulo="Projeção do mês" chave="comv6.meta_projecao">
        <p style={{ fontSize: 14, color: C.m, margin: '0 0 12px' }}>
          No mês corrente ({proj.diaDoMes} de {proj.diasNoMes} dias){!proj.inicioNoMes ? ' (parcial dentro do período carregado)' : ''}, a empresa já faturou <b>{brl0(proj.mesAtual)}</b>. Mantido o ritmo atual, o mês deve fechar em torno de <b>{brl0(proj.projecao)}</b>.
        </p>
        {andamento != null && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
              <span>Realizado</span>
              <span style={{ color: C.m }}>{pct(andamento)} da projeção</span>
            </div>
            <div style={{ height: 12, background: C.bd, borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.max(2, Math.round(andamento * 100))}%`, background: C.gold }} />
            </div>
            <div style={{ fontSize: 11, color: C.d, marginTop: 6 }}>
              Projeção linear pelo ritmo do mês (realizado ÷ dias decorridos × dias do mês). É uma estimativa, não uma meta.
            </div>
          </>
        )}
      </Bloco>

      <Bloco titulo="Meta oficial" chave="comv6.meta_oficial">
        <p style={{ fontSize: 14, color: C.m, margin: 0 }}>
          Ainda não há meta oficial cadastrada para esta empresa. Quando o gestor definir a meta do período
          (por empresa ou por vendedor), este bloco passa a mostrar <b>realizado × meta</b> e o quanto falta.
          Uma referência comum é o faturamento do mês anterior acrescido do crescimento desejado.
        </p>
        <div style={{ marginTop: 10, fontSize: 13, color: C.esp, background: C.off, border: `1px solid ${C.bd}`, borderRadius: 8, padding: 12 }}>
          Realizado no mês até agora: <b>{brl0(proj.mesAtual)}</b>. Use este número como piso ao definir a meta do próximo período.
        </div>
      </Bloco>
    </>
  )
}
