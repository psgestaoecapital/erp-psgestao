import Link from 'next/link'

// Blindagem: 404 amigável no dashboard. Evita a tela crua "This page could not be found",
// que faz o usuário achar que a funcionalidade não existe (na maioria das vezes é rota
// movida, cache velho, ou permissão). Mensagem clara + caminho de volta.
export default function DashboardNotFound() {
  return (
    <div style={{ maxWidth: 560, margin: '48px auto', padding: '28px 22px', textAlign: 'center', color: '#3D2314' }}>
      <div style={{ fontSize: 40, marginBottom: 8 }}>🧭</div>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Página não encontrada</h1>
      <p style={{ fontSize: 14, color: '#6B5D4F', lineHeight: 1.5, marginBottom: 6 }}>
        Esta tela não existe, foi movida, ou você ainda não tem acesso a ela.
      </p>
      <p style={{ fontSize: 13, color: '#9C8E80', lineHeight: 1.5, marginBottom: 20 }}>
        Se você chegou aqui por um link do próprio sistema, tente atualizar a página (Ctrl/Cmd + Shift + R).
        Se persistir, fale com o administrador da sua empresa ou com a PS Gestão.
      </p>
      <Link
        href="/dashboard"
        style={{ display: 'inline-block', background: '#C8941A', color: '#fff', borderRadius: 10, padding: '10px 20px', fontWeight: 700, textDecoration: 'none' }}
      >
        Voltar ao início
      </Link>
    </div>
  )
}
