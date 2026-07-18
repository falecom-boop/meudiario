# Relatório de trabalho - 25/06/2026

## Contexto
- Projeto: `C:\Projeto\CHECKOUT TURMAS`.
- App: Diário de Classe local/offline em React, Vite e Capacitor.
- Objetivo do ciclo: melhorar segurança dos dados, sincronização, relatórios e fluxo pedagógico de avaliações, segunda chamada e recuperação.

## Principais entregas do dia

### 1. Segurança e rastreabilidade
- Mantido o padrão de criar pontos de restauração antes de mudanças sensíveis.
- Pontos de restauração importantes do dia:
  - `restore-points\20260625-000047`
  - `restore-points\20260625-001332`
  - `restore-points\20260625-001558`
  - `restore-points\20260625-002545`
  - `restore-points\20260625-003059`
  - `restore-points\20260625-003514`
  - `restore-points\20260625-003809`
  - `restore-points\20260625-004249`
  - `restore-points\20260625-004814`
  - `restore-points\20260625-005756`
  - `restore-points\20260625-010126`
  - `restore-points\20260625-010505`
- Atualizado o arquivo de rastreio `RASTREIO-20260624.md` com o estado atual do projeto e as fases concluídas.

### 2. Configurações do professor
- Criada a área de configurações para concentrar dados do professor.
- Campos configuráveis:
  - nome;
  - disciplina;
  - quantidade de casas decimais das notas.
- Removida a dependência prática da senha fixa `doug123`.
- No primeiro acesso, o professor informa:
  - nome;
  - disciplina;
  - casas decimais;
  - senha própria.

### 3. Identidade visual
- Adicionada a logo da escola nas telas principais.
- Relatórios passaram a identificar melhor:
  - escola/logo;
  - professor;
  - disciplina.

### 4. Organização do topo do app
- O cabeçalho foi reorganizado para reduzir confusão visual.
- Ações principais ficaram agrupadas:
  - `Relatórios`;
  - `Importar`;
  - `Sincronizar`;
  - `Configurações`.
- A área de sincronização passou a reunir:
  - baixar arquivo de sincronização;
  - sincronizar arquivo;
  - restaurar backup.

### 5. Sincronização e proteção contra perda de dados
- Criada estrutura de arquivo de sincronização local/offline.
- O arquivo exportado preserva até 4 versões/snapshots recentes.
- Ao importar um arquivo de sincronização, o app agora abre uma tela de revisão antes de aplicar.
- A tela permite escolher qual versão do arquivo será usada.
- Antes de sincronizar ou restaurar, o app guarda uma cópia de segurança local.
- Fase C concluída:
  - no modo `Sincronizar`, a tela mostra o impacto esperado antes de aplicar:
    - turmas novas;
    - alunos novos;
    - aulas novas;
    - avaliações novas;
    - recuperações novas;
    - presenças preenchidas;
    - notas preenchidas;
    - conflitos de nota.
  - conflitos exibem:
    - turma;
    - aluno;
    - avaliação;
    - valor local;
    - valor vindo do arquivo.
  - no modo `Restaurar`, a tela compara os dados atuais deste aparelho com a versão escolhida.

### 6. Relatórios
- Melhorada a área de relatórios com tela própria.
- Mantidos presets de relatório:
  - relatório completo;
  - todas as notas;
  - notas finais e faltas;
  - frequência;
  - pendências;
  - segunda chamada;
  - recuperação.
- O relatório completo passou a expor melhor as informações necessárias para conselho de classe:
  - média/nota final;
  - situação;
  - faltas;
  - pendências;
  - notas de todas as avaliações.
- Ajustada a semântica das pendências nos relatórios:
  - avaliação formal pendente aparece como `Faltou`;
  - avaliação não formal pendente aparece como `Não entregou`;
  - segunda chamada e recuperação mantêm `Não fez`.

### 7. Avaliações, segunda chamada e recuperação
- Consolidado o fluxo de tipo de lançamento antes do formulário.
- Tipos previstos:
  - avaliação formal;
  - avaliação não formal;
  - segunda chamada;
  - recuperação.
- Avaliação formal:
  - representa teste/prova;
  - permite segunda chamada;
  - pendência aparece como `Faltou`.
- Avaliação não formal:
  - representa trabalho, dinâmica, lista etc.;
  - não permite segunda chamada;
  - pendência aparece como `Não entregou`.
- Segunda chamada:
  - fica vinculada à avaliação formal original;
  - preserva a nota original;
  - usa `makeupGrades`;
  - botão `Não fez` lança zero como nota válida.
- Recuperação:
  - é trimestral;
  - fórmula aplicada:
    - `(média trimestral + nota recuperação) / 2`;
    - se o resultado for maior que a média, fica o resultado;
    - se for menor, permanece a média original.
  - botão `Não fez` lança zero como nota válida.
- Recuperação do 2º trimestre foi tratada para ficar bloqueada até o momento adequado do calendário.

### 8. Lista de alunos e experiência de uso
- Adicionada possibilidade de organizar turmas por arrastar e soltar, pensando também no uso em Android.
- Cards de alunos foram ajustados:
  - foto maior;
  - texto deslocado para melhor leitura;
  - informações de faltas, notas lançadas e pendências.
- Criada possibilidade de zoom/visualização melhor das fotos no APK.
- Ajustada linguagem visível para português com acentos onde o usuário vê.

## Validações feitas
- Builds web executados durante as fases principais com `npm run build`.
- Última validação da fase C passou com sucesso.

## Pontos de atenção para próximos ciclos
- Revisar com dados reais a sincronização em múltiplos aparelhos antes de uso definitivo.
- Testar manualmente:
  - sincronizar PC -> celular;
  - sincronizar celular -> PC;
  - restaurar versão anterior;
  - conflito de nota entre dois aparelhos.
- Confirmar visual do relatório completo em conselho de classe.
- Continuar refinando a tela de relatórios conforme o uso real do professor.
- Revisar regra de recuperação quando não houver avaliações no trimestre, para evitar habilitação indevida.

