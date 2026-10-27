'use client'
// Aba Codes · "Qualidade por vertical" FIDEDIGNO (CEO 26/10): a fonte é a NOTA REAL do auditor
// (RPC fn_codes_qualidade_vertical: média de system_screens_insights.score_evolucao_pct, última
// análise por rota), contando SÓ telas com FOTO FRESCA (últimos 7 dias). Não usa mais estado_real,
// que congelou em 20/10 e mentia (vertical "100%" com nota real baixa, tela nunca auditada como alto %).
// Vertical sem foto fresca = "não auditada" (barra cinza, nunca um % inventado). A data da última
// auditoria viaja no tooltip, pra o CEO saber se o dado é fresco. Só leitura, recarrega a cada 60 s.
import { useCallback, useEffect, useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', BRANCO = '#FFFFFF', BD = '#E7DED3', TXM = '#6B5D4F'
const OURO = '#B98900', VERDE = '#166534', CINZA = '#CBBFAE', ROTA = '/dashboard/dev/codes'

type Linha = {
  area_slug: string
  telas: number
  telas_frescas: number
  nota_media: number | string | null
  prontas_pct: number | string | null
  sem_foto_fresca: boolean
  ultima_auditoria: string | null
}
// Nome curto por vertical para caber no eixo X.
const NOME: Record<string, string> = {
  hub: 'Hub', pm: 'P&M', oficina: 'Oficina', revenda_veiculos: 'Revenda', industrial: 'Indústria',
  compliance: 'Compliance', bpo: 'BPO', gestao_empresarial: 'Gestão', wealth: 'Wealth', odonto: 'Odonto',
  agro: 'Agro', ecommerce: 'E-commerce', medica: 'Médica', custeio_a: 'Custeio A', custeio_b: 'Custeio B',
}
const nomeVertical = (s: string) => NOME[s] ?? s.replace(/_/g, ' ')
const num = (v: number | string | null): number | null => (v === null || v === '' ? null : Number(v))
const dataBR = (s: string | null) => (s ? s.split('-').reverse().join('/') : 'nunca')
const eixo = { fill: TXM, fontSize: 11 }

type Ponto = {
  rotulo: string; nota: number | null; prontas: number | null; naoAuditada: number | null
  sem: boolean; telas: number; frescas: number; desde: string | null
}

// Tooltip honesto: número real quando há foto fresca; "não auditada" + data quando não há.
function Dica({ active, payload }: { active?: boolean; payload?: Array<{ payload: Ponto }> }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div style={{ background: BRANCO, border: `1px solid ${BD}`, borderRadius: 8, padding: '8px 10px', fontSize: 12, color: ESP, maxWidth: 230 }}>
      <div style={{ fontWeight: 700, marginBottom: 2 }}>{p.rotulo}</div>
      {p.sem ? (
        <div style={{ color: TXM }}>Não auditada — sem foto fresca.<br />Última auditoria: <b>{dataBR(p.desde)}</b> · {p.telas} tela(s).</div>
      ) : (
        <div>
          Nota média (auditor): <b>{p.nota ?? '—'}%</b><br />
          Prontas (nota ≥ 95): <b>{p.prontas ?? 0}%</b><br />
          <span style={{ color: TXM }}>{p.frescas} de {p.telas} tela(s) com foto fresca · auditado {dataBR(p.desde)}</span>
        </div>
      )}
    </div>
  )
}

export default function BarrasQualidadeVertical({ altura = 280 }: { altura?: number } = {}) {
  const [linhas, setLinhas] = useState<Linha[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('fn_codes_qualidade_vertical')
    if (error) { setErro(error.message); return }
    setErro(null); setLinhas((data ?? []) as Linha[])
  }, [])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carregar() só altera o estado após o await (não é síncrono)
    void carregar()
    const i = setInterval(() => void carregar(), 60_000)
    return () => clearInterval(i)
  }, [carregar])

  // Só verticais com tela mapeada. Auditadas primeiro (maior nota), depois as não auditadas.
  const dados: Ponto[] = (linhas ?? [])
    .filter((l) => l.telas > 0)
    .map((l) => ({
      rotulo: nomeVertical(l.area_slug),
      nota: l.sem_foto_fresca ? null : num(l.nota_media),
      prontas: l.sem_foto_fresca ? null : (num(l.prontas_pct) ?? 0),
      naoAuditada: l.sem_foto_fresca ? 6 : null, // tocão cinza baixo = "não auditada" (nunca um % alto)
      sem: l.sem_foto_fresca,
      telas: l.telas,
      frescas: l.telas_frescas,
      desde: l.ultima_auditoria,
    }))
    .sort((a, b) => Number(a.sem) - Number(b.sem) || (b.nota ?? -1) - (a.nota ?? -1))

  const naoAuditadas = dados.filter((d) => d.sem).length

  return (
    <section data-testid="codes-qualidade-vertical" style={{ background: BRANCO, border: `1px solid ${BD}`, borderRadius: 12, padding: 12, marginBottom: 0, color: ESP }}>
      <h3 style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 700 }}>
        Qualidade por vertical <AjudaCampo chave="dev.codes.qualidade_vertical" rota={ROTA} />
      </h3>
      <div style={{ fontSize: 12, color: TXM, marginBottom: 10 }}>
        Nota real do auditor (média) e % prontas (nota ≥ 95), por vertical · só telas com foto fresca (7 dias) · cinza = não auditada
      </div>
      {erro && <div role="alert" style={{ fontSize: 12 }}>Não consegui ler a qualidade por vertical: {erro}</div>}
      {!linhas && !erro && <div style={{ fontSize: 12, color: TXM }}>Carregando…</div>}
      {linhas && dados.length === 0 && !erro && <div style={{ fontSize: 12, color: TXM }}>Nenhuma vertical com telas mapeadas ainda.</div>}
      {dados.length > 0 && (
        <>
          <div style={{ height: altura }}>
            <ResponsiveContainer>
              <ComposedChart data={dados} margin={{ top: 8, right: 8, left: -12, bottom: 48 }} barGap={2} barCategoryGap="18%">
                <CartesianGrid stroke={BD} vertical={false} />
                <XAxis dataKey="rotulo" tick={eixo} interval={0} angle={-35} textAnchor="end" height={56} />
                <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} tick={eixo} width={44} />
                <Tooltip content={<Dica />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="nota" name="Nota média (auditor)" fill={OURO} radius={[3, 3, 0, 0]} />
                <Bar dataKey="prontas" name="Prontas (≥95)" fill={VERDE} radius={[3, 3, 0, 0]} />
                <Bar dataKey="naoAuditada" name="Não auditada" fill={CINZA} radius={[3, 3, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {naoAuditadas > 0 && (
            <div style={{ fontSize: 11, color: TXM, marginTop: 6 }}>
              {naoAuditadas} vertical(is) sem foto fresca aparecem em cinza (não auditada) — precisam ser re-auditadas pelo robô.
            </div>
          )}
        </>
      )}
    </section>
  )
}
