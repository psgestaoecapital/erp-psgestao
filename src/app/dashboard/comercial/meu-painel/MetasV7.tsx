'use client'
// Aba Metas do painel v7 (SPEC §2.8). Realizado e projeção vêm do motor (base da fn_bi_comercial_base, escopo do BI).
// Metas gravadas em erp_meta via fn_meta_comercial_salvar (só líder). Sem meta cadastrada, o painel mostra a
// SUGESTÃO (mês anterior + 5%) como ponto de partida e avisa que é sugestão, não meta.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { calcularModelo, estadoPadrao, gruposProduto, type BaseV5 } from './motor-v5'

const C = { esp: '#3D2314', off: '#FAF7F2', gold: '#C8941A', bd: '#E7DED3', m: '#6B5D4F', d: '#9C8E80', ok: '#1a8f63', warn: '#b07a12', bad: '#C0392B', bg2: '#F0ECE3' }
const ROTA = '/dashboard/comercial/meu-painel'
const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat('pt-BR', o)
const brl0 = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
const pct = (v: number | null) => v == null ? '—' : `${nf({ maximumFractionDigits: 0 }).format(v)}%`

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const mesAtual = () => { const h = new Date(); return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}` }
const mesAnterior = (mes: string) => { const [y, m] = mes.split('-').map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const intervaloMes = (mes: string) => {
  const [y, m] = mes.split('-').map(Number)
  const ini = new Date(y, m - 1, 1); const fim = new Date(y, m, 0)
  return { de: iso(ini), ate: iso(fim), diasNoMes: fim.getDate() }
}
const SEMAFORO = (p: number | null) => p == null ? C.d : p >= 100 ? C.ok : p >= 85 ? C.warn : C.bad

type Realizado = Map<string, { nome: string; val: number }>
async function realizadoDoMes(empresa: string, mes: string): Promise<{ mapa: Realizado; base: BaseV5 | null }> {
  const { de, ate } = intervaloMes(mes)
  const { data, error } = await supabase.rpc('fn_bi_comercial_base', { p_company_id: empresa, p_de: de, p_ate: ate })
  if (error || !data) return { mapa: new Map(), base: null }
  const base = data as BaseV5
  const pg = gruposProduto(base)
  const modelo = calcularModelo(base, estadoPadrao(base), pg)
  const mapa: Realizado = new Map()
  modelo.venM.forEach((a, vi) => {
    const cod = base.ven[vi]?.[0] ?? String(vi)
    mapa.set(cod, { nome: base.ven[vi]?.[1] || cod, val: a.val })
  })
  return { mapa, base }
}

type Props = { empresa: string }
export function MetasV7({ empresa }: Props) {
  const [mes, setMes] = useState(mesAtual())
  const [anterior, setAnterior] = useState<Realizado>(new Map())
  const [atual, setAtual] = useState<Realizado>(new Map())
  const [metas, setMetas] = useState<Map<string, number>>(new Map())
  const [lider, setLider] = useState(false)
  const [editando, setEditando] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)

  const carregar = async () => {
    setCarregando(true); setErro(null)
    const [ant, cur, lis] = await Promise.all([
      realizadoDoMes(empresa, mesAnterior(mes)),
      realizadoDoMes(empresa, mes),
      supabase.rpc('fn_meta_comercial_listar', { p_company_id: empresa, p_mes: mes }),
    ])
    setAnterior(ant.mapa); setAtual(cur.mapa)
    if (cur.base) setLider(cur.base.modo === 'lider')
    if (lis.error) setErro(erroAmigavel(lis.error))
    const mapa = new Map<string, number>()
    const data = lis.data as { ok?: boolean; metas?: { vendedor_cod: string; valor: number }[] } | null
    ;(data?.metas ?? []).forEach((m) => mapa.set(m.vendedor_cod, Number(m.valor)))
    setMetas(mapa)
    setCarregando(false)
  }
  useEffect(() => { void carregar() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [empresa, mes])

  // Linhas: união dos vendedores com realizado no mês anterior, no atual ou com meta cadastrada.
  const linhas = useMemo(() => {
    const codigos = new Set<string>([...anterior.keys(), ...atual.keys(), ...metas.keys()])
    const { diasNoMes } = intervaloMes(mes)
    const hoje = new Date()
    const estaNoMes = mes === mesAtual()
    const diasPassados = estaNoMes ? Math.max(1, hoje.getDate()) : diasNoMes
    return [...codigos].map((cod) => {
      const nome = atual.get(cod)?.nome || anterior.get(cod)?.nome || cod
      const real = anterior.get(cod)?.val ?? null
      const sugerida = real != null ? Math.round(real * 1.05) : null
      const meta = metas.get(cod) ?? null
      const vendido = atual.get(cod)?.val ?? 0
      const projecao = estaNoMes ? (vendido / diasPassados) * diasNoMes : vendido
      const alvo = meta ?? sugerida
      const pctMeta = alvo && alvo > 0 ? 100 * projecao / alvo : null
      return { cod, nome, real, sugerida, meta, vendido, projecao, alvo, pctMeta, ehMeta: meta != null }
    }).sort((a, b) => (b.alvo ?? 0) - (a.alvo ?? 0))
  }, [anterior, atual, metas, mes])

  const temMeta = metas.size > 0
  const salvar = async (cod: string, nome: string) => {
    const txt = (editando[cod] ?? '').replace(/\./g, '').replace(',', '.')
    const valor = Number(txt)
    if (!Number.isFinite(valor) || valor < 0) { setErro('Informe um valor de meta válido.'); return }
    setErro(null); setMsg(null)
    const { data, error } = await supabase.rpc('fn_meta_comercial_salvar', { p_company_id: empresa, p_mes: mes, p_vendedor: cod, p_valor: valor })
    const r = data as { ok?: boolean; erro?: string } | null
    if (error || !r?.ok) { setErro(error ? erroAmigavel(error) : `Não foi possível salvar a meta de ${nome}: ${r?.erro ?? 'erro'}.`); return }
    setMsg(`Meta de ${nome} salva: ${brl0(valor)}.`)
    setEditando((e) => { const n = { ...e }; delete n[cod]; return n })
    await carregar()
  }
  const preencherSugestoes = () => {
    const novos: Record<string, string> = {}
    linhas.forEach((l) => { if (!l.ehMeta && l.sugerida != null) novos[l.cod] = String(l.sugerida) })
    setEditando(novos)
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>Metas de vendas<AjudaCampo chave="com.painel.visao" rota={ROTA} /></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.m }}>Mês
          <input type="month" aria-label="Mês da meta" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.bd}`, minHeight: 40, fontSize: 14 }} /><AjudaCampo chave="com.painel.meta" rota={ROTA} />
        </label>
      </div>

      {!temMeta && (
        <div style={{ background: '#fff', border: `1px solid ${C.gold}`, borderRadius: 12, padding: 14, fontSize: 14 }}>
          <b>As metas de {mes} ainda não estão cadastradas.</b> Abaixo, a sugestão para a diretoria: mês anterior + 5%. Ajuste e salve; o painel passa a medir realizado × meta. Enquanto não houver meta, a sugestão é só um ponto de partida (não é meta).
          {lider && (
            <div style={{ marginTop: 8 }}>
              <button type="button" onClick={preencherSugestoes} style={{ padding: '10px 14px', minHeight: 44, borderRadius: 10, border: 'none', background: C.gold, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
                Cadastrar metas de {mes}
              </button>
            </div>
          )}
        </div>
      )}

      {erro && <div role="alert" style={{ color: C.bad, fontSize: 14 }}>{erro}</div>}
      {msg && <div role="status" style={{ color: C.ok, fontSize: 14 }}>{msg}</div>}
      {carregando && <div style={{ fontSize: 13, color: C.m }}>Carregando…</div>}

      {/* Tabela por vendedor: TODOS os vendedores */}
      <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 900 }}>
          <thead>
            <tr style={{ color: C.m, textAlign: 'left' }}>
              <th style={{ padding: '6px 4px' }}>Vendedor</th>
              <th style={{ padding: '6px 4px', textAlign: 'right' }}>Mês anterior (realizado)</th>
              <th style={{ padding: '6px 4px', textAlign: 'right' }}>Meta</th>
              <th style={{ padding: '6px 4px', textAlign: 'right' }}>Já vendido</th>
              <th style={{ padding: '6px 4px', textAlign: 'right' }}>Projeção</th>
              <th style={{ padding: '6px 4px', minWidth: 160 }}>Projeção × meta</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.cod} style={{ borderTop: `1px solid ${C.bd}` }}>
                <td style={{ padding: '6px 4px' }}>{l.nome} <span style={{ color: C.d, fontSize: 11 }}>· {l.cod}</span></td>
                <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl0(l.real)}</td>
                <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                  {lider && editando[l.cod] !== undefined ? (
                    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                      <input aria-label={`Meta de ${l.nome}`} inputMode="decimal" value={editando[l.cod]} onChange={(e) => setEditando((x) => ({ ...x, [l.cod]: e.target.value }))}
                        style={{ width: 120, padding: '6px 8px', borderRadius: 8, border: `1px solid ${C.bd}`, fontSize: 13, minHeight: 36, textAlign: 'right' }} /><AjudaCampo chave="com.painel.meta" rota={ROTA} />
                      <button type="button" onClick={() => salvar(l.cod, l.nome)} style={{ padding: '6px 10px', minHeight: 36, borderRadius: 8, border: 'none', background: C.esp, color: '#fff', cursor: 'pointer', fontSize: 12 }}>Salvar</button>
                    </span>
                  ) : (
                    <span>
                      {l.ehMeta ? brl0(l.meta) : <span style={{ color: C.d }}>sugestão {brl0(l.sugerida)}</span>}
                      {lider && (
                        <button type="button" onClick={() => setEditando((x) => ({ ...x, [l.cod]: String(l.meta ?? l.sugerida ?? '') }))} style={{ marginLeft: 6, padding: '4px 8px', minHeight: 32, borderRadius: 8, border: `1px solid ${C.bd}`, background: '#fff', cursor: 'pointer', fontSize: 11 }}>
                          {l.ehMeta ? 'Editar' : 'Definir'}
                        </button>
                      )}
                    </span>
                  )}
                </td>
                <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl0(l.vendido)}</td>
                <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl0(l.projecao)}</td>
                <td style={{ padding: '6px 4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ flex: 1, height: 10, background: C.bg2, borderRadius: 5, overflow: 'hidden' }}>
                      <span style={{ display: 'block', height: 10, width: `${Math.min(100, l.pctMeta ?? 0)}%`, background: SEMAFORO(l.pctMeta) }} />
                    </span>
                    <b style={{ color: SEMAFORO(l.pctMeta), minWidth: 44, textAlign: 'right' }}>{pct(l.pctMeta)}</b>
                  </div>
                </td>
              </tr>
            ))}
            {linhas.length === 0 && !carregando && (
              <tr><td colSpan={6} style={{ padding: 12, color: C.m }}>Sem vendas no mês anterior nem no mês atual para mostrar.</td></tr>
            )}
          </tbody>
        </table>
        <div style={{ fontSize: 12, color: C.m, marginTop: 8 }}>
          Semáforo: verde ≥ 100% da meta · amarelo 85–99% · vermelho &lt; 85%. A projeção é o ritmo do mês até hoje × dias do mês (estimativa). Sem dado de custo, esta tela não mostra lucro nem margem.
          {!lider && ' Você está vendo só a sua linha; a gravação de metas é do líder.'}
        </div>
      </div>
    </div>
  )
}
