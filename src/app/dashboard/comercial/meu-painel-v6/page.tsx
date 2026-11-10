'use client'
// Comercial › Meu painel v6 (storytelling). Rota NOVA e separada do v5 (/dashboard/comercial/meu-painel), que segue
// intacto até o v6 ser validado. Este arquivo é a CASCA: carrega a base uma vez (fn_bi_comercial_base, escopo travado
// no banco — líder vê a empresa, vendedor só o próprio), calcula o modelo (motor-v5) e troca entre as abas.
// Cada aba desenha num componente próprio em ./abas/* para a tela crescer bloco a bloco sem inchar um arquivo só.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import {
  calcularModelo, estadoPadrao, gruposProduto, resumo,
  type BaseV5, type EstadoV5, type GrupoProduto, type ModeloV5,
} from '../meu-painel/motor-v5'
import { C, ROTA, iso, dataBR } from './abas/fmt'
import { VisaoGeral } from './abas/VisaoGeral'
import { Vendedores } from './abas/Vendedores'
import { Clientes } from './abas/Clientes'
import { Cidades } from './abas/Cidades'
import { Produtos } from './abas/Produtos'
import { PrecoDesconto } from './abas/PrecoDesconto'
import { Logistica } from './abas/Logistica'

type Aba = 'visao' | 'vendedores' | 'clientes' | 'cidades' | 'produtos' | 'preco' | 'logistica'
const ABAS: { id: Aba; nome: string; chave: string }[] = [
  { id: 'visao', nome: 'Visão geral', chave: 'comv6.aba_visao' },
  { id: 'vendedores', nome: 'Vendedores', chave: 'comv6.aba_vendedores' },
  { id: 'clientes', nome: 'Clientes', chave: 'comv6.aba_clientes' },
  { id: 'cidades', nome: 'Cidades', chave: 'comv6.aba_cidades' },
  { id: 'produtos', nome: 'Produtos', chave: 'comv6.aba_produtos' },
  { id: 'preco', nome: 'Preço e desconto', chave: 'comv6.aba_preco' },
  { id: 'logistica', nome: 'Logística', chave: 'comv6.aba_logistica' },
]

export default function MeuPainelV6() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null
  const [base, setBase] = useState<BaseV5 | null>(null)
  const [estado, setEstado] = useState<EstadoV5 | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aba, setAba] = useState<Aba>('visao')

  // Período: últimos 30 dias (mesmo recorte padrão do v5), até hoje.
  const intervalo = useMemo(() => {
    const hoje = new Date()
    const ini = new Date(hoje); ini.setDate(ini.getDate() - 29)
    return { de: iso(ini), ate: iso(hoje) }
  }, [])

  const carregar = useCallback(async () => {
    if (!empresa) return
    setCarregando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_bi_comercial_base', { p_company_id: empresa, p_de: intervalo.de, p_ate: intervalo.ate })
    setCarregando(false)
    if (error) { setErro(erroAmigavel(error)); setBase(null); return }
    setBase(data as BaseV5)
  }, [empresa, intervalo])
  useEffect(() => { void carregar() }, [carregar])
  useEffect(() => { setEstado(base ? estadoPadrao(base) : null) }, [base])

  const pg = useMemo<GrupoProduto[] | null>(() => base ? gruposProduto(base) : null, [base])
  const modelo = useMemo<ModeloV5 | null>(() => base && estado && pg ? calcularModelo(base, estado, pg) : null, [base, estado, pg])
  const r = useMemo(() => modelo ? resumo(modelo) : null, [modelo])

  if (!empresa) {
    return <div style={{ padding: 16, color: C.m }}>Escolha uma empresa para ver o painel.</div>
  }

  return (
    <div style={{ padding: 16, background: C.off, color: C.esp, minHeight: '100vh', maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>Como a Frioeste está vendendo</h1>
      <p style={{ fontSize: 14, color: C.m, margin: '0 0 12px' }}>
        {base ? <>De {dataBR(base.de)} a {dataBR(base.ate)}.</> : null}
        {carregando ? ' Carregando…' : null}
        {erro ? <span style={{ color: '#C0392B' }}> {erro}</span> : null}
      </p>

      {/* Abas */}
      <div role="tablist" aria-label="Abas do painel" style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.bd}`, marginBottom: 16, overflowX: 'auto' }}>
        {ABAS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={aba === t.id}
            onClick={() => setAba(t.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 2, padding: '8px 12px', border: 'none', background: 'none',
              cursor: 'pointer', fontSize: 14, whiteSpace: 'nowrap',
              color: aba === t.id ? C.esp : C.m, fontWeight: aba === t.id ? 700 : 500,
              borderBottom: aba === t.id ? `2px solid ${C.gold}` : '2px solid transparent', marginBottom: -1,
            }}
          >
            {t.nome}
            <AjudaCampo chave={t.chave} rota={ROTA} />
          </button>
        ))}
      </div>

      {r && base && modelo ? (
        aba === 'visao' ? <VisaoGeral base={base} modelo={modelo} r={r} />
          : aba === 'vendedores' ? <Vendedores base={base} modelo={modelo} r={r} />
          : aba === 'clientes' ? <Clientes base={base} modelo={modelo} r={r} />
          : aba === 'cidades' ? <Cidades base={base} modelo={modelo} r={r} />
          : aba === 'produtos' ? <Produtos base={base} modelo={modelo} r={r} />
          : aba === 'preco' ? <PrecoDesconto base={base} modelo={modelo} r={r} />
          : <Logistica base={base} modelo={modelo} r={r} />
      ) : !carregando && !erro ? (
        <div style={{ color: C.m }}>Sem dados para o período.</div>
      ) : null}

      <div style={{ marginTop: 16, fontSize: 12, color: C.d }}>
        Esta é a versão nova do painel. O painel atual continua disponível.
      </div>
    </div>
  )
}
