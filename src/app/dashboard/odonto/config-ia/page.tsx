'use client'
// Controle & Metering de IA por clínica · liga/desliga cada feature de IA e vê o custo do mês por feature.
// DEFAULT ON (RD-51): o que não tem linha em ia_config_empresa está LIGADO — só cria linha quem DESLIGA.
// Custo real por company_id vem de fn_ia_empresa_consumo_mes (transparência). Salva via fn_ia_empresa_config_salvar.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ShellOdonto, PageHeaderOdonto, CardOdonto, EmptyStateOdonto, MetricStat, Toggle, BrandIcon, TOK } from '@/components/odonto/ui'
import { Settings2, Sparkles } from 'lucide-react'

// catálogo de features. `ativa` = já existe no produto hoje (as outras ficam visíveis como "em breve",
// honestas: o toggle fica desabilitado até a feature existir de fato). RD-51: não fingir controle do que não há.
const CATALOGO: { feature: string; nome: string; desc: string; ativa: boolean }[] = [
  { feature: 'resumo_paciente', nome: 'Resumo do Paciente', desc: 'Resumo inteligente no topo da ficha (risco de evasão + sugestão).', ativa: true },
  { feature: 'consultor_clinica', nome: 'Consultor da Clínica', desc: 'O dono pergunta em linguagem natural e recebe os números reais.', ativa: true },
  { feature: 'voz_soap', nome: 'Voz → Prontuário', desc: 'Ditar a evolução e estruturar em SOAP (mãos livres na cadeira).', ativa: true },
  { feature: 'alertas_proativos', nome: 'Alertas Pró-ativos', desc: 'Prioriza e resume os alertas da clínica (os alertas em si rodam de graça, sempre).', ativa: true },
  { feature: 'orcamento_ia', nome: 'Orçamento IA', desc: 'Sugestão de plano a partir do diagnóstico.', ativa: false },
]

type ConfigRow = { feature: string; habilitado: boolean; limite_diario_usd: number | null }
type ConsumoFeature = { custo_usd: number; chamadas: number }
type Consumo = { total_usd: number; chamadas: number; por_feature: Record<string, ConsumoFeature> }

const usd = (n: number) => 'US$ ' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: n && n < 1 ? 4 : 2, maximumFractionDigits: 4 })

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

export default function ConfigIaPage() {
  const companyId = useCompanyId()
  const [config, setConfig] = useState<Record<string, ConfigRow>>({})
  const [consumo, setConsumo] = useState<Consumo | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async (cid: string) => {
    setCarregando(true); setErro(null)
    try {
      const [{ data: cfg, error: e1 }, { data: cons }] = await Promise.all([
        supabase.rpc('fn_ia_empresa_config', { p_company_id: cid }),
        supabase.rpc('fn_ia_empresa_consumo_mes', { p_company_id: cid }),
      ])
      if (e1) { setErro('falha'); return }
      const map: Record<string, ConfigRow> = {}
      for (const r of (cfg as ConfigRow[] | null) ?? []) map[r.feature] = r
      setConfig(map)
      setConsumo((cons as Consumo | null) ?? { total_usd: 0, chamadas: 0, por_feature: {} })
    } catch { setErro('falha de rede') } finally { setCarregando(false) }
  }, [])

  useEffect(() => { if (companyId) void carregar(companyId) }, [companyId, carregar])

  const salvar = async (feature: string, habilitado: boolean) => {
    if (!companyId) return
    setSalvando(feature)
    // otimista: reflete na hora; se falhar, recarrega do servidor (honesto).
    setConfig((c) => ({ ...c, [feature]: { feature, habilitado, limite_diario_usd: c[feature]?.limite_diario_usd ?? null } }))
    const { data, error } = await supabase.rpc('fn_ia_empresa_config_salvar', { p_company_id: companyId, p_feature: feature, p_habilitado: habilitado, p_limite: config[feature]?.limite_diario_usd ?? null })
    const ok = !error && (data as { ok?: boolean } | null)?.ok
    if (!ok) { setErro('não deu para salvar — recarregando'); await carregar(companyId) }
    setSalvando(null)
  }

  if (!companyId) return <ShellOdonto><EmptyStateOdonto titulo="Escolha uma clínica" linha="Selecione uma empresa específica no topo do menu para configurar a IA." /></ShellOdonto>

  return (
    <ShellOdonto>
      <PageHeaderOdonto icon={<BrandIcon><Settings2 size={20} /></BrandIcon>} titulo="Configurações de IA"
        subtitulo="Ligue ou desligue cada recurso de IA e acompanhe o custo do mês por recurso" />

      {/* total do mês */}
      <CardOdonto style={{ padding: 16, marginBottom: 12, background: 'linear-gradient(180deg, #FFFDF8, #FFFFFF)', borderColor: TOK.gold }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 800, color: TOK.gold, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
          <Sparkles size={15} /> Custo de IA este mês
        </div>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
          <MetricStat valor={usd(consumo?.total_usd ?? 0)} label="Total do mês" cor={TOK.esp} />
          <MetricStat valor={String(consumo?.chamadas ?? 0)} label="Chamadas de IA" cor={TOK.mut} />
        </div>
        <div style={{ fontSize: 11, color: TOK.mut30, marginTop: 8 }}>Custo real medido por clínica. O teto global da PS continua valendo por cima como segurança.</div>
      </CardOdonto>

      {carregando ? (
        <CardOdonto><div style={{ fontSize: 13, color: TOK.mut }}>Carregando configurações…</div></CardOdonto>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {erro && <div style={{ fontSize: 12.5, color: TOK.amber }}>{erro}</div>}
          {CATALOGO.map((f) => {
            const row = config[f.feature]
            const on = f.ativa ? (row ? row.habilitado : true) : false   // DEFAULT ON pro que existe; futuras ficam off
            const c = consumo?.por_feature?.[f.feature]
            return (
              <CardOdonto key={f.feature} style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14.5, fontWeight: 600, color: TOK.esp }}>{f.nome}</span>
                      {!f.ativa && <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: '#F1F1F0', color: TOK.gray }}>em breve</span>}
                      {f.ativa && !on && <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: '#FBEBEB', color: TOK.red }}>desativado</span>}
                    </div>
                    <div style={{ fontSize: 12.5, color: TOK.mut, marginTop: 3 }}>{f.desc}</div>
                    {c && (c.chamadas > 0) && (
                      <div style={{ fontSize: 11.5, color: TOK.mut, marginTop: 6 }}>Este mês: <strong style={{ color: TOK.esp }}>{usd(c.custo_usd)}</strong> · {c.chamadas} {c.chamadas === 1 ? 'chamada' : 'chamadas'}</div>
                    )}
                  </div>
                  <div style={{ flexShrink: 0, opacity: (f.ativa && salvando !== f.feature) ? 1 : 0.5, pointerEvents: (f.ativa && salvando !== f.feature) ? 'auto' : 'none' }}
                    title={f.ativa ? (on ? 'Desligar este recurso para a clínica' : 'Ligar este recurso') : 'Disponível em breve'}>
                    <Toggle t={on ? 'Ligado' : 'Desligado'} on={on} set={(v) => void salvar(f.feature, v)} />
                  </div>
                </div>
              </CardOdonto>
            )
          })}
          <div style={{ fontSize: 11, color: TOK.mut30, paddingLeft: 2 }}>Desligar um recurso não apaga nada — a IA para de ser chamada (custo zero) e a tela mostra a última versão em cache quando houver.</div>
        </div>
      )}
    </ShellOdonto>
  )
}
