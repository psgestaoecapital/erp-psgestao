// Gate PS EHS E0: rótulo do menu, rota/id intactos e dicionário pt/en/es completo.
import { DASHBOARD_MENU_GROUPS } from '../../src/lib/menu/dashboard-menu-config'
import { ehsChaves, tEhs, EHS_IDIOMAS } from '../../src/components/ps-ehs/i18n'

const g = DASHBOARD_MENU_GROUPS.find((x) => x.id === 'compliance')
const erros: string[] = []
if (!g) erros.push('grupo id=compliance sumiu (a chave do módulo não pode mudar)')
else {
  if (g.label !== 'PS EHS') erros.push('rótulo do menu deve ser "PS EHS"')
  if (g.subtitle !== 'Saúde, Segurança e Meio Ambiente') erros.push('subtítulo ausente')
  if (g.items.length < 7) erros.push('itens do menu foram removidos')
  if (!g.items.some((i) => i.href === '/dashboard/compliance')) erros.push('rota /dashboard/compliance mudou')
}
for (const c of ehsChaves()) for (const l of EHS_IDIOMAS) if (!tEhs(c, l).trim()) erros.push(`tradução vazia: ${c}/${l}`)
if (erros.length) { console.error('check-ps-ehs-e0 FALHOU:\n' + erros.join('\n')); process.exit(1) }
console.log('check-ps-ehs-e0 ok')
