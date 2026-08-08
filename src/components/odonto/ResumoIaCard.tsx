'use client'
// IA-1.1 · cartão de Resumo Inteligente no topo da aba Sobre. Carrega progressivo (o resto da ficha
// aparece na hora; o cartão preenche quando pronto). Estados honestos (RD-51): sem dados / falha /
// cacheado. Chama /api/odonto/resumo-paciente (Claude Haiku + cache + budget guard).
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { CardOdonto, TOK } from './ui'
import { Sparkles, RefreshCw } from 'lucide-react'

type Resposta = { ok?: boolean; vazio?: boolean; cache?: boolean; aviso?: string; error?: string; budget_pausado?: boolean; ia_desativada?: boolean
  resumo?: string; risco?: string | null; motivo?: string; sugestao?: string; gerado_em?: string }

const RISCO: Record<string, { l: string; cor: string; bg: string }> = {
  baixo: { l: 'Risco baixo', cor: TOK.green, bg: '#E7F3EA' },
  medio: { l: 'Risco médio', cor: TOK.amber, bg: '#FBF0DF' },
  alto: { l: 'Risco alto', cor: TOK.red, bg: '#FBEBEB' },
}
function haQuanto(iso?: string): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.round(ms / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60); if (h < 24) return `há ${h}h`
  return `há ${Math.round(h / 24)}d`
}

export function ResumoIaCard({ companyId, pacienteId }: { companyId: string; pacienteId: string }) {
  const [data, setData] = useState<Resposta | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const buscar = useCallback(async (force: boolean) => {
    setCarregando(true); setErro(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setErro('sessão'); setCarregando(false); return }
      const res = await fetch('/api/odonto/resumo-paciente', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ company_id: companyId, paciente_id: pacienteId, force }),
      })
      const j = (await res.json()) as Resposta
      if (!res.ok || j.error) { setErro(j.error || 'falha'); setData(j) }
      else setData(j)
    } catch { setErro('falha de rede') } finally { setCarregando(false) }
  }, [companyId, pacienteId])

  useEffect(() => { void buscar(false) }, [buscar])

  const r = RISCO[(data?.risco ?? '') as string]

  return (
    <CardOdonto style={{ padding: 14, borderColor: TOK.gold, background: 'linear-gradient(180deg, #FFFDF8, #FFFFFF)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 800, color: TOK.gold, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          <Sparkles size={15} /> Resumo inteligente
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {data?.gerado_em && <span style={{ fontSize: 11, color: TOK.mut }}>{data.cache ? 'cacheado ' : ''}{haQuanto(data.gerado_em)}</span>}
          <button onClick={() => void buscar(true)} disabled={carregando || !!data?.budget_pausado || !!data?.ia_desativada}
            title={data?.ia_desativada ? 'IA desativada para esta clínica (Configurações de IA)' : data?.budget_pausado ? 'Resumo pausado hoje por limite de custo' : 'Atualizar resumo'}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: `0.5px solid ${TOK.line}`, borderRadius: 999, padding: '4px 10px', fontSize: 11.5, fontWeight: 600, color: TOK.esp, cursor: (carregando || data?.budget_pausado || data?.ia_desativada) ? 'not-allowed' : 'pointer', opacity: (data?.budget_pausado || data?.ia_desativada) ? 0.5 : 1 }}>
            <RefreshCw size={12} style={carregando ? { animation: 'spin 1s linear infinite' } : undefined} /> Atualizar
          </button>
        </div>
      </div>

      {carregando && !data ? (
        <div style={{ fontSize: 13, color: TOK.mut }}>A IA está lendo a ficha do paciente…</div>
      ) : data?.ia_desativada && !data?.resumo ? (
        <div style={{ fontSize: 13, color: TOK.mut }}>Resumo inteligente desativado para esta clínica. Ative em <strong style={{ color: TOK.esp }}>Configurações de IA</strong>.</div>
      ) : data?.vazio ? (
        <div style={{ fontSize: 13, color: TOK.mut }}>Sem dados suficientes para o resumo ainda — registre anamnese, plano ou consultas.</div>
      ) : erro && !data?.resumo ? (
        <div style={{ fontSize: 13, color: TOK.mut }}>Não deu para gerar o resumo agora. Tente <button onClick={() => void buscar(true)} style={{ background: 'none', border: 'none', color: TOK.gold, cursor: 'pointer', fontWeight: 700 }}>atualizar</button>.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data?.aviso && <div style={{ fontSize: 11, color: TOK.amber }}>{data.aviso}</div>}
          <div style={{ fontSize: 13.5, color: TOK.esp, lineHeight: 1.5 }}>{data?.resumo}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {r && <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: r.bg, color: r.cor }}>{r.l}</span>}
            {data?.motivo && <span style={{ fontSize: 11.5, color: TOK.mut }}>{data.motivo}</span>}
          </div>
          {data?.sugestao && <div style={{ fontSize: 12.5, color: TOK.esp }}><strong style={{ color: TOK.gold }}>Sugestão:</strong> {data.sugestao}</div>}
        </div>
      )}
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    </CardOdonto>
  )
}
