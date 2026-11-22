// Gate (#9991 fatia 3 · jordana-code): quando a lista de A pagar / A receber abre JÁ FILTRADA por um
// aviso/botão "Resolver" (deep-link: ?status=vencido|hoje|avencer, ?semcategoria=1, ?busca=<OS>), a tela
// (ListagemPagarReceberView) mostra no topo um aviso "Filtrando por <X>" com o botão "Mostrar todos", que
// volta a lista à visão completa e limpa os parâmetros da URL (chamado #9991 item 2 — o usuário entende de
// onde veio o recorte e consegue voltar). Contrato estático: o estado, os rótulos e o reset têm de existir.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const TELA = 'src/components/financeiro/ListagemPagarReceberView.tsx'
const tela = readFileSync(TELA, 'utf8')

// estado do aviso de deep-link
ok(/const \[filtroAviso, setFiltroAviso\] = useState/.test(tela), 'estado filtroAviso existe')

// o banner só aparece quando há filtro vindo de aviso, e traz "Filtrando por" + "Mostrar todos"
ok(tela.includes('{filtroAviso && ('), 'o banner é condicional ao filtroAviso')
ok(tela.includes('Filtrando por'), 'o banner mostra "Filtrando por <X>"')
ok(tela.includes('Mostrar todos'), 'o banner tem o botão "Mostrar todos"')

// cada deep-link suportado rotula o aviso (para o usuário saber o recorte)
ok(tela.includes("setFiltroAviso('Vencidos (em atraso)')"), 'rótulo para ?status=vencido')
ok(tela.includes("setFiltroAviso('Vencendo hoje')"), 'rótulo para ?status=hoje')
ok(tela.includes("setFiltroAviso('A vencer')"), 'rótulo para ?status=avencer')
ok(/setFiltroAviso\('Sem categoria/.test(tela), 'rótulo para ?semcategoria=1')
ok(/setFiltroAviso\(`Busca:/.test(tela), 'rótulo para ?busca=')

// "Mostrar todos": volta ao padrão e limpa os parâmetros da URL (não reaplica ao atualizar)
ok(/const limparFiltroAviso = \(\) => \{/.test(tela), 'reset limparFiltroAviso existe')
ok(/limparFiltroAviso[\s\S]*?setFiltroAviso\(null\)/.test(tela), 'o reset zera o filtroAviso')
ok(/limparFiltroAviso[\s\S]*?searchParams\.delete/.test(tela), 'o reset limpa os parâmetros da URL')
ok(tela.includes('onClick={limparFiltroAviso}'), 'o botão "Mostrar todos" chama limparFiltroAviso')

if (falhas) { console.error(`\n${falhas} falha(s) no contrato do aviso de filtro (#9991 fatia 3).`); process.exit(1) }
console.log('✓ #9991 fatia 3: aviso "Filtrando por … — Mostrar todos" presente e com reset de URL')
