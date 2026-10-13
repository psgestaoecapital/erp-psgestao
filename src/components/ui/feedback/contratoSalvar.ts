import type React from 'react'
import { PSGC_COLORS, PSGC_KPI_VARIANTS } from '@/lib/psgc-tokens'

// ═══════════════════════════════════════════════════════════════════════════
// RASCUNHO (RD-26) · Contrato único de "erro de salvamento" — NÃO ligado a
// nenhuma tela ainda. Base pro Eng Chefe escrever o SPEC do piloto (Nova
// Despesa / Nova Receita) em cima de código real. RD-52: fonte única.
// ═══════════════════════════════════════════════════════════════════════════

// Contrato que TODA RPC de salvamento deve devolver. `erro` é código curto da
// regra (nunca texto técnico); `campo` habilita o destaque vermelho no input;
// `orientacao`, quando vier, é o texto pronto da casa e tem prioridade.
export type ResultadoSalvar = {
  sucesso?: boolean
  sem_plano?: boolean      // RPCs de gestão devolvem isso quando falta o plano ativo
  erro?: string            // 'sem_acesso' | 'parcela_incompleta' | 'bloqueado_boleto_ativo' ...
  campo?: string           // nome do input a destacar (ex.: 'valor', 'data_vencimento')
  orientacao?: string      // texto pronto; se vier, é o que aparece
  mensagem?: string        // (saída do useSalvar) texto de sucesso pronto p/ o toast
}

export type AcaoSalvar = 'criar' | 'alterar' | 'excluir'

// Verbo da casa (sucesso). CRIOU / ALTEROU / EXCLUIU.
export const VERBO_SUCESSO: Record<AcaoSalvar, string> = {
  criar: 'CRIOU',
  alterar: 'ALTEROU',
  excluir: 'EXCLUIU',
}

// Dicionário código→mensagem amigável. NUNCA erro técnico cru.
// Chaves = os `erro` que as RPCs desta base já retornam hoje. O Eng Chefe
// completa/edita no SPEC; a regra é: toda RPC nova cadastra seu código aqui.
export const MENSAGEM_ERRO: Record<string, string> = {
  sem_acesso: 'Você não tem permissão para isso nesta empresa.',
  sem_plano: 'Esta empresa ainda não tem o plano ativo para essa ação.',
  nao_encontrado: 'Registro não encontrado — pode já ter sido removido.',
  sem_parcelas: 'Faltou informar ao menos uma parcela.',
  parcela_incompleta: 'Faltou preencher a data ou o valor de uma parcela.',
  bloqueado_conciliado_ou_pago: 'Não dá para excluir: título pago ou já conciliado. Desvincule antes.',
  bloqueado_conciliado: 'Este lançamento está conciliado com o banco. Cancele a conciliação no inbox antes de excluir.',
  requer_cancelar_baixa: 'Este lançamento está baixado (pago), mas não conciliado. Confirme cancelar a baixa e excluir.',
  bloqueado_boleto_ativo: 'Este título tem boleto ativo no banco. Cancele o boleto antes de excluir.',
  ja_conciliado: 'Movimento já conciliado. Desvincule antes de ignorar.',
  nao_ignorado: 'Este item não está ignorado.',
  sem_ids: 'Selecione ao menos um item.',
  // Revenda de veículos — guardas dos formulários (custo/reserva/venda/foto)
  veiculo_nao_encontrado: 'Veículo não encontrado — pode já ter sido removido.',
  valor_invalido: 'Informe um valor maior que zero.',
  categoria_obrigatoria: 'Escolha a categoria do custo.',
  descricao_obrigatoria: 'Descreva o custo (ex.: "troca de pneus").',
  vencimento_obrigatorio_para_titulo: 'Para gerar o título, informe o vencimento.',
  cliente_obrigatorio: 'Informe o nome do cliente.',
  sinal_invalido_para_titulo: 'Para lançar o sinal em contas a receber, informe um valor maior que zero.',
  valor_venda_invalido: 'Informe o valor da venda (maior que zero).',
  ja_reservado: 'Este veículo já tem uma reserva ativa.',
  troca_chassi_ja_cadastrado: 'O veículo da troca já está no pátio (chassi já cadastrado).',
  veiculo_ja_vendido: 'Este veículo já foi vendido.',
  veiculo_indisponivel: 'Este veículo não está disponível para venda.',
  storage_path_obrigatorio: 'Falha ao anexar a foto. Tente enviar de novo.',
}

// "Faltou preencher X" — validação de campo no cliente, ANTES de chamar a RPC.
export const faltouPreencher = (rotuloCampo: string) => `Faltou preencher ${rotuloCampo}.`

// Traduz o resultado (ou um erro de transporte) para a mensagem da casa.
// Prioridade: orientacao > dicionário > fallback amigável. Nunca vaza o
// error.message cru do Postgres/PostgREST para o usuário.
export function mensagemDeResultado(r: ResultadoSalvar | null | undefined): string {
  if (!r) return 'Não foi possível salvar agora. Tente de novo em instantes.'
  if (r.orientacao) return r.orientacao
  if (r.sem_plano) return MENSAGEM_ERRO.sem_plano
  if (r.erro && MENSAGEM_ERRO[r.erro]) return MENSAGEM_ERRO[r.erro]
  return 'Não foi possível salvar. Revise os campos e tente de novo.'
}

// Paleta do feedback — 100% ancorada em psgc-tokens (zero literal de cor aqui).
// Erro reusa o variant `critical` (mesmo vermelho de `critico` já usado na casa);
// sucesso usa Espresso estrutural (não verde — verde/vermelho de semáforo são
// exclusivos de performance; ver README, decisão pro Eng Chefe).
export const CORES_FEEDBACK = {
  erroFundo: PSGC_COLORS.vermelhoSoft,
  erroTexto: PSGC_KPI_VARIANTS.critical.text,    // = PSGC_COLORS.alta
  erroBorda: PSGC_KPI_VARIANTS.critical.text,
  bordaNeutra: PSGC_COLORS.offWhiteDarker,
  sucessoFundo: PSGC_COLORS.espresso,
  sucessoTexto: PSGC_COLORS.offWhite,
} as const

// Borda do input conforme o estado de erro do campo (spread no style do <input>).
// Ex.: <input style={{ ...inputBase, ...estiloBordaInput(erroCampo === 'valor' ? '...' : null) }} />
export const estiloBordaInput = (erro?: string | null): React.CSSProperties => ({
  border: `1px solid ${erro ? CORES_FEEDBACK.erroTexto : CORES_FEEDBACK.bordaNeutra}`,
})
