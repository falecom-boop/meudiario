# Relatório de trabalho — 05/08/2026

## Problemas relatados

1. As aulas aparecem fora de ordem no diário: umas entram primeiro, outras
   depois.
2. A lista de Registros mostra só as aulas mais recentes, sem como ver o resto.
3. O que aparece no tablet continua diferente do que aparece no computador.

## Causa encontrada

Os três problemas vêm de duas causas, e a segunda é grave.

### A lista de aulas nunca era ordenada

A ordem em que as aulas apareciam era só o histórico de como cada aparelho
montou os dados. Aula criada no próprio aparelho entrava no **começo** da
lista; aula que chegava pela sincronização entrava no **fim**. Como a lista de
Registros mostrava apenas as 8 primeiras, dois aparelhos com exatamente os
mesmos dados escondiam aulas diferentes.

Ou seja: parte do "o tablet está diferente do computador" não era dado perdido,
era a mesma informação exibida em ordens diferentes, com o corte da lista
escondendo coisas distintas em cada aparelho.

### A mesclagem descartava correções vindas do outro aparelho

Esta é a parte séria. Ao juntar o que veio da nuvem com o que já existia no
aparelho, o aplicativo só sabia **acrescentar** o que faltava. Quando a aula já
existia dos dois lados, ela era mantida exatamente como estava: conteúdo
corrigido, número de aulas e presença trocada em outro aparelho eram
descartados em silêncio. Com nota era igual — duas notas preenchidas e
diferentes terminavam **sempre** com o valor do aparelho em que você estava.

E o efeito não parava na tela. A compactação junta o estado do aparelho com o
que veio do servidor, grava o resultado e **apaga as alterações já lidas**.
Então o computador com a versão velha regravava o valor antigo por cima e
destruía a correção feita no tablet, no servidor, para todos os aparelhos.

Este risco já estava mapeado e anotado como o próximo da fila no rastreio de
02/08. Era ele.

## Correção realizada

- **Ordem única para todos os aparelhos.** As aulas passam a ter uma ordem
  definida pelos próprios dados — data mais recente primeiro, com desempate
  pela hora de criação e pelo identificador da aula. A ordenação foi colocada
  no ponto por onde passa tudo que entra no aplicativo, então vale para a tela,
  os relatórios e as exportações. Dois aparelhos com os mesmos dados agora
  listam as aulas exatamente na mesma sequência.

- **Botão "Ver todas as aulas".** A lista de Registros continua mostrando as 8
  mais recentes, mas agora diz quantas aulas existem no período e traz o botão
  para abrir todas. Aberta, a lista rola dentro do próprio painel, sem esticar
  a página. O botão volta a fechar com "Mostrar só as mais recentes".

- **Quem alterou por último vence.** A mesclagem passa a comparar a data da
  última alteração de cada aula, avaliação e recuperação. A versão mais recente
  manda no conteúdo, no número de aulas, na data, na chamada e na nota. Esse
  carimbo de data já era gravado pelo aplicativo a cada edição — só não estava
  sendo usado para nada.

- **A aba "Diário" da planilha exportada** também saía fora de ordem. Agora sai
  em ordem cronológica, do começo do período para o fim.

## Segurança dos dados

Duas proteções ficam **acima** da regra de data, de propósito:

- **Nenhum aluno some da chamada.** Aluno que existe só de um lado sempre
  entra na lista final.
- **Chamada feita nunca é apagada por "não chamada".** Se um aparelho tem
  falta lançada e o outro tem o aluno como não chamado, a falta vence,
  independentemente das datas.

Isso tem um preço que você precisa saber: **marcar um aluno de volta como "Não
chamada" num aparelho não apaga a chamada no outro.** O carimbo de data é da
aula inteira, não de cada aluno. Se a data mandasse nesse caso, bastaria
corrigir o conteúdo de uma aula num aparelho desatualizado para apagar faltas
já lançadas no outro. Preferi errar para o lado de sobrar uma chamada visível
na tela, que você refaz, do que sumir com falta em documento oficial.

