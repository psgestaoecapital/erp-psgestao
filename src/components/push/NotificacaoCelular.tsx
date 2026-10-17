'use client'

// Liga/desliga o aviso no celular (Web Push, custo zero · chamado #120). Android: direto. iPhone/iPad (16.4+): só com o app
// na tela de início — o cartão orienta o passo a passo. O texto do "?" vem de erp_ajuda_campo.
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { desligar, estadoAtual, ligar, type EstadoPush } from '@/lib/push/cliente'

const MSG: Record<EstadoPush, string> = {
  sem_suporte: 'Este aparelho ou navegador não recebe avisos no celular. Use o Chrome (Android) ou o app instalado (iPhone).',
  ios_instalar: 'No iPhone/iPad, primeiro adicione o PS Gestão à tela de início: toque em Compartilhar (quadrado com seta) → "Adicionar à Tela de Início" → abra o app pelo ícone e volte aqui para ligar.',
  sem_chave: 'O envio de avisos ao celular ainda está sendo preparado. Volte em breve.',
  negado: 'As notificações estão bloqueadas neste aparelho. Libere em Ajustes/Configurações do navegador ou do app e volte aqui.',
  desligado: 'Receba na central de notificações do celular, com o app fechado, quando uma oportunidade mudar de etapa.',
  ligado: 'Ligado neste aparelho. Você recebe um aviso quando uma oportunidade sua mudar de etapa.',
}

export default function NotificacaoCelular() {
  const { sel } = useCompanyIds()
  const empresa = sel && !sel.startsWith('group_') && sel !== 'consolidado' ? sel : null
  const [estado, setEstado] = useState<EstadoPush | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => { void estadoAtual().then(setEstado).catch(() => setEstado('sem_suporte')) }, [])

  async function alternar() {
    if (!estado || ocupado) return
    setOcupado(true); setErro('')
    try {
      const { data } = await supabase.auth.getUser()
      const uid = data.user?.id
      if (!uid) throw new Error('Entre novamente no sistema.')
      if (estado === 'ligado') setEstado(await desligar(uid))
      else {
        if (!empresa) throw new Error('Escolha uma empresa no topo da tela.')
        setEstado(await ligar(uid, empresa))
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir. Tente de novo.')
    } finally { setOcupado(false) }
  }

  const podeAlternar = estado === 'ligado' || estado === 'desligado'
  return (
    <section style={{ maxWidth: 560, margin: '0 auto', padding: 16 }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Avisos no celular</h1>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <strong>Aviso de mudança de etapa</strong>
        <AjudaCampo chave="config.notificacao_celular.etapa" rota="/dashboard/configuracoes/notificacoes-celular" />
      </div>
      <p style={{ lineHeight: 1.5, marginBottom: 16 }}>{estado ? MSG[estado] : 'Verificando este aparelho…'}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" onClick={alternar} disabled={!podeAlternar || ocupado}
          style={{ minHeight: 48, padding: '0 20px', borderRadius: 12, border: 'none', fontWeight: 700, fontSize: 16, cursor: podeAlternar ? 'pointer' : 'not-allowed', background: estado === 'ligado' ? '#6B5B4B' : '#C8941A', color: '#fff', opacity: podeAlternar ? 1 : 0.5 }}>
          {ocupado ? 'Aguarde…' : estado === 'ligado' ? 'Desligar neste aparelho' : 'Ligar neste aparelho'}
        </button>
        <AjudaCampo chave="config.notificacao_celular.botao" rota="/dashboard/configuracoes/notificacoes-celular" />
      </div>
      {erro && <p role="alert" style={{ color: '#B3261E', marginTop: 12 }}>{erro}</p>}
    </section>
  )
}
