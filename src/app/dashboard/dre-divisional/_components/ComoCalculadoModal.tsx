'use client'

import { C } from './index'

export function ComoCalculadoModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
    >
      <div
        onClick={(e: any) => e.stopPropagation()}
        style={{ background: 'white', borderRadius: 12, padding: 28, width: 'min(640px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>
          Análises &gt; DRE Divisional
        </p>
        <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontWeight: 400, margin: '4px 0 16px' }}>
          Como o DRE Divisional é calculado
        </h2>

        <p style={{ fontSize: 13, color: C.ink, lineHeight: 1.7, margin: '0 0 12px' }}>
          O cálculo segue a <strong>NBC TG 16</strong> (custeio por absorção). Cada Linha
          de Negócio (LN) recebe sua receita e custos diretos; a estrutura SEDE é distribuída
          proporcionalmente entre as LNs operacionais.
        </p>

        <ol style={{ fontSize: 13, color: C.ink, lineHeight: 1.7, paddingLeft: 20, margin: '0 0 16px' }}>
          <li><strong>Receita:</strong> cada LN mantém sua própria receita bruta.</li>
          <li><strong>Custos diretos</strong> (CMV, despesas variáveis): permanecem na LN que os gerou.</li>
          <li><strong>Estrutura SEDE</strong> (despesas fixas sem LN específica): rateada proporcionalmente.</li>
          <li><strong>Método padrão:</strong> por <em>Receita</em>. Linha sem receita NÃO absorve rateio.</li>
          <li>
            <strong>Métodos alternativos</strong> (configuração avançada): por Margem de
            Contribuição, por área (m²), por Headcount, por Transações ou Igualitário.
          </li>
          <li>
            <strong>EBITDA Real</strong> = EBITDA Pré-Rateio − Estrutura Absorvida.
          </li>
        </ol>

        <div style={{ background: C.beigeLt, borderRadius: 8, padding: 12, fontSize: 12, color: C.muted, marginBottom: 16 }}>
          O recálculo é automático todos os dias às <strong>04:15 UTC</strong> (pg_cron).
          O resultado é auditável em <code>rateio_distribuicao_calculado</code> — mostrando
          o método aplicado, a regra que rateou e os pesos usados na distribuição.
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{ padding: '10px 18px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            Entendi
          </button>
        </div>
      </div>
    </div>
  )
}
