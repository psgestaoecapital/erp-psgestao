'use client'

import type { ReactNode } from 'react'
import { EHS, type EhsStatus } from './tokens'
import { tEhs, type EhsIdioma } from './i18n'
import { EhsCartaoStatus } from './componentes'

// PS EHS — cockpit por papel (D.6): cada papel vê primeiro o que precisa decidir hoje.
export type EhsPapel = 'gestor' | 'tecnico' | 'campo' | 'rt'
export const EHS_PAPEIS: EhsPapel[] = ['gestor', 'tecnico', 'campo', 'rt']

const TEXTO: Record<EhsPapel, Record<EhsIdioma, { titulo: string; foco: string }>> = {
  gestor: {
    pt: { titulo: 'Gestor', foco: 'Visão geral e o que está em risco' },
    en: { titulo: 'Manager', foco: 'Overview and what is at risk' },
    es: { titulo: 'Gestor', foco: 'Visión general y lo que está en riesgo' },
  },
  tecnico: {
    pt: { titulo: 'Técnico de SST', foco: 'Pendências e vencimentos para tratar hoje' },
    en: { titulo: 'EHS technician', foco: 'Pending items and expiries to handle today' },
    es: { titulo: 'Técnico de SST', foco: 'Pendientes y vencimientos para hoy' },
  },
  campo: {
    pt: { titulo: 'Campo', foco: 'Ações rápidas: foto, voz e QR' },
    en: { titulo: 'Field', foco: 'Quick actions: photo, voice and QR' },
    es: { titulo: 'Campo', foco: 'Acciones rápidas: foto, voz y QR' },
  },
  rt: {
    pt: { titulo: 'Responsável técnico', foco: 'Laudos e documentos aguardando revisão' },
    en: { titulo: 'Technical lead', foco: 'Reports and documents awaiting review' },
    es: { titulo: 'Responsable técnico', foco: 'Informes y documentos por revisar' },
  },
}

export type EhsIndicador = { id: string; rotulo: string; valor: ReactNode; status: EhsStatus; detalhe?: string }

/** Seletor de papel + indicadores do papel escolhido. Só apresentação: dados vêm de quem usa. */
export function EhsCockpit({ papel, onPapel, indicadores, idioma = 'pt' }: {
  papel: EhsPapel
  onPapel: (p: EhsPapel) => void
  indicadores: EhsIndicador[]
  idioma?: EhsIdioma
}) {
  const t = TEXTO[papel][idioma]
  // Prioridade: o que é crítico aparece primeiro.
  const ordem: Record<EhsStatus, number> = { critico: 0, atencao: 1, ok: 2, neutro: 3 }
  const lista = [...indicadores].sort((a, b) => ordem[a.status] - ordem[b.status])
  return (
    <section data-testid="ehs-cockpit" data-papel={papel} style={{ marginBottom: 24 }}>
      <div role="tablist" aria-label={tEhs('cockpit.papel', idioma)} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {EHS_PAPEIS.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={p === papel}
            data-testid={`ehs-papel-${p}`}
            onClick={() => onPapel(p)}
            style={{ minHeight: 44, padding: '0 16px', borderRadius: 999, fontWeight: 600, cursor: 'pointer', border: `1px solid ${EHS.borda}`, background: p === papel ? EHS.marca : EHS.superficie, color: p === papel ? '#fff' : EHS.tinta }}
          >
            {TEXTO[p][idioma].titulo}
          </button>
        ))}
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: EHS.suave }}>{t.foco}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        {lista.map((i) => (
          <EhsCartaoStatus key={i.id} rotulo={i.rotulo} valor={i.valor} status={i.status} detalhe={i.detalhe} />
        ))}
      </div>
    </section>
  )
}
