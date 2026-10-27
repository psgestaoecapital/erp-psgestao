'use client'
// Aba Codes · "Evolução das telas do Hub" (CEO 27/10): por tela, a nota atual do auditor Max, a anterior (outro dia),
// a seta de evolução e a última PR publicada que cita o módulo (aproximação, o banco não guarda arquivos por PR).
// RPC fn_hub_evolucao_telas, só leitura, recarrega a cada 60 s. Ordena por menor nota primeiro (as que faltam no topo).
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', BRANCO = '#FFFFFF', BD = '#E7DED3', TXM = '#6B5D4F'
const VERDE = '#166534', VERMELHO = '#B91C1C', CINZA = '#8A7D6E', ROTA = '/dashboard/dev/codes'

type Tela = {
  rota: string
  modulo: string
  nota_atual: number | string | null
  nota_anterior: number | string | null
  delta: number | string | null
  pr_numero: number | null
  pr_titulo: string | null
  auditada_em: string | null
}

const num = (v: number | string | null): number | null => (v === null || v === '' ? null : Number(v))
const dataBR = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—')

// Seta de evolução: ▲ subiu (verde), ● igual (cinza), ▼ caiu (vermelho), — sem comparação.
function Evolucao({ delta }: { delta: number | null }) {
  if (delta === null) return <span style={{ color: TXM }}>—</span>
  if (delta > 0) return <b style={{ color: VERDE }}>▲ +{delta}</b>
  if (delta < 0) return <b style={{ color: VERMELHO }}>▼ {delta}</b>
  return <span style={{ color: CINZA }}>● igual</span>
}

export default function EvolucaoTelasHub() {
  const [telas, setTelas] = useState<Tela[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('fn_hub_evolucao_telas')
    if (error) { setErro(error.message); return }
    setErro(null); setTelas((data ?? []) as Tela[])
  }, [])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carregar() só altera o estado após o await (não é síncrono)
    void carregar()
    const i = setInterval(() => void carregar(), 60_000)
    return () => clearInterval(i)
  }, [carregar])

  return (
    <section data-testid="codes-evolucao-telas-hub" style={{ background: BRANCO, border: `1px solid ${BD}`, borderRadius: 12, padding: 12, color: ESP }}>
      <h3 style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 700 }}>
        Evolução das telas do Hub <AjudaCampo chave="dev.codes.evolucao_telas" rota={ROTA} />
      </h3>
      <div style={{ fontSize: 12, color: TXM, marginBottom: 8 }}>
        Nota do auditor Max, por tela · a seta compara com a auditoria anterior · a última PR cita o módulo
      </div>
      {erro && <div role="alert" style={{ fontSize: 12 }}>Não consegui ler a evolução das telas: {erro}</div>}
      {!telas && !erro && <div style={{ fontSize: 12, color: TXM }}>Carregando…</div>}
      {telas && telas.length === 0 && !erro && <div style={{ fontSize: 12, color: TXM }}>Nenhuma tela do Hub mapeada ainda.</div>}
      {telas && telas.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: TXM, textAlign: 'left' }}>
                <th style={{ padding: '4px 6px' }}>Tela</th>
                <th style={{ padding: '4px 6px' }}>Nota</th>
                <th style={{ padding: '4px 6px' }}>Evolução</th>
                <th style={{ padding: '4px 6px' }}>Última PR</th>
                <th style={{ padding: '4px 6px' }}>Auditada em</th>
              </tr>
            </thead>
            <tbody>
              {telas.map((t) => (
                <tr key={t.rota} style={{ borderTop: `1px solid ${BD}` }}>
                  <td style={{ padding: '4px 6px', fontWeight: 600 }}>{t.modulo}</td>
                  <td style={{ padding: '4px 6px' }}>{num(t.nota_atual) ?? '—'}</td>
                  <td style={{ padding: '4px 6px' }}><Evolucao delta={num(t.delta)} /></td>
                  <td style={{ padding: '4px 6px' }}>
                    {t.pr_numero ? (
                      <a href={`https://github.com/psgestaoecapital/erp-psgestao/pull/${t.pr_numero}`} target="_blank" rel="noreferrer" style={{ color: ESP, textDecoration: 'underline' }}>
                        #{t.pr_numero}
                      </a>
                    ) : '—'}
                  </td>
                  <td style={{ padding: '4px 6px', color: TXM }}>{dataBR(t.auditada_em)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
