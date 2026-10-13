// Gate (lista de Orçamentos): carrega os 100 mais recentes com desempate pela criação. Só por data, com mais de 100
// orçamentos no mesmo dia (a demonstração chegou a 133 em 01/10), o orçamento recém-criado podia não aparecer. Sem rede.
import { readFileSync } from 'node:fs'

const tela = readFileSync('src/app/dashboard/orcamentos/page.tsx', 'utf8')
const ok = /from\("erp_orcamentos"\)\.select\("\*"\)\.in\("company_id",companyIds\)\.order\("data_emissao",\{ascending:false\}\)\.order\("created_at",\{ascending:false\}\)\.limit\(100\)/.test(tela)
if (!ok) {
  console.error('✗ lista de Orçamentos: ordenar por data_emissao e created_at (mais novo primeiro) antes do limite de 100')
  process.exit(1)
}
console.log('✓ lista de Orçamentos: mais novo primeiro (data e criação) antes do limite de 100')
