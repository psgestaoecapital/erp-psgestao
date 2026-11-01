'use client'
// Aba Codes · card "Saúde da Esteira" (Eng. Chefe 11/10): lê a RPC fn_esteira_saude() — cadência, estabilidade, fila e portão.
// Semáforo só de performance (verde/amarelo/vermelho). Recarrega a cada 60 s. "?" inline (sem migration: via rápida).
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { classificarSaude, type SaudeEsteira as Saude, type Semaforo } from '@/lib/dev/saudeEsteira'

const ESP = '#3D2314', BRANCO = '#FFFFFF', BD = '#E7DED3', TXM = '#6B5D4F'
const COR: Record<Semaforo, { bg: string; fg: string; nome: string }> = {
  verde: { bg: '#DCFCE7', fg: '#166534', nome: 'Verde' },
  amarelo: { bg: '#FEF3C7', fg: '#92400E', nome: 'Amarelo' },
  vermelho: { bg: '#FEE2E2', fg: '#B91C1C', nome: 'Vermelho' },
}

function Bloco({ id, titulo, sem, valor, detalhe, ajuda }: { id: string; titulo: string; sem: Semaforo; valor: string; detalhe: string; ajuda: string }) {
  const c = COR[sem]
  return (
    <div data-testid={`saude-${id}`} data-semaforo={sem} style={{ background: c.bg, color: c.fg, border: `1px solid ${c.fg}`, borderRadius: 10, padding: '10px 12px', minWidth: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{titulo} · {c.nome}</div>
      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>{valor}</div>
      <div style={{ fontSize: 12 }}>{detalhe}</div>
      <details style={{ fontSize: 12, marginTop: 4 }}>
        <summary style={{ cursor: 'pointer' }} aria-label={`O que significa ${titulo}`}>?</summary>
        {ajuda}
      </details>
    </div>
  )
}

export default function SaudeEsteira({ compacto = false }: { compacto?: boolean } = {}) {
  const [s, setS] = useState<Saude | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('fn_esteira_saude')
    if (error) { setErro(error.message); return }
    setErro(null); setS(data as Saude)
  }, [])

  useEffect(() => {
    void carregar()
    const i = setInterval(() => void carregar(), 60_000)
    return () => clearInterval(i)
  }, [carregar])

  const k = s ? classificarSaude(s, new Date()) : null
  return (
    <section data-testid="codes-saude-esteira" style={{ background: BRANCO, border: `1px solid ${BD}`, borderRadius: 12, padding: compacto ? 12 : 14, marginBottom: compacto ? 0 : 12, color: ESP }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Saúde da Esteira <span style={{ fontWeight: 400, fontSize: 12, color: TXM }}>· últimas 24 h</span></h3>
      {erro && <div role="alert" style={{ fontSize: 12 }}>Não consegui ler a saúde da esteira: {erro}</div>}
      {!s && !erro && <div style={{ fontSize: 12, color: TXM }}>Carregando…</div>}
      {s && k && (
        <div className={compacto ? "grid grid-cols-1 sm:grid-cols-2 gap-2" : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"}>
          <Bloco id="cadencia" titulo="Cadência" sem={k.cadencia} valor={k.cadenciaTexto}
            detalhe={`${s.merges_24h ?? 0} publicações em 24 h`}
            ajuda="Tempo típico (mediana) entre uma publicação e a seguinte. Verde: até 30 min. Amarelo: até 90 min. Vermelho: mais que isso ou sem publicações." />
          <Bloco id="estabilidade" titulo="Estabilidade" sem={k.estabilidade} valor={`${s.quedas_24h ?? 0} quedas`}
            detalhe={`${s.tempo_vermelho_24h_min ?? 0} min parada`}
            ajuda="Quantas vezes o portão (teste da main) caiu e quantos minutos ficou vermelho nas últimas 24 h. Verde: nenhuma queda. Amarelo: até 2 quedas e 60 min. Vermelho: mais que isso." />
          <Bloco id="fila" titulo="Fila" sem={k.fila} valor={`${s.fila_esperando ?? 0} esperando`}
            detalhe={`${s.fila_parada ?? 0} paradas${s.pr_parada_mais_antiga_h != null ? ` · a mais antiga há ${s.pr_parada_mais_antiga_h} h` : ''}`}
            ajuda="PRs esperando a vez e PRs paradas fora da rodada. Verde: nenhuma parada. Amarelo: parada há menos de 6 h. Vermelho: parada há 6 h ou mais." />
          <Bloco id="portao" titulo="Portão" sem={k.portao} valor={s.portao_verde === null ? 'sem dado' : s.portao_verde ? 'Verde' : 'Vermelho'}
            detalhe={`${s.portao_desde ? `há ${k.portaoHa}` : ''}${!s.portao_verde && s.portao_spec_falha ? ` — ${s.portao_spec_falha}` : ''}` || 'sem data'}
            ajuda="Resultado do teste da main (o portão que libera as publicações) e há quanto tempo está nesse estado. Vermelho: nada com migration publica enquanto estiver assim." />
        </div>
      )}
    </section>
  )
}
