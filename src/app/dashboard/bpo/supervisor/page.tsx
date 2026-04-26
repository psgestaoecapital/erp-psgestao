'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { PSGC_COLORS } from '@/lib/psgc-tokens'

// Paleta local: usa PSGC_COLORS como fonte de verdade.
// Mantemos referencias curtas pra preservar legibilidade do codigo original.
const C = {
  espresso: PSGC_COLORS.espresso,
  offwhite: PSGC_COLORS.offWhite,
  card: PSGC_COLORS.offWhite,
  dourado: PSGC_COLORS.dourado,
  douradoClaro: PSGC_COLORS.douradoSoft,
  txt: PSGC_COLORS.espresso,
  txtMedio: PSGC_COLORS.espressoLight,
  txtClaro: PSGC_COLORS.espressoLight,
  border: PSGC_COLORS.offWhiteDarker,
  atrasado: PSGC_COLORS.alta,
  urgente: PSGC_COLORS.media,
  hoje: PSGC_COLORS.douradoAlerta,
  ok: PSGC_COLORS.baixa,
}

interface EmpresaStats {
  company_id: string
  empresa: string
  total_pendente: number
  atrasados: number
  urgentes: number
  hoje: number
  sem_operador: number
  concluidos_hoje: number
}

interface OperadorStats {
  user_id: string
  email: string
  empresas_atribuidas: number
  pendentes: number
  atrasados: number
  concluidos_hoje: number
}

