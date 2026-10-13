'use client'
// IA-1.4 · Painel de Alertas Pró-ativos. Núcleo rule-based (grátis, sempre) via /api/odonto/alertas;
// camada de IA opcional (feature 'alertas_proativos') prioriza + resume — degrada pro rule-based cru.
// Reusa erp_alerta_proativo/v_alertas_ativos; Resolver/Dispensar via fn_alerta_acao. Design #819, mobile.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { ShellOdonto, PageHeaderOdonto, CardOdonto, EmptyStateOdonto, BrandIcon, TOK } from '@/components/odonto/ui'
import { Bell, Sparkles, RefreshCw, Check, X, ArrowRight } from 'lucide-react'

type Alerta = { id: string; tipo: string | null; severidade: string | null; titulo: string; mensagem: string | null; link_acao: string | null }
const SEV: Record<string, { l: string; cor: string; bg: string }> = {
  critica: { l: 'Crítico', cor: TOK.red, bg: '#FBEBEB' },
  alta: { l: 'Alta', cor: '#B45309', bg: '#FBF0DF' },
  media: { l: 'Média', cor: '#8A6A1E', bg: '#FBF3DE' },
  baixa: { l: 'Baixa', cor: TOK.gray, bg: '#F1F1F0' },
}

function useCompanyId(): string | null {
  const [id, setId] = useState<string | null>(null)
  useEffect(() => {
    const read = () => { if (typeof window === 'undefined') return null; const v = localStorage.getItem('ps_empresa_sel'); return (!v || v === 'consolidado' || v.startsWith('group_')) ? null : v }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setId(read())
    const t = setInterval(() => { const v = read(); setId((p) => (p === v ? p : v)) }, 800)
    return () => clearInterval(t)
  }, [])
  return id
}

export default function AlertasPage() {
  const companyId = useCompanyId()
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [resumo, setResumo] = useState<string | null>(null)
  const [iaAplicada, setIaAplicada] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!companyId) return
    setCarregando(true); setErro(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setErro('sessão'); setCarregando(false); return }
      const res = await fetch('/api/odonto/alertas', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ company_id: companyId }),
      })
      const j = await res.json() as { ok?: boolean; alertas?: Alerta[]; ia_aplicada?: boolean; resumo?: string; error?: string }
      if (!res.ok || j.error) { setErro(j.error || 'falha') }
      else { setAlertas(j.alertas ?? []); setIaAplicada(!!j.ia_aplicada); setResumo(j.resumo ?? null) }
    } catch { setErro('falha de rede') } finally { setCarregando(false) }
  }, [companyId])

  useEffect(() => { void carregar() }, [carregar])

  const acao = async (id: string, a: 'resolver' | 'dispensar') => {
    setAlertas((prev) => prev.filter((x) => x.id !== id))   // otimista
    const { data, error } = await supabase.rpc('fn_alerta_acao', { p_alerta_id: id, p_acao: a })
    if (error || (data as { ok?: boolean } | null)?.ok === false) { setErro('não deu para atualizar — recarregando'); void carregar() }
  }

  if (!companyId) return <ShellOdonto><EmptyStateOdonto titulo="Escolha uma clínica" linha="Selecione uma empresa específica no topo do menu para ver os alertas." /></ShellOdonto>

  return (
    <ShellOdonto>
      <PageHeaderOdonto icon={<BrandIcon><Bell size={20} /></BrandIcon>} titulo="Alertas pró-ativos"
        subtitulo="A clínica avisada antes do problema — orçamentos parados, pacientes sumindo, agenda vazia"
        acoes={
          <button onClick={() => void carregar()} disabled={carregando}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: `0.5px solid ${TOK.line}`, borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, color: TOK.esp, cursor: carregando ? 'not-allowed' : 'pointer' }}>
            <RefreshCw size={13} style={carregando ? { animation: 'spin 1s linear infinite' } : undefined} /> Atualizar alertas
          </button>
        } />

      {iaAplicada && resumo && (
        <CardOdonto style={{ padding: 14, marginBottom: 12, background: 'linear-gradient(180deg, #FFFDF8, #FFFFFF)', borderColor: TOK.gold }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 800, color: TOK.gold, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
            <Sparkles size={14} /> Prioridade do dia
          </div>
          <div style={{ fontSize: 13.5, color: TOK.esp, lineHeight: 1.5 }}>{resumo}</div>
        </CardOdonto>
      )}

      {carregando && alertas.length === 0 ? (
        <CardOdonto><div style={{ fontSize: 13, color: TOK.mut }}>Verificando a clínica…</div></CardOdonto>
      ) : erro && alertas.length === 0 ? (
        <CardOdonto><div style={{ fontSize: 13, color: TOK.mut }}>Não deu para carregar os alertas agora. Tente <button onClick={() => void carregar()} style={{ background: 'none', border: 'none', color: TOK.gold, cursor: 'pointer', fontWeight: 700 }}>atualizar</button>.</div></CardOdonto>
      ) : alertas.length === 0 ? (
        <EmptyStateOdonto titulo="Tudo em dia" linha="Sem alertas pendentes para esta clínica. Voltamos a avisar assim que algo pedir atenção." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {alertas.map((a) => {
            const s = SEV[a.severidade ?? 'media'] ?? SEV.media
            return (
              <CardOdonto key={a.id} style={{ padding: 0, overflow: 'hidden', borderColor: s.cor }}>
                <div style={{ display: 'flex', alignItems: 'stretch' }}>
                  <div style={{ width: 4, background: s.cor, flexShrink: 0 }} />
                  <div style={{ padding: 14, flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: TOK.esp }}>{a.titulo}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: s.bg, color: s.cor }}>{s.l}</span>
                    </div>
                    {a.mensagem && <div style={{ fontSize: 12.5, color: TOK.mut, lineHeight: 1.45 }}>{a.mensagem}</div>}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                      {a.link_acao && (
                        <Link href={a.link_acao} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700, color: '#fff', background: TOK.gold, borderRadius: 999, padding: '6px 13px', textDecoration: 'none' }}>
                          Resolver agora <ArrowRight size={13} />
                        </Link>
                      )}
                      <button onClick={() => void acao(a.id, 'resolver')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: TOK.green, background: '#fff', border: `0.5px solid ${TOK.line}`, borderRadius: 999, padding: '6px 12px', cursor: 'pointer' }}>
                        <Check size={13} /> Marcar resolvido
                      </button>
                      <button onClick={() => void acao(a.id, 'dispensar')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: TOK.mut, background: '#fff', border: `0.5px solid ${TOK.line}`, borderRadius: 999, padding: '6px 12px', cursor: 'pointer' }}>
                        <X size={13} /> Dispensar
                      </button>
                    </div>
                  </div>
                </div>
              </CardOdonto>
            )
          })}
          <div style={{ fontSize: 11, color: TOK.mut30, paddingLeft: 2 }}>
            Alertas gerados por regras (custo zero){iaAplicada ? ' · priorizados por IA' : ''}. Roda todo dia de madrugada e ao abrir esta tela. Ligue/desligue a priorização por IA em <Link href="/dashboard/odonto/config-ia" style={{ color: TOK.gold, fontWeight: 700, textDecoration: 'none' }}>Configurações de IA</Link>.
          </div>
        </div>
      )}
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    </ShellOdonto>
  )
}
