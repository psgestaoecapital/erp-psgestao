'use client'
// Mapa da Infra (CEO 14/10): fluxograma por camadas do DESENHO ESPERADO (banco) com a cor de estado de cada nó, em tempo real.
// Fontes: fn_infra_estado (batimentos + cron.job_run_details). Configuração (cadência/tolerância) só PS_ADMIN — o banco recusa o resto.
import { useCallback, useEffect, useState } from 'react'
import { Network, Settings2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { haQuanto, porCamada, resumo, ROTULO_COR, type Cor, type Ligacao, type NoInfra } from '@/lib/dev/mapaInfra'

const ROTA = '/dashboard/dev/infra'
const COR: Record<Cor, { borda: string; fundo: string }> = {
  verde: { borda: '#16A34A', fundo: '#F0FDF4' }, amarelo: { borda: '#CA8A04', fundo: '#FEFCE8' },
  vermelho: { borda: '#DC2626', fundo: '#FEF2F2' }, sem_cadencia: { borda: '#E7DED3', fundo: '#FFFFFF' }, sem_dados: { borda: '#9C8E80', fundo: '#F5F1EA' },
}

export default function MapaInfra() {
  const [nos, setNos] = useState<NoInfra[]>([])
  const [lig, setLig] = useState<Ligacao[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [sel, setSel] = useState<NoInfra | null>(null)
  const [cad, setCad] = useState(''); const [tol, setTol] = useState(''); const [msg, setMsg] = useState('')

  const carregar = useCallback(async () => {
    const [e, l] = await Promise.all([
      supabase.rpc('fn_infra_estado'),
      supabase.from('erp_infra_ligacao').select('de_no,para_no,rotulo').eq('versao', 1),
    ])
    if (e.error) { setErro(e.error.message); return }
    setErro(null); setNos(((e.data as { nos?: NoInfra[] })?.nos) ?? []); setLig((l.data as Ligacao[]) ?? [])
  }, [])

  useEffect(() => {
    void carregar()
    const t = setInterval(() => void carregar(), 30000)
    const ch = supabase.channel('dev-infra-mapa')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'erp_infra_batimento' }, () => void carregar())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'erp_infra_no' }, () => void carregar())
      .subscribe()
    return () => { clearInterval(t); void supabase.removeChannel(ch) }
  }, [carregar])

  const abrir = (n: NoInfra) => { setSel(n); setCad(n.cadencia_min?.toString() ?? ''); setTol(String(n.tolerancia_min)); setMsg('') }
  const salvar = async () => {
    if (!sel) return
    const { error } = await supabase.rpc('fn_infra_config_salvar', { p_no: sel.chave, p_cadencia_min: cad === '' ? null : Number(cad), p_tolerancia_min: Number(tol) })
    setMsg(error ? error.message : 'Salvo.'); if (!error) void carregar()
  }
  const r = resumo(nos)
  const nome = (c: string) => nos.find((n) => n.chave === c)?.nome ?? c

  return (
    <div data-testid="mapa-infra" style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Network size={18} strokeWidth={1.5} />
        <h2 style={{ margin: 0, fontSize: 18, color: '#C8941A' }}>Mapa da Infra</h2>
        <AjudaCampo chave="dev.infra.no" rota={ROTA} />
        <span style={{ marginLeft: 'auto', fontSize: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {(['verde', 'amarelo', 'vermelho'] as Cor[]).map((c) => (
            <span key={c} style={{ color: COR[c].borda, fontWeight: 600 }}>● {r[c]} {ROTULO_COR[c].toLowerCase()}</span>
          ))}
          <AjudaCampo chave="dev.infra.cor" rota={ROTA} />
        </span>
      </div>
      {erro && <div role="alert" style={{ color: '#DC2626', fontSize: 13 }}>Não foi possível ler o mapa: {erro}</div>}
      <div style={{ display: 'flex', gap: 14, overflowX: 'auto', alignItems: 'flex-start', paddingBottom: 8 }}>
        {porCamada(nos).map((c) => (
          <section key={c.id} style={{ minWidth: 220, flex: '1 0 220px', display: 'grid', gap: 10 }}>
            <h3 style={{ margin: 0, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: '#7A6A5E' }}>{c.titulo}</h3>
            {c.nos.map((n) => {
              const saidas = lig.filter((x) => x.de_no === n.chave)
              return (
                <button key={n.chave} data-testid={`infra-no-${n.chave}`} data-cor={n.cor} onClick={() => abrir(n)}
                  style={{ textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', background: COR[n.cor].fundo, border: `2px solid ${COR[n.cor].borda}`, borderRadius: 10, padding: 10, display: 'grid', gap: 4 }}>
                  <strong style={{ fontSize: 13, color: '#2A1A10' }}>{n.nome}</strong>
                  <span style={{ fontSize: 11, color: COR[n.cor].borda, fontWeight: 600 }}>{ROTULO_COR[n.cor]}{n.atraso_min ? ` · +${n.atraso_min} min` : ''}</span>
                  <span style={{ fontSize: 11, color: '#7A6A5E' }}>Último batimento: {haQuanto(n.ultimo_batimento)}{n.itens_olhados ? ` · olhou ${n.itens_olhados}, decidiu ${n.itens_decididos}` : ''}</span>
                  {saidas.length > 0 && <span style={{ fontSize: 11, color: '#7A6A5E' }}>→ {saidas.map((s) => nome(s.para_no)).join(', ')}</span>}
                </button>
              )
            })}
          </section>
        ))}
      </div>
      {sel && (
        <section style={{ border: '1px solid #E8E2D6', borderRadius: 10, padding: 14, display: 'grid', gap: 10, background: '#fff' }}>
          <h3 style={{ margin: 0, fontSize: 15, display: 'flex', gap: 8, alignItems: 'center' }}><Settings2 size={16} strokeWidth={1.5} />Configuração · {sel.nome}<AjudaCampo chave="dev.infra.config" rota={ROTA} /></h3>
          <div style={{ fontSize: 12, color: '#7A6A5E' }}>Dono: {sel.dono} · Último batimento: {haQuanto(sel.ultimo_batimento)} <AjudaCampo chave="dev.infra.batimento" rota={ROTA} />{sel.detalhe ? ` · ${sel.detalhe}` : ''}</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
            <label style={{ fontSize: 12 }}>Cadência (min) <AjudaCampo chave="dev.infra.cadencia" rota={ROTA} /><br />
              <input data-testid="infra-cadencia" inputMode="numeric" value={cad} onChange={(e) => setCad(e.target.value)} style={{ width: 90, padding: 6 }} /></label>
            <label style={{ fontSize: 12 }}>Tolerância (min) <AjudaCampo chave="dev.infra.tolerancia" rota={ROTA} /><br />
              <input data-testid="infra-tolerancia" inputMode="numeric" value={tol} onChange={(e) => setTol(e.target.value)} style={{ width: 90, padding: 6 }} /></label>
            <button onClick={salvar} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#C8941A', color: '#3D2314', fontWeight: 600, cursor: 'pointer' }}>Salvar</button>
            <button onClick={() => setSel(null)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #E8E2D6', background: '#fff', cursor: 'pointer' }}>Fechar</button>
            {msg && <span role="status" style={{ fontSize: 12 }}>{msg}</span>}
          </div>
        </section>
      )}
    </div>
  )
}
