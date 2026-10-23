'use client'
// Aba Codes · "Qualidade por vertical" (CEO 23/10): um gráfico de barras COMPACTO — duas colunas por
// vertical (Construído · Auditado/validado). Fonte única: RPC fn_dev_central_barras (já calcula no banco;
// authenticated executa). Só leitura, recarrega a cada 60 s. Substitui listas tela-a-tela que poluíam a tela.
import { useCallback, useEffect, useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', BRANCO = '#FFFFFF', BD = '#E7DED3', TXM = '#6B5D4F'
const OURO = '#B98900', VERDE = '#166534', ROTA = '/dashboard/dev/codes'

type Barra = {
  area_slug: string
  telas: number
  construido_pct: number | string | null
  construido_sem_dado: boolean
  auditado_pct: number | string | null
  auditado_sem_dado: boolean
}
// Nome curto por vertical para caber no eixo X.
const NOME: Record<string, string> = {
  hub: 'Hub', pm: 'P&M', oficina: 'Oficina', revenda_veiculos: 'Revenda', industrial: 'Indústria',
  compliance: 'Compliance', bpo: 'BPO', gestao_empresarial: 'Gestão', wealth: 'Wealth', odonto: 'Odonto',
  agro: 'Agro', ecommerce: 'E-commerce', medica: 'Médica',
}
const nomeVertical = (s: string) => NOME[s] ?? s.replace(/_/g, ' ')
const pct = (v: number | string | null): number | null => (v === null || v === '' ? null : Number(v))
const eixo = { fill: TXM, fontSize: 11 }

export default function BarrasQualidadeVertical() {
  const [linhas, setLinhas] = useState<Barra[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('fn_dev_central_barras')
    if (error) { setErro(error.message); return }
    setErro(null); setLinhas((data ?? []) as Barra[])
  }, [])
  useEffect(() => {
    void carregar()
    const i = setInterval(() => void carregar(), 60_000)
    return () => clearInterval(i)
  }, [carregar])

  // Só verticais com tela mapeada; as mais construídas primeiro.
  const dados = (linhas ?? [])
    .filter((l) => l.telas > 0)
    .map((l) => ({ rotulo: nomeVertical(l.area_slug), construido: pct(l.construido_pct) ?? 0, auditado: pct(l.auditado_pct) ?? 0 }))
    .sort((a, b) => b.construido - a.construido)

  return (
    <section data-testid="codes-qualidade-vertical" style={{ background: BRANCO, border: `1px solid ${BD}`, borderRadius: 12, padding: 14, marginBottom: 12, color: ESP }}>
      <h3 style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 700 }}>
        Qualidade por vertical <AjudaCampo chave="dev.codes.qualidade_vertical" rota={ROTA} />
      </h3>
      <div style={{ fontSize: 12, color: TXM, marginBottom: 10 }}>% construído e % auditado · validado das telas e funções, por vertical · ao vivo</div>
      {erro && <div role="alert" style={{ fontSize: 12 }}>Não consegui ler a qualidade por vertical: {erro}</div>}
      {!linhas && !erro && <div style={{ fontSize: 12, color: TXM }}>Carregando…</div>}
      {linhas && dados.length === 0 && !erro && <div style={{ fontSize: 12, color: TXM }}>Nenhuma vertical com telas mapeadas ainda.</div>}
      {dados.length > 0 && (
        <div style={{ height: 280 }}>
          <ResponsiveContainer>
            <ComposedChart data={dados} margin={{ top: 8, right: 8, left: -12, bottom: 48 }} barGap={2} barCategoryGap="18%">
              <CartesianGrid stroke={BD} vertical={false} />
              <XAxis dataKey="rotulo" tick={eixo} interval={0} angle={-35} textAnchor="end" height={56} />
              <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} tick={eixo} width={44} />
              <Tooltip formatter={(v) => `${v}%`} contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="construido" name="Construído" fill={OURO} radius={[3, 3, 0, 0]} />
              <Bar dataKey="auditado" name="Auditado · validado" fill={VERDE} radius={[3, 3, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  )
}
