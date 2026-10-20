'use client'
// Chamado #2167 (complemento): etiquetas da nota fiscal no cartão da lista de OS. Regra em src/lib/oficina/osNotaLista.ts.
// Etiqueta verde (ou azul vinculada a nota do sistema) abre o PDF; azul com link abre o link informado.
import { useState } from 'react'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { abrirPdfNotaPorId } from '@/components/comum/NotaFiscalDaOS'
import type { CorEtiquetaNF, EtiquetaNF } from '@/lib/oficina/osNotaLista'

const CORES: Record<CorEtiquetaNF, { cor: string; bg: string; borda: string }> = {
  verde:    { cor: '#047857', bg: '#ECFDF5', borda: '#A7F3D0' },
  azul:     { cor: '#1D4ED8', bg: '#EFF6FF', borda: '#BFDBFE' },
  amarelo:  { cor: '#92400E', bg: '#FFF8E1', borda: '#FCD34D' },
  vermelho: { cor: '#B91C1C', bg: '#FEE2E2', borda: '#FCA5A5' },
  cinza:    { cor: '#6B5D4F', bg: '#F0ECE3', borda: '#E0D8CC' },
}

export default function OSNotaEtiquetas({ etiquetas, companyId }: { etiquetas: EtiquetaNF[]; companyId: string }) {
  const [abrindo, setAbrindo] = useState<string | null>(null)
  if (!etiquetas.length) return null

  async function abrir(e: EtiquetaNF) {
    if (e.link) { window.open(e.link, '_blank', 'noopener'); return }
    if (!e.abrir) return
    setAbrindo(e.chave)
    try { await abrirPdfNotaPorId(e.abrir.tipo, e.abrir.id, companyId) }
    catch (err) { alert(err instanceof Error ? err.message : 'Erro ao abrir o PDF') }
    finally { setAbrindo(null) }
  }

  return (
    <div data-testid="os-nf-etiquetas" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
      {etiquetas.map((e) => {
        const c = CORES[e.cor]
        const clicavel = !!(e.abrir || e.link)
        const estilo = {
          fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '4px 10px', minHeight: 28,
          color: c.cor, background: c.bg, border: `1px solid ${c.borda}`, whiteSpace: 'nowrap' as const,
          display: 'inline-flex', alignItems: 'center',
        }
        return clicavel ? (
          <button key={e.chave} type="button" onClick={() => void abrir(e)} disabled={abrindo === e.chave}
            data-testid="os-nf-etiqueta" data-cor={e.cor} title="Abrir o PDF da nota"
            style={{ ...estilo, cursor: 'pointer', opacity: abrindo === e.chave ? 0.6 : 1 }}>
            {abrindo === e.chave ? 'Abrindo…' : e.texto}
          </button>
        ) : (
          <span key={e.chave} data-testid="os-nf-etiqueta" data-cor={e.cor} style={estilo}>{e.texto}</span>
        )
      })}
      <AjudaCampo chave="os.lista.nota_fiscal" rota="/dashboard/os" />
    </div>
  )
}
