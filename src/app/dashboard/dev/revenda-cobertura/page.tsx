'use client'

// Revenda R1e · Painel de cobertura (Central de Desenvolvimento). % por tela e geral (fn_blueprint_cobertura),
// requisitos ausentes/quebrados que o juiz achou, e o histórico de execuções com foto. Só PS_ADMIN.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import ScreenshotAssinado from '@/components/admin/ScreenshotAssinado'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FFF6E5', red: '#B42318', redBg: '#FDECEC',
}
const brDate = (d: string | null) => d ? new Date(d).toLocaleString('pt-BR') : ''

type Tela = { tela_num: number; tela_nome: string; pct: number; pct_essenciais: number | null; requisitos: number; com_algo: number }
type Cob = { ok?: boolean; geral_pct?: number; essenciais_pct?: number; total_requisitos?: number; por_tela?: Tela[]; erro?: string }
type Achado = { status: string; evidencia: string | null; foto_url: string | null; avaliado_em: string; blueprint_tela_requisito: { tela_num: number; tela_nome: string; requisito: string } | null }
type Exec = { execucao_id: string; tela: number | null; foto: string | null; quando: string; n: number }

function corPct(p: number): string { return p >= 80 ? C.green : p >= 45 ? C.amber : C.red }

export default function PainelCobertura() {
  const [admin, setAdmin] = useState<boolean | null>(null)
  const [cob, setCob] = useState<Cob | null>(null)
  const [achados, setAchados] = useState<Achado[]>([])
  const [execs, setExecs] = useState<Exec[]>([])
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setAdmin(false); return }
    const { data: perfil } = await supabase.from('users').select('system_role').eq('id', user.id).maybeSingle()
    const ok = ['PS_ADMIN', 'PS_ADMIN_CVM'].includes(String((perfil as { system_role?: string } | null)?.system_role))
    setAdmin(ok)
    if (!ok) return

    const { data: c } = await supabase.rpc('fn_blueprint_cobertura', { p_vertical: 'revenda_veiculos' })
    setCob((c as Cob) ?? null)

    const { data: ac } = await supabase.from('blueprint_tela_cobertura')
      .select('status, evidencia, foto_url, avaliado_em, blueprint_tela_requisito(tela_num, tela_nome, requisito)')
      .in('status', ['ausente', 'quebrado']).order('avaliado_em', { ascending: false }).limit(60)
    setAchados((ac as unknown as Achado[]) ?? [])

    // histórico por execução (agrupa as coberturas do juiz)
    const { data: ex } = await supabase.from('blueprint_tela_cobertura')
      .select('execucao_id, foto_url, avaliado_em, blueprint_tela_requisito(tela_num)')
      .order('avaliado_em', { ascending: false }).limit(400)
    const mapa = new Map<string, Exec>()
    ;(ex as unknown as { execucao_id: string | null; foto_url: string | null; avaliado_em: string; blueprint_tela_requisito: { tela_num: number } | null }[] ?? [])
      .forEach((r) => {
        if (!r.execucao_id) return
        const cur = mapa.get(r.execucao_id)
        if (cur) { cur.n++ } else {
          mapa.set(r.execucao_id, { execucao_id: r.execucao_id, tela: r.blueprint_tela_requisito?.tela_num ?? null, foto: r.foto_url, quando: r.avaliado_em, n: 1 })
        }
      })
    setExecs(Array.from(mapa.values()).slice(0, 30))
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar().catch((e) => setErro(String(e))) }, [carregar])

  if (admin === false) return <div style={{ padding: 40, background: C.bg, minHeight: '100vh', color: C.espM }}>Área restrita à PS (PS_ADMIN).</div>
  if (admin === null) return <div style={{ padding: 40, background: C.bg, minHeight: '100vh', color: C.espM }}>Carregando…</div>

  const telas = cob?.por_tela ?? []

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '22px 16px 48px', maxWidth: 1120, margin: '0 auto', color: C.esp }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>Central de Desenvolvimento · Revenda</div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 2px' }}>Cobertura da Revenda (Documento Vivo V7)</h1>
      <p style={{ color: C.espM, fontSize: 13, margin: '0 0 16px' }}>17 telas · a régua vem do banco (R1c) e as avaliações, do juiz (R1d). % usa a avaliação mais recente, senão o baseline.</p>

      {erro && <div style={{ background: C.redBg, color: C.red, padding: '9px 13px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{erro}</div>}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <Kpi rotulo="Cobertura geral" valor={cob?.geral_pct != null ? `${cob.geral_pct}%` : '—'} cor={corPct(cob?.geral_pct ?? 0)} />
        <Kpi rotulo="Essenciais" valor={cob?.essenciais_pct != null ? `${cob.essenciais_pct}%` : '—'} cor={corPct(cob?.essenciais_pct ?? 0)} />
        <Kpi rotulo="Requisitos" valor={String(cob?.total_requisitos ?? '—')} cor={C.esp} />
      </div>

      <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 10px' }}>Por tela</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10, marginBottom: 26 }}>
        {telas.map((t) => (
          <div key={t.tela_num} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700 }}>T{t.tela_num} · {t.tela_nome}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6 }}>
              <span style={{ fontSize: 22, fontWeight: 700, color: corPct(t.pct) }}>{t.pct}%</span>
              <span style={{ fontSize: 11, color: C.espM }}>{t.com_algo}/{t.requisitos} req.</span>
            </div>
            <div style={{ height: 6, background: C.cream, borderRadius: 999, marginTop: 6, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, t.pct)}%`, height: '100%', background: corPct(t.pct) }} />
            </div>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 10px' }}>Ausentes e quebrados (achados do juiz)</h2>
      {achados.length === 0 ? (
        <div style={{ background: C.white, border: `1px dashed ${C.border}`, borderRadius: 12, padding: '18px 14px', color: C.espM, fontSize: 13, marginBottom: 26 }}>
          Nenhuma avaliação do juiz ainda — rode o juiz nas 9 rotas da demo (R1d/R1e). Enquanto isso a % por tela usa o baseline.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8, marginBottom: 26 }}>
          {achados.map((a, i) => (
            <div key={i} style={{ background: C.white, border: `1px solid ${a.status === 'quebrado' ? C.red : C.border}`, borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: a.status === 'quebrado' ? C.redBg : C.amberBg, color: a.status === 'quebrado' ? C.red : C.amber, textTransform: 'uppercase' }}>{a.status}</span>
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>T{a.blueprint_tela_requisito?.tela_num} · {a.blueprint_tela_requisito?.tela_nome}</span>
                <span style={{ fontSize: 11, color: C.espL, marginLeft: 'auto' }}>{brDate(a.avaliado_em)}</span>
              </div>
              <div style={{ fontSize: 13, marginTop: 4 }}>{a.blueprint_tela_requisito?.requisito}</div>
              {a.evidencia && <div style={{ fontSize: 12, color: C.espM, marginTop: 3 }}>{a.evidencia}</div>}
              {a.foto_url && <div style={{ marginTop: 6, maxWidth: 260 }}><ScreenshotAssinado valor={a.foto_url} alt={`evidência T${a.blueprint_tela_requisito?.tela_num}`} style={{ width: '100%', maxHeight: 160, objectFit: 'contain', borderRadius: 6, border: `1px solid ${C.border}` }} /></div>}
            </div>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 10px' }}>Execuções do juiz (histórico)</h2>
      {execs.length === 0 ? (
        <div style={{ color: C.espM, fontSize: 13 }}>Sem execuções registradas ainda.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
          {execs.map((e) => (
            <div key={e.execucao_id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
              {e.foto
                ? <ScreenshotAssinado valor={e.foto} alt={`tela ${e.tela}`}
                    style={{ width: '100%', height: 110, objectFit: 'cover' }}
                    fallbackStyle={{ height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.espL, fontSize: 12, background: C.cream }}
                    fallbackTexto="sem foto" />
                : <div style={{ height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.espL, fontSize: 12 }}>sem foto</div>}
              <div style={{ padding: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>T{e.tela ?? '—'} · {e.n} req.</div>
                <div style={{ fontSize: 10.5, color: C.espL }}>{brDate(e.quando)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Kpi({ rotulo, valor, cor }: { rotulo: string; valor: string; cor: string }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 18px', minWidth: 140 }}>
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, color: C.espM, fontWeight: 700 }}>{rotulo}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: cor, marginTop: 2 }}>{valor}</div>
    </div>
  )
}
