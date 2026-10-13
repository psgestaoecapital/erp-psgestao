'use client'
// Controle & Metering de IA por clínica · liga/desliga cada recurso + custo do mês por recurso.
// FONTE ÚNICA (RD-52): fn_ia_empresa_features devolve o habilitado EFETIVO = config ?? default do catálogo.
// Default por feature: TEXTO nasce ON; VISÃO nasce OFF (opt-in, custo maior). Salva via fn_ia_empresa_config_salvar.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ShellOdonto, PageHeaderOdonto, CardOdonto, EmptyStateOdonto, MetricStat, Toggle, BrandIcon, TOK } from '@/components/odonto/ui'
import { Settings2, Sparkles, Eye } from 'lucide-react'

// rótulos de exibição (só o que já existe no produto aparece; o default/tipo vêm do backend).
const LABELS: Record<string, { nome: string; desc: string }> = {
  resumo_paciente: { nome: 'Resumo do Paciente', desc: 'Resumo inteligente no topo da ficha (risco de evasão + sugestão).' },
  consultor_clinica: { nome: 'Consultor da Clínica', desc: 'O dono pergunta em linguagem natural e recebe os números reais.' },
  voz_soap: { nome: 'Voz → Prontuário', desc: 'Ditar a evolução e estruturar em SOAP (mãos livres na cadeira).' },
  alertas_proativos: { nome: 'Alertas Pró-ativos', desc: 'Prioriza e resume os alertas da clínica (os alertas em si rodam de graça, sempre).' },
  orcamento_ia: { nome: 'Orçamento IA', desc: 'Estima a chance de aceitação e sugere o melhor formato de pagamento.' },
  chat_ia: { nome: '@Claude no chat da equipe', desc: 'No comunicador interno, digite @Claude e a IA responde no canal com os números reais.' },
  ia_raiox: { nome: 'Raio-X assistido (visão)', desc: 'Aponta regiões de atenção no raio-x para o dentista revisar e confirmar.' },
  ia_smile: { nome: 'Análise de sorriso (visão)', desc: 'Analisa a estética a partir de uma foto e sugere um plano para você validar e apresentar.' },
  ia_smile_preview: { nome: 'Prévia ilustrativa do sorriso (visão · experimental)', desc: 'Gera uma simulação ilustrativa do "depois" a partir da foto (com marca d\'água). Experimental, custo maior — não é o resultado real; o dentista revisa e decide se mostra.' },
}

type Feature = { feature: string; tipo: string; custo_nivel: string; default_habilitado: boolean; habilitado: boolean; configurado: boolean; limite_diario_usd: number | null }
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
  const [features, setFeatures] = useState<Feature[]>([])
  const [consumo, setConsumo] = useState<Consumo | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async (cid: string) => {
    setCarregando(true); setErro(null)
    try {
      const [{ data: feats, error: e1 }, { data: cons }] = await Promise.all([
        supabase.rpc('fn_ia_empresa_features', { p_company_id: cid }),
        supabase.rpc('fn_ia_empresa_consumo_mes', { p_company_id: cid }),
      ])
      if (e1) { setErro('falha'); return }
      setFeatures(((feats as Feature[] | null) ?? []).filter((f) => LABELS[f.feature]))
      setConsumo((cons as Consumo | null) ?? { total_usd: 0, chamadas: 0, por_feature: {} })
    } catch { setErro('falha de rede') } finally { setCarregando(false) }
  }, [])

  useEffect(() => { if (companyId) void carregar(companyId) }, [companyId, carregar])

  const salvar = async (feature: string, habilitado: boolean) => {
    if (!companyId) return
    setSalvando(feature)
    setFeatures((fs) => fs.map((f) => f.feature === feature ? { ...f, habilitado, configurado: true } : f))   // otimista
    const lim = features.find((f) => f.feature === feature)?.limite_diario_usd ?? null
    const { data, error } = await supabase.rpc('fn_ia_empresa_config_salvar', { p_company_id: companyId, p_feature: feature, p_habilitado: habilitado, p_limite: lim })
    const ok = !error && (data as { ok?: boolean } | null)?.ok
    if (!ok) { setErro('não deu para salvar — recarregando'); await carregar(companyId) }
    setSalvando(null)
  }

  if (!companyId) return <ShellOdonto><EmptyStateOdonto titulo="Escolha uma clínica" linha="Selecione uma empresa específica no topo do menu para configurar a IA." /></ShellOdonto>

  return (
    <ShellOdonto>
      <PageHeaderOdonto icon={<BrandIcon><Settings2 size={20} /></BrandIcon>} titulo="Configurações de IA"
        subtitulo="Ligue ou desligue cada recurso de IA e acompanhe o custo do mês por recurso" />

      <CardOdonto style={{ padding: 16, marginBottom: 12, background: 'linear-gradient(180deg, #FFFDF8, #FFFFFF)', borderColor: TOK.gold }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 800, color: TOK.gold, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
          <Sparkles size={15} /> Custo de IA este mês
        </div>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
          <MetricStat valor={usd(consumo?.total_usd ?? 0)} label="Total do mês" cor={TOK.esp} />
          <MetricStat valor={String(consumo?.chamadas ?? 0)} label="Chamadas de IA" cor={TOK.mut} />
        </div>
        <div style={{ fontSize: 11, color: TOK.mut30, marginTop: 8 }}>Recursos de <strong>texto</strong> vêm ligados (custo baixo). Recursos de <strong>visão</strong> (raio-x) vêm <strong>desligados</strong> — ative quando quiser; o custo é maior.</div>
      </CardOdonto>

      {carregando ? (
        <CardOdonto><div style={{ fontSize: 13, color: TOK.mut }}>Carregando configurações…</div></CardOdonto>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {erro && <div style={{ fontSize: 12.5, color: TOK.amber }}>{erro}</div>}
          {features.map((f) => {
            const lbl = LABELS[f.feature]
            const on = f.habilitado
            const visao = f.tipo === 'visao'
            const c = consumo?.por_feature?.[f.feature]
            return (
              <CardOdonto key={f.feature} style={{ padding: 16, borderColor: visao ? '#E7DECF' : undefined }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14.5, fontWeight: 600, color: TOK.esp }}>{lbl.nome}</span>
                      {visao && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#FBF3DE', color: '#8A6A1E' }}><Eye size={11} /> visão · custo maior</span>}
                      {!on && <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: '#FBEBEB', color: TOK.red }}>desativado</span>}
                    </div>
                    <div style={{ fontSize: 12.5, color: TOK.mut, marginTop: 3 }}>{lbl.desc}</div>
                    {c && (c.chamadas > 0) && (
                      <div style={{ fontSize: 11.5, color: TOK.mut, marginTop: 6 }}>Este mês: <strong style={{ color: TOK.esp }}>{usd(c.custo_usd)}</strong> · {c.chamadas} {c.chamadas === 1 ? 'chamada' : 'chamadas'}</div>
                    )}
                  </div>
                  <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, opacity: salvando === f.feature ? 0.5 : 1, pointerEvents: salvando === f.feature ? 'none' : 'auto' }}
                    title={on ? 'Desligar este recurso' : 'Ligar este recurso'}>
                    <Toggle t={on ? 'Ligado' : (visao ? 'Ativar' : 'Desligado')} on={on} set={(v) => void salvar(f.feature, v)} />
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
