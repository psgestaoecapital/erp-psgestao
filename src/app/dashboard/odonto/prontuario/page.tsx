import OdontoEmptyState from '@/components/odonto/OdontoEmptyState';
import { ClipboardList } from 'lucide-react';

export default function Page() {
  return (
    <OdontoEmptyState
      eyebrow="Clínica Odontológica · Processo"
      title="Prontuário + Odontograma"
      subtitle="Ficha clínica completa, com odontograma interativo."
      Icon={ClipboardList}
      cta="Abrir prontuário"
      features={[
        { title: 'Odontograma interativo', desc: 'Marque condição e procedimento dente a dente.' },
        { title: 'Histórico imutável', desc: 'Evolução clínica com trilha conforme exigência do CFO.' },
        { title: 'Registro por voz (IA)', desc: 'Dite o procedimento; a IA preenche e você só confirma.' },
        { title: 'Imagens e anexos', desc: 'Radiografias e fotos do antes/durante/depois no mesmo lugar.' },
      ]}
    />
  );
}
