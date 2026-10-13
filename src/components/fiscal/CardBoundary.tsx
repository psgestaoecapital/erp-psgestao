'use client'

// HOTFIX Configuração Fiscal (contexto 0829eca5): boundary POR CARD. Se um card quebrar no render
// (ex.: TypeError ao ler dado de RPC que veio {ok:false} sem o array esperado), cai SÓ este card —
// com uma mensagem em linguagem do usuário — e o resto da página continua de pé. Nunca a tela preta.
import { Component, type ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'

interface Props { children: ReactNode; nome?: string }
interface State { erro: boolean }

export default class CardBoundary extends Component<Props, State> {
  state: State = { erro: false }

  static getDerivedStateFromError(): State {
    return { erro: true }
  }

  componentDidCatch(error: unknown) {
    // Só telemetria no console — sem stack na tela do usuário.
    console.error('[CardBoundary] card quebrou no render:', this.props.nome ?? '', error)
  }

  render() {
    if (this.state.erro) {
      return (
        <div className="bg-white border border-[#3D2314]/10 rounded-xl px-4 py-3 flex items-start gap-3">
          <AlertCircle className="text-[#BA7517] flex-shrink-0 mt-0.5" size={16} />
          <div className="text-[12.5px] text-[#3D2314]/80">
            Não conseguimos carregar esta parte. As outras seções continuam funcionando — recarregue a
            página para tentar de novo.
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
