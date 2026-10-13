// 404 global em PT-BR com a identidade PS Gestão. Substitui a página padrão do Next (inglês, sem marca).
// Aditivo: só melhora o caso de rota inexistente. Botão "Voltar ao início" → /dashboard.
import Link from 'next/link'
import type { CSSProperties } from 'react'

export default function NotFound() {
  return (
    <div style={wrap}>
      <div style={card}>
        <div style={selo}>PS GESTÃO</div>
        <div style={code404}>404</div>
        <h1 style={titulo}>Página não encontrada</h1>
        <p style={texto}>
          O endereço que você tentou abrir não existe ou foi movido. Nada de errado com o seu acesso —
          é só esta rota que não está disponível.
        </p>
        <Link href="/dashboard" style={botao}>Voltar ao início</Link>
      </div>
    </div>
  )
}

const wrap: CSSProperties = {
  minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: '#FAF7F2', color: '#3D2314', padding: 24,
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
}
const card: CSSProperties = {
  background: '#fff', border: '1px solid #E7DECF', borderRadius: 18, padding: '36px 28px',
  maxWidth: 440, width: '100%', textAlign: 'center', boxShadow: '0 10px 30px rgba(61,35,20,0.06)',
}
const selo: CSSProperties = {
  fontSize: 12, letterSpacing: 3, fontWeight: 800, color: '#C8941A', marginBottom: 8,
}
const code404: CSSProperties = {
  fontSize: 72, fontWeight: 800, lineHeight: 1, color: '#3D2314', letterSpacing: -2,
}
const titulo: CSSProperties = { fontSize: 22, fontWeight: 700, margin: '10px 0 8px' }
const texto: CSSProperties = { fontSize: 14, lineHeight: 1.5, color: 'rgba(61,35,20,0.65)', margin: '0 0 22px' }
const botao: CSSProperties = {
  display: 'inline-block', background: '#C8941A', color: '#3D2314', textDecoration: 'none',
  fontWeight: 700, fontSize: 15, padding: '12px 22px', borderRadius: 10,
}
