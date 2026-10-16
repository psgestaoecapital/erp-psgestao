'use client'
// Proteção de erro POR CARTÃO da aba Codes (CEO 16/10): um bloco com dado ruim mostra o aviso e o resto da página segue aberto.
import { Component, type ReactNode } from 'react'

export class BlocoSeguro extends Component<{ nome: string; children: ReactNode }, { erro: boolean }> {
  state = { erro: false }
  static getDerivedStateFromError() { return { erro: true } }
  componentDidCatch(e: unknown) { console.error(`[codes] bloco "${this.props.nome}" falhou`, e) }
  render() {
    if (!this.state.erro) return this.props.children
    return (
      <div data-testid="bloco-indisponivel" role="status" style={{ background: '#FFFFFF', border: '1px solid #E7DED3', borderRadius: 12, padding: 12, marginBottom: 12, fontSize: 13, color: '#6B5D4F' }}>
        Não foi possível carregar este bloco ({this.props.nome}).
      </div>
    )
  }
}