Fora isso, nenhuma proteção foi removida. A mesclagem continua sem apagar
turma, aluno, aula ou nota, e a validação de estrutura continua bloqueando
arquivos inválidos.

## Validações realizadas

- `npm test`: aprovado (4 suítes — sync-safety, sync-engine, sync-e2e,
  sw-safety), com cerca de 15 casos novos.
- Verificado que os testes novos têm valor: rodados contra a lógica anterior,
  **reprovam** — a correção feita no tablet é descartada nos três campos
  (conteúdo, número de aulas e presença).
- Ordenação e botão conferidos no navegador com 12 aulas semeadas em ordem
  embaralhada de propósito: saíram de 18/08 para 03/08, o botão abre as 12, a
  lista rola dentro do painel e a página não ganha barra horizontal. Os dados
  de teste foram removidos depois.
- `npm run build`: concluído sem erros.
- `git diff --check`: nenhuma inconsistência.

O aviso do Vite sobre um pacote maior que 500 kB continua sendo apenas uma
recomendação de otimização.

## Teste contra o Supabase de verdade

Depois da correção, subi um Supabase **real** na sua máquina (o banco Postgres,
o PostgREST e o login de verdade, criados a partir do mesmo `schema.sql` do
projeto) e rodei o teste de dois aparelhos contra ele. Isso fecha a lacuna que
aparecia em todos os relatórios anteriores: até hoje o servidor era simulado.

**Nada disso encostou no seu diário real.** O banco era local e descartável, e
os usuários de teste foram apagados no fim. Sua conta de professor não foi
usada em momento nenhum.

O que ficou provado:

- A correção feita no tablet chega no computador e **o servidor termina com a
  versão corrigida**. Era exatamente aqui que ela era destruída antes.
- Rodando o mesmo teste contra a lógica antiga, ele **reprova**: conteúdo,
  número de aulas e chamada ficam todos no valor velho.
- A ordem das aulas fica idêntica nos dois aparelhos depois de ir e voltar do
  banco.
- A data de edição sobrevive à ida e volta pelo banco — é ela que decide quem
  vence, então precisava ser confirmada.
- Um professor não consegue ler o diário de outro, e a chave pública do
  aplicativo continua sem acesso nenhum às tabelas.

Achado técnico de brinde: o banco guarda as datas com precisão maior do que o
JavaScript sabe representar. O aplicativo hoje trata isso corretamente, mas era
por sorte — não havia nada garantindo. Agora há um teste que trava esse
comportamento, porque a versão errada faria o aplicativo reprocessar a mesma
alteração para sempre.

## O que não foi testado

O teste de integração exercita o miolo da correção (a regra de quem vence) pelo
transporte real, mas não a função de mesclagem inteira do aplicativo, que vive
dentro do arquivo principal e não pode ser carregada fora do navegador. Essa
parte segue coberta pelos testes de unidade e pela verificação no navegador.

Também não foi exercitado o **seu** banco de produção — de propósito, pelo
motivo explicado acima.

## Recomendação de uso

Nos próximos dias, ao passar de um aparelho para o outro, abra o aplicativo e
deixe a mensagem de sincronização terminar antes de começar a editar. Se
alguma correção sua ainda aparecer desatualizada no outro aparelho, refaça a
correção **no aparelho onde ela está errada** — a versão salva por último passa
a ser a que vale.

## Publicação online

Os commits desta sessão foram enviados para a branch `main`, ligada à
publicação automática da Vercel. Nos aparelhos, feche e abra o aplicativo
novamente; se a versão anterior ainda aparecer, recarregue a página duas vezes
para o service worker instalar os arquivos novos. Não use **"Limpar dados do
site"**, pois isso também apaga a cópia local do diário.
