'use client'
// Comercial › Meu painel › aba "Indicadores" (KPIs) — v5.
// Consome a RPC de servidor fn_bi_comercial_kpis (agregação pronta no banco, com a MESMA guarda de escopo do BI:
// fn_bi_comercial_scope — vendedor vê só a própria venda, líder vê a empresa). Mostra os números do período em cartões:
// faturamento, volume, clientes, cidades, R$ por kg e ticket por cliente. Lucro/margem só aparecem quando houver dado
// confiável (a RPC devolve lucro_status); nada é inventado. Identidade PS. RD-95 ("?" em todo cartão) · RD-98 (erro amigável).
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

const C = { esp: '#3D2314', gold: '#C8941A', bd: '#E7DED3', m: '#6B5D4F', bg2: '#F0ECE3', verde: '#3f7d4e', azul: '#2f6f8f', warn: '#b07a12' }
const ROTA = '/dashboard/comercial/meu-painel'
const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat('pt-BR', o)
const brl0 = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
const brl2 = (v: number | null | undefined) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
const int = (v: number | null | undefined) => v == null ? '—' : nf({ maximumFractionDigits: 0 }).format(v)
const kg0 = (v: number | null | undefined) => v == null ? '—' : nf({ maximumFractionDigits: 0 }).format(v) + ' kg'

type Kpis = {
  ok: boolean; erro?: string; escopo?: string
  volume_kg?: number; faturamento?: number; clientes?: number; cidades?: number
  ticket_kg?: number | null; ticket_cliente?: number | null
  faturamento_com_selecao?: number; volume_kg_com_selecao?: number; ticket_kg_com_selecao?: number | null
  lucro?: number | null; margem_pct?: number | null; lucro_status?: string
}

const card: CSSProperties = { background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 16, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }

function Kpi({ rot, chave, valor, sub, cor }: { rot: string; chave: string; valor: ReactNode; sub?: ReactNode; cor?: string }) {
  return (
    <div style={card}>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.m, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <span>{rot}</span><AjudaCampo chave={chave} rota={ROTA} />
      </div>
      <div style={{ fontFamily: 'Georgia, serif', fontSize: 28, lineHeight: 1.1, color: cor ?? C.esp, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
      {sub != null && <div style={{ fontSize: 13, color: C.m, lineHeight: 1.4 }}>{sub}</div>}
    </div>
  )
}

export function AbaKpis({ empresa, de, ate, vendedorCod }: { empresa: string; de: string; ate: string; vendedorCod: string | null }) {
  const [k, setK] = useState<Kpis | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setCarregando(true); setErro(null)
    void Promise.resolve(
      supabase.rpc('fn_bi_comercial_kpis', { p_company_id: empresa, p_dt_ini: de, p_dt_fim: ate, p_vendedor: vendedorCod }),
    ).then(({ data, error }) => {
      if (!vivo) return
      setCarregando(false)
      if (error) { setErro(erroAmigavel(error)); setK(null); return }
      const d = data as Kpis
      if (!d?.ok) { setErro(d?.erro === 'sem_acesso_comercial' ? 'Você não tem acesso ao comercial desta empresa.' : (d?.erro ?? 'Não foi possível carregar.')); setK(null); return }
      setK(d)
    })
    return () => { vivo = false }
  }, [empresa, de, ate, vendedorCod])

  const temSelecao = !!k && Number(k.volume_kg_com_selecao ?? 0) > 0

  return (
    <section style={{ display: 'grid', gap: 14 }} aria-label="Indicadores do período">
      <div style={{ ...card, gap: 4 }}>
        <div style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>Indicadores do período<AjudaCampo chave="com.painel.leituras" rota={ROTA} /></div>
        <div style={{ fontSize: 12, color: C.m }}>Os números fecham o período e o recorte escolhidos no topo. {vendedorCod ? 'Filtrado por um vendedor.' : 'Toda a sua carteira.'}</div>
      </div>

      {carregando && <div style={card}>Carregando…</div>}
      {erro && <div role="alert" style={{ ...card, borderLeft: `5px solid ${C.warn}` }}>Não foi possível carregar os indicadores: {erro}</div>}

      {!carregando && !erro && k && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
            <Kpi rot="Faturamento" chave="com.painel.faturado" valor={brl0(k.faturamento)} cor={C.esp} />
            <Kpi rot="Volume" chave="com.painel.volume" valor={kg0(k.volume_kg)} />
            <Kpi rot="Clientes" chave="com.painel.clientes" valor={int(k.clientes)} />
            <Kpi rot="Cidades" chave="com.painel.cidades" valor={int(k.cidades)} />
            <Kpi rot="R$ por kg" chave="com.painel.rpkg" valor={brl2(k.ticket_kg ?? null)} sub="Faturamento ÷ volume" />
            <Kpi rot="Ticket por cliente" chave="com.painel.ticket" valor={brl0(k.ticket_cliente ?? null)} sub="Faturamento ÷ clientes" />
          </div>

          {temSelecao && (
            <div style={{ ...card }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>Na análise (só o que entra na seleção)<AjudaCampo chave="com.painel.analise" rota={ROTA} /></div>
              <div style={{ fontSize: 14, color: C.esp }}>
                {brl0(k.faturamento_com_selecao)} em {kg0(k.volume_kg_com_selecao)} · <b>{brl2(k.ticket_kg_com_selecao ?? null)}</b>/kg. O que fica fora (despojo) é marcado na engrenagem e não entra no preço médio.
              </div>
            </div>
          )}

          <div style={{ ...card, borderLeft: `5px solid ${C.azul}` }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.m, display: 'flex', alignItems: 'center', gap: 4 }}>Lucro e margem<AjudaCampo chave="com.painel.indice" rota={ROTA} /></div>
            <div style={{ fontSize: 14, color: C.m }}>
              {k.lucro == null
                ? 'Aguardando dado de custo confiável para calcular lucro e margem — não mostramos número estimado.'
                : <>Lucro {brl0(k.lucro)} · margem {k.margem_pct == null ? '—' : nf({ minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(k.margem_pct) + '%'}.</>}
            </div>
          </div>
        </>
      )}
    </section>
  )
}

export default AbaKpis
