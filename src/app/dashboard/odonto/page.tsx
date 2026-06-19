import EmDesenvolvimento from '@/components/shared/EmDesenvolvimento'

export default function OdontoHome() {
  return (
    <EmDesenvolvimento
      icone="🦷"
      vertical="odonto"
      titulo="Clínica Odontológica"
      descricao="Agenda, prontuário/odontograma, plano de tratamento, TISS e materiais. Financeiro já integrado."
      resumo={
        <ul className="text-left space-y-1 list-disc list-inside">
          <li>Agenda de pacientes</li>
          <li>Prontuário + odontograma</li>
          <li>Plano de tratamento / orçamento</li>
          <li>Convênios / TISS</li>
          <li>Materiais e próteses</li>
        </ul>
      }
    />
  )
}