export default function BPOSupervisorPage() {
  const [empresas, setEmpresas] = useState<EmpresaStats[]>([])
  const [operadores, setOperadores] = useState<OperadorStats[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [empData, opData] = await Promise.all([
        supabase.rpc('fn_supervisor_dashboard'),
        supabase.rpc('fn_operadores_stats'),
      ])
      if (empData.data) setEmpresas(empData.data as EmpresaStats[])
      if (opData.data) setOperadores(opData.data as OperadorStats[])
      setLoading(false)
    }
    load()
  }, [])

  const totals = empresas.reduce(
    (acc, e) => ({
      total: acc.total + e.total_pendente,
      atrasados: acc.atrasados + e.atrasados,
      urgentes: acc.urgentes + e.urgentes,
      hoje: acc.hoje + e.hoje,
      sem_op: acc.sem_op + e.sem_operador,
      concluidos: acc.concluidos + e.concluidos_hoje,
    }),
    { total: 0, atrasados: 0, urgentes: 0, hoje: 0, sem_op: 0, concluidos: 0 }
  )

  return (
    <div style={{ minHeight: '100vh', background: C.offwhite, padding: '32px 40px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        {/* HEADER */}
        <div style={{
          background: C.espresso,
          padding: '24px 32px',
          borderRadius: 12,
          marginBottom: 24,
        }}>
          <div style={{
            color: C.douradoClaro,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 2,
            marginBottom: 6,
            textTransform: 'uppercase',
          }}>
            CENTRAL BPO PS GESTAO
          </div>
          <h1 style={{
            color: C.douradoClaro,
            fontSize: 32,
            fontFamily: 'Georgia, serif',
            fontWeight: 700,
            margin: 0,
          }}>
            Supervisor Dashboard
          </h1>
          <div style={{
            color: C.douradoClaro,
            fontSize: 13,
            marginTop: 4,
            opacity: 0.9,
          }}>
            {empresas.length} empresas - {operadores.length} operadores
          </div>
        </div>

        {/* 6 BIG KPIs */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
          marginBottom: 24,
        }}>
          {BigKpi('Pendentes Total', totals.total, C.txt)}
          {BigKpi('Atrasados', totals.atrasados, C.atrasado)}
          {BigKpi('Urgentes', totals.urgentes, C.urgente)}
          {BigKpi('Hoje', totals.hoje, C.hoje)}
          {BigKpi('Sem Operador', totals.sem_op, C.atrasado)}
          {BigKpi('Concluidos Hoje', totals.concluidos, C.ok)}
        </div>

        {/* TABELA EMPRESAS */}
        <div style={{
          background: C.card,
          borderRadius: 12,
          padding: 24,
          marginBottom: 24,
          border: `1px solid ${C.border}`,
        }}>
          <h3 style={{
            color: C.txt,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 2,
            textTransform: 'uppercase',
            marginTop: 0,
            marginBottom: 16,
          }}>
            Visao por Empresa
          </h3>
          {loading ? (
            <div style={{ textAlign: 'center', color: C.txtClaro, padding: 40 }}>
              Carregando...
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  <th style={thStyle}>Empresa</th>
                  <th style={thStyleRight}>Total</th>
                  <th style={thStyleRight}>Atraso</th>
                  <th style={thStyleRight}>Urgente</th>
                  <th style={thStyleRight}>Hoje</th>
                  <th style={thStyleRight}>Sem op</th>
                  <th style={thStyleRight}>Concluidos</th>
                </tr>
              </thead>
              <tbody>
                {empresas.map((e) => (
                  <tr key={e.company_id} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={tdStyle}>{e.empresa}</td>
                    <td style={tdStyleRight}>{e.total_pendente}</td>
                    <td style={{ ...tdStyleRight, color: e.atrasados > 0 ? C.atrasado : C.txtClaro, fontWeight: e.atrasados > 0 ? 700 : 400 }}>
                      {e.atrasados > 0 ? e.atrasados : '-'}
                    </td>
                    <td style={{ ...tdStyleRight, color: e.urgentes > 0 ? C.urgente : C.txtClaro, fontWeight: e.urgentes > 0 ? 700 : 400 }}>
                      {e.urgentes > 0 ? e.urgentes : '-'}
                    </td>
                    <td style={{ ...tdStyleRight, color: e.hoje > 0 ? PSGC_COLORS.douradoDark : C.txtClaro, fontWeight: e.hoje > 0 ? 700 : 400 }}>
                      {e.hoje > 0 ? e.hoje : '-'}
                    </td>
                    <td style={{ ...tdStyleRight, color: e.sem_operador > 0 ? C.atrasado : C.txtClaro, fontWeight: e.sem_operador > 0 ? 700 : 400 }}>
                      {e.sem_operador > 0 ? e.sem_operador : '-'}
                    </td>
                    <td style={{ ...tdStyleRight, color: e.concluidos_hoje > 0 ? C.ok : C.txtClaro, fontWeight: e.concluidos_hoje > 0 ? 700 : 400 }}>
                      {e.concluidos_hoje}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* CARDS OPERADORES */}
        {operadores.length > 0 && (
          <div>
            <h3 style={{
              color: C.txt,
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: 2,
              textTransform: 'uppercase',
              marginBottom: 16,
            }}>
              Carga por Operador
            </h3>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 12,
            }}>
              {operadores.map((op) => (
                <div key={op.user_id} style={{
                  background: C.offwhite,
                  border: `1px solid ${C.border}`,
                  borderLeft: `4px solid ${op.atrasados > 0 ? C.atrasado : C.ok}`,
                  borderRadius: 10,
                  padding: 16,
                }}>
                  <div style={{ color: C.txt, fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
                    {op.email}
                  </div>
                  <div style={{ color: C.txtMedio, fontSize: 11, marginBottom: 12 }}>
                    {op.empresas_atribuidas} empresas atribuidas
                  </div>
                  <div style={{ display: 'flex', gap: 16 }}>
                    {SmallStat('Pendentes', op.pendentes, C.txt)}
                    {SmallStat('Atrasados', op.atrasados, op.atrasados > 0 ? C.atrasado : C.txtClaro)}
                    {SmallStat('Concluidos', op.concluidos_hoje, C.ok)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )

  function BigKpi(label: string, valor: number, cor: string) {
    return (
      <div key={label} style={{
        background: C.offwhite,
        border: `1px solid ${C.border}`,
        borderLeft: `4px solid ${cor}`,
        borderRadius: 10,
        padding: '14px 16px',
      }}>
        <div style={{
          color: C.txtMedio,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.8,
          textTransform: 'uppercase',
          marginBottom: 6,
        }}>
          {label}
        </div>
        <div style={{
          color: cor,
          fontSize: 32,
          fontFamily: 'Georgia, serif',
          fontWeight: 700,
          letterSpacing: -1,
          lineHeight: 1,
        }}>
          {valor}
        </div>
      </div>
    )
  }

  function SmallStat(label: string, val: number, cor: string) {
    return (
      <div key={label} style={{ flex: 1 }}>
        <div style={{
          color: C.txtMedio,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: 0.8,
          textTransform: 'uppercase',
          marginBottom: 2,
        }}>
          {label}
        </div>
        <div style={{
          color: cor,
          fontSize: 18,
          fontFamily: 'Georgia, serif',
          fontWeight: 700,
        }}>
          {val}
        </div>
      </div>
    )
  }
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  fontSize: 10,
  fontWeight: 700,
  color: PSGC_COLORS.espressoLight,
  letterSpacing: 0.8,
  textTransform: 'uppercase',
  padding: '12px 8px',
}

const thStyleRight: React.CSSProperties = {
  ...thStyle,
  textAlign: 'right',
}

const tdStyle: React.CSSProperties = {
  fontSize: 13,
  color: PSGC_COLORS.espresso,
  padding: '12px 8px',
}

const tdStyleRight: React.CSSProperties = {
  ...tdStyle,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
}
