'use client'

// Folha › Encargos (CEO/Eng. Chefe 25/11): campo ÚNICO "% de encargos sobre a folha" (padrão 36,5) que grava o
// encargos_folha_pct dentro do detalhamento de erp_encargos_empresa (via fn_mao_obra_encargos_salvar, ajustando o
// INSS patronal e mantendo as demais chaves). É o MESMO número do Quadro, do BI e da ficha — um número só.
// "Real da última folha: X%" vem de fn_rh_folha_encargos_real (patronal ÷ proventos); "Usar o % real" só habilita
// depois de o usuário abrir "ver as verbas". RD-100: sem nome de terceiro. RD-95: "?" nos campos/ações.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', GOLD_D = '#A57A15'
const LINE = '#E7DECF', CREAM = '#F2EBDF', MUT = 'rgba(61,35,20,0.55)'
const RED = '#A32D2D', RED_BG = '#FCEBEB', GREEN = '#166534', GREEN_BG = '#DCFCE7'
const ROTA = '/dashboard/industrial/folha'

const brl = (n: number) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%')
const fmtComp = (d?: string | null) => { if (!d) return '—'; const [y, m] = d.split('-'); return `${m}/${y}` }

type Vigente = {
  encargos_folha_pct?: number; regime?: string; simples_anexo?: string | null; inss_patronal_pct?: number; rat_pct?: number;
  fap?: number; terceiros_pct?: number; fgts_pct?: number; desoneracao?: boolean; desoneracao_fator_folha?: number;
  prov_13_pct?: number; prov_ferias_pct?: number; prov_rescisao_pct?: number; fonte?: string
}
type Verba = { codigo: string; descricao?: string; tipo: 'encargo' | 'provento'; valor: number }
type Real = { ok?: boolean; tem_folha?: boolean; competencia?: string; pct?: number | null; total_encargo?: number; total_provento?: number; verbas?: Verba[] }

