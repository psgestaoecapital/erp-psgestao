// Como instalar o PS Gestão no celular (CEO 12/11). Página pública (fora do /dashboard):
// quem vai instalar ainda pode nem estar logado. Instruções próprias (RD-96), sem copiar ninguém.
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Instalar o PS Gestão no celular',
  description: 'Passo a passo para instalar o app do PS Gestão no Android e no iPhone.',
}

const C = { esp: '#3D2314', off: '#FAF7F2', gold: '#C8941A', bd: '#E7DED3', m: '#6B5D4F' }

function Passos({ titulo, passos }: { titulo: string; passos: string[] }) {
  return (
    <section style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 12, padding: 16 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 10px', color: C.esp }}>{titulo}</h2>
      <ol style={{ margin: 0, paddingLeft: 20, fontSize: 15, lineHeight: 1.6, color: C.m }}>
        {passos.map((p, i) => <li key={i} style={{ marginBottom: 4 }}>{p}</li>)}
      </ol>
    </section>
  )
}

export default function InstalarApp() {
  return (
    <main style={{ minHeight: '100vh', background: C.off, color: C.esp, padding: '24px 16px 60px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', display: 'grid', gap: 16 }}>
        <header>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 6px' }}>Instalar o PS Gestão no celular</h1>
          <p style={{ fontSize: 15, lineHeight: 1.5, color: C.m, margin: 0 }}>
            Instalado, o PS Gestão abre direto no seu painel — o vendedor vê as próprias vendas, sem precisar procurar no navegador.
            Leva menos de um minuto e não ocupa espaço como um app comum.
          </p>
        </header>

        <Passos titulo="Android (Chrome)" passos={[
          'Abra o PS Gestão no Chrome e faça login.',
          'Toque no menu ⋮ (três pontos) no canto superior direito.',
          'Escolha "Instalar app" (ou "Adicionar à tela inicial").',
          'Confirme. O ícone do PS Gestão aparece na sua tela inicial.',
        ]} />

        <Passos titulo="iPhone (Safari)" passos={[
          'Abra o PS Gestão no Safari e faça login.',
          'Toque no botão Compartilhar (o quadrado com a seta para cima).',
          'Role e escolha "Adicionar à Tela de Início".',
          'Toque em "Adicionar". O ícone do PS Gestão aparece na tela inicial.',
        ]} />

        <p style={{ fontSize: 14, color: C.m, margin: 0 }}>
          Ainda não consegue ver suas vendas depois de entrar? Peça a um administrador para ligar o seu usuário ao seu código de vendedor
          em <b>Administração › Vendedores</b>.
        </p>

        <a href="/app" style={{ display: 'inline-block', alignSelf: 'start', background: C.gold, color: '#fff', fontWeight: 700, fontSize: 15, padding: '10px 18px', borderRadius: 10, textDecoration: 'none' }}>
          Abrir o PS Gestão
        </a>
      </div>
    </main>
  )
}
