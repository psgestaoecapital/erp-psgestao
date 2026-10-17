'use client'
// #3281 etapa 4 — botão "Gerar em segundo plano" nas telas pesadas (Contas a pagar/receber e Extrato). Pede o relatório
// do período que está na tela pela mesma RPC da tela Meus relatórios (fn_relatorio_pedir: guarda por empresa, limite de
// 5 pedidos abertos e de 36 meses), acorda o gerador e mostra o atalho para baixar quando ficar pronto. Pode fechar a tela.
// Período longo (mais de 3 meses) ganha o destaque: é aí que gerar na hora faz esperar.
import { useState } from 'react'
import Link from 'next/link'
import { Hourglass } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { mesesNoPeriodo } from '@/lib/relatorios/periodo'

export type TipoSegundoPlano = 'financeiro_movimentacao' | 'financeiro_pagar' | 'financeiro_receber'

const ERROS: Record<string, string> = {
  sem_acesso: 'Você não tem acesso a esta empresa.',
  periodo_invalido: 'Confira o período: a data final precisa ser depois da inicial.',
  periodo_maior_que_36_meses: 'O período pode ter no máximo 36 meses.',
  limite_pedidos_abertos: 'Você já tem 5 relatórios na fila. Espere algum ficar pronto.',
}

export default function GerarSegundoPlanoButton({ companyId, tipo, dataInicio, dataFim, chaveAjuda }: {
  companyId: string
  tipo: TipoSegundoPlano
  dataInicio: string
  dataFim: string
  chaveAjuda: string
}) {
  const [enviando, setEnviando] = useState(false)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const longo = mesesNoPeriodo(dataInicio, dataFim) > 3

  async function pedir() {
    setEnviando(true); setAviso(null)
    const { data, error } = await supabase.rpc('fn_relatorio_pedir', {
      p_company_id: companyId, p_tipo: tipo, p_parametros: { data_inicio: dataInicio, data_fim: dataFim }, p_formato: 'excel',
    })
    const r = data as { ok: boolean; erro?: string; titulo?: string } | null
    if (error || !r?.ok) {
      setAviso({ ok: false, texto: ERROS[r?.erro ?? ''] ?? 'Não foi possível fazer o pedido.' })
    } else {
      setAviso({ ok: true, texto: `Pedido feito: ${r.titulo}. Pode fechar a tela — você recebe o aviso quando ficar pronto.` })
      void acordarGerador()
    }
    setEnviando(false)
  }

  // começa a gerar na hora (sem esperar o pg_cron); falha aqui não perde o pedido
  async function acordarGerador() {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return
      await fetch('/api/relatorios/fila', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` }, keepalive: true })
    } catch { /* o pg_cron pega o pedido na próxima volta */ }
  }

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <button
        type="button"
        data-testid="gerar-segundo-plano"
        onClick={() => void pedir()}
        disabled={enviando}
        title="Gera o Excel do período da tela sem prender você aqui. Baixe em Financeiro > Meus relatórios."
        style={{
          background: longo ? '#3D2314' : 'transparent', color: longo ? '#FAF7F2' : '#3D2314',
          border: '1px solid #3D2314', padding: '7px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700,
          cursor: enviando ? 'wait' : 'pointer', whiteSpace: 'nowrap', opacity: enviando ? 0.6 : 1,
        }}>
        <Hourglass size={14} strokeWidth={1.5} aria-hidden style={{ verticalAlign: '-2px', marginRight: 6 }} />
        {enviando ? 'Pedindo…' : 'Gerar em segundo plano'}
      </button>
      <AjudaCampo chave={chaveAjuda} />
      {aviso && (
        <div role="status" data-testid="gerar-segundo-plano-aviso"
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 20, width: 'min(320px, calc(100vw - 32px))',
            background: aviso.ok ? '#EAF3DE' : '#FCEBEB', color: aviso.ok ? '#3B6D11' : '#A32D2D',
            border: `1px solid ${aviso.ok ? '#B9D79A' : '#F0B8B8'}`, borderRadius: 8, padding: '10px 12px', fontSize: 12, lineHeight: 1.4,
            boxShadow: '0 4px 14px rgba(61,35,20,0.12)',
          }}>
          {aviso.texto}
          {aviso.ok && (
            <div style={{ marginTop: 6 }}>
              <Link href="/dashboard/financeiro/meus-relatorios" style={{ color: '#3D2314', fontWeight: 700 }}>Abrir Meus relatórios →</Link>
            </div>
          )}
          <button type="button" onClick={() => setAviso(null)} aria-label="Fechar aviso"
            style={{ position: 'absolute', top: 4, right: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 14 }}>×</button>
        </div>
      )}
    </div>
  )
}