export function EncargosTab({ companyId, podeVer }: { companyId: string; podeVer: boolean }) {
  const [vig, setVig] = useState<Vigente | null>(null)
  const [real, setReal] = useState<Real | null>(null)
  const [campo, setCampo] = useState<string>('') // o % que o usuário vê/edita
  const [verbasAbertas, setVerbasAbertas] = useState(false)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setErro(null)
    const [v, r] = await Promise.all([
      supabase.rpc('fn_mao_obra_encargos_vigentes', { p_company_id: companyId }),
      supabase.rpc('fn_rh_folha_encargos_real', { p_company_id: companyId }),
    ])
    const vg = (v.data ?? null) as Vigente | null
    setVig(vg)
    setCampo(vg?.encargos_folha_pct != null ? String(Number(vg.encargos_folha_pct).toFixed(2)) : '36.50')
    setReal((r.data ?? null) as Real | null)
  }, [companyId])
  useEffect(() => { if (podeVer) void carregar() }, [podeVer, carregar])

  async function salvar() {
    const alvo = Number(String(campo).replace(',', '.'))
    if (!isFinite(alvo) || alvo <= 0 || alvo > 100) { setErro('Informe um % de encargos válido (ex.: 36,5).'); return }
    if (!vig?.regime) { setErro('Não consegui ler o regime da empresa. Recarregue a página.'); return }
    // mantém rat/fap/terceiros/fgts e as provisões; ajusta só o INSS patronal p/ o total bater o % escolhido.
    const fator = Number(vig.desoneracao_fator_folha ?? 1) || 1
    const rat = Number(vig.rat_pct ?? 3), fap = Number(vig.fap ?? 1), terc = Number(vig.terceiros_pct ?? 0), fgts = Number(vig.fgts_pct ?? 8)
    const inss = (alvo - rat * fap - terc - fgts) / fator
    if (inss < 0) { setErro('Esse % é baixo demais para o detalhamento atual (RAT + terceiros + FGTS já passam dele).'); return }
    setBusy(true); setErro(null); setOk(null)
    try {
      const p_dados = {
        regime: vig.regime, simples_anexo: vig.simples_anexo ?? null,
        inss_patronal_pct: Number(inss.toFixed(4)), rat_pct: rat, fap, terceiros_pct: terc, fgts_pct: fgts,
        desoneracao: vig.desoneracao ?? false, desoneracao_fator_folha: fator,
        prov_13_pct: vig.prov_13_pct ?? 8.33, prov_ferias_pct: vig.prov_ferias_pct ?? 11.11, prov_rescisao_pct: vig.prov_rescisao_pct ?? 4,
      }
      const { data, error } = await supabase.rpc('fn_mao_obra_encargos_salvar', { p_company_id: companyId, p_dados, p_confirmar: true })
      const res = (data ?? {}) as { ok?: boolean; erro?: string }
      if (error || res.ok === false) { setErro(error?.message || res.erro || 'Não consegui salvar o % de encargos.'); return }
      setOk(`Encargos salvos: ${pct(alvo)} sobre a folha. É o mesmo número usado no Quadro, no BI e na ficha.`)
      await carregar()
    } catch (e) { setErro((e as Error).message) } finally { setBusy(false) }
  }

  if (!podeVer) {
    return <div style={card}><b style={{ color: ESP }}>Acesso restrito ao RH</b><div style={{ color: MUT, fontSize: 13, marginTop: 6 }}>O % de encargos e a folha são visíveis apenas ao RH e à diretoria.</div></div>
  }

  const temReal = real?.ok && real?.tem_folha && real?.pct != null

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {erro && <div style={aviso(RED, RED_BG)}>{erro}</div>}
      {ok && <div style={aviso(GREEN, GREEN_BG)}>✓ {ok}</div>}

      <section style={card} data-ajuda="industrial.folha.encargos_pct">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: ESP }}>% de encargos sobre a folha</span>
          <AjudaCampo chave="industrial.folha.encargos_pct" rota={ROTA} />
        </div>
        <div style={{ fontSize: 12, color: MUT, marginBottom: 12 }}>
          Padrão 36,5%. É o <b style={{ color: ESP }}>mesmo número</b> usado no custo do Quadro, no BI de RH e na ficha de mão de obra.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <input value={campo} onChange={(e) => setCampo(e.target.value)} inputMode="decimal"
              style={{ width: 120, background: BG, border: `1px solid ${LINE}`, color: ESP, borderRadius: 10, padding: '10px 28px 10px 12px', fontSize: 15, fontWeight: 700, outline: 'none' }} />
            <span style={{ position: 'absolute', right: 12, color: MUT, fontWeight: 700 }}>%</span>
          </div>
          <button onClick={() => void salvar()} disabled={busy}
            style={{ ...btnGold, opacity: busy ? 0.6 : 1 }}>{busy ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </section>

      <section style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: ESP }}>Real da última folha</span>
          <AjudaCampo chave="industrial.folha.encargos_real" rota={ROTA} />
        </div>
        {!temReal ? (
          <div style={{ fontSize: 12, color: MUT }}>
            {real?.tem_folha === false ? 'Nenhuma folha importada ainda — importe uma competência para calcular o % real.' : 'Sem proventos na última competência para calcular o %.'}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 13, color: ESP }}>
              <b style={{ fontSize: 18, color: GOLD_D }}>{pct(real!.pct)}</b> — calculado da folha <b>{fmtComp(real!.competencia)}</b>, confira.
              <span style={{ color: MUT }}> (encargo patronal {brl(real!.total_encargo ?? 0)} ÷ proventos {brl(real!.total_provento ?? 0)})</span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <AjudaCampo chave="industrial.folha.encargos_verbas" rota={ROTA} />
              <button onClick={() => setVerbasAbertas((x) => !x)} style={btnOutline}>{verbasAbertas ? 'Ocultar verbas' : 'Ver as verbas'}</button>
              <button onClick={() => setCampo(String(Number(real!.pct).toFixed(2)))} disabled={!verbasAbertas}
                title={verbasAbertas ? '' : 'Abra "ver as verbas" para conferir antes de usar o % real'}
                style={{ ...btnOutline, borderColor: GOLD, color: verbasAbertas ? ESP : MUT, cursor: verbasAbertas ? 'pointer' : 'not-allowed', opacity: verbasAbertas ? 1 : 0.6 }}>
                Usar o % real
              </button>
            </div>
            {verbasAbertas && (
              <div style={{ overflowX: 'auto', border: `0.5px solid ${LINE}`, borderRadius: 8, marginTop: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 420 }}>
                  <thead style={{ background: BG }}><tr>
                    <th style={th}>Verba</th><th style={th}>Classificação</th><th style={{ ...th, textAlign: 'right' }}>Valor</th>
                  </tr></thead>
                  <tbody>
                    {(real!.verbas ?? []).map((v, i) => (
                      <tr key={`${v.codigo}-${i}`} style={{ borderTop: `0.5px solid ${LINE}` }}>
                        <td style={td}><b>{v.codigo}</b>{v.descricao ? <span style={{ color: MUT }}> · {v.descricao}</span> : null}</td>
                        <td style={td}>
                          <span style={{ background: v.tipo === 'encargo' ? '#FDF2E9' : CREAM, color: v.tipo === 'encargo' ? GOLD_D : ESP, borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>
                            {v.tipo === 'encargo' ? 'encargo (patronal)' : 'provento'}
                          </span>
                        </td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{brl(v.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}

const card: React.CSSProperties = { background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }
const aviso = (fg: string, bg: string): React.CSSProperties => ({ background: bg, color: fg, padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600 })
const btnGold: React.CSSProperties = { padding: '10px 18px', borderRadius: 8, border: 'none', background: GOLD, color: '#FFF', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const btnOutline: React.CSSProperties = { padding: '9px 14px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#FFF', color: ESP, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }
const th: React.CSSProperties = { padding: '9px 12px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT }
const td: React.CSSProperties = { padding: '9px 12px', color: ESP, fontVariantNumeric: 'tabular-nums' }
