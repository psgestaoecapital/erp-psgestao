'use client'
// Painel de Codes (CEO 16/10): proteção de erro POR BLOCO. Um bloco com dado ruim mostra "não foi possível carregar este
// bloco" e o resto da página continua abrindo — nenhum bloco derruba a tela inteira.
import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode; nome: string }
type State = { erro: boolean }

export default class BlocoSeguro extends Component<Props, State> {
  state: State = { erro: false }

  static getDerivedStateFromError(): State {
    return { erro: true }
  }

  componentDidCatch(error: unknown) {
    console.error('[BlocoSeguro] bloco quebrou no render:', this.props.nome, error)
  }

  render() {
    if (this.state.erro) {
      return (
        <div role="alert" data-testid={`bloco-erro-${this.props.nome}`}
          style={{ background: '#FFFFFF', border: '1px solid #E7DED3', borderRadius: 10, padding: 10, fontSize: 12, color: '#6B5D4F', marginBottom: 10 }}>
          Não foi possível carregar este bloco ({this.props.nome}). O resto da página continua funcionando.
        </div>
      )
    }
    return this.props.children
  }
}
