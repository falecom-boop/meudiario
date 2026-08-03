# Relatório de trabalho — 02/08/2026

## Problema relatado

O diário preenchido no tablet no sábado (01/08) não apareceu igual ao ser
aberto no celular no dia seguinte, mesmo com o tablet indicando **“Tudo salvo”**
durante todo o preenchimento.

## Causa encontrada

O aviso de “salvo” estava correto: as alterações **foram** gravadas no
servidor. O problema era na leitura — parte do que foi gravado ficava
invisível para os outros aparelhos.

O aplicativo não envia o diário inteiro a cada edição. Cada alteração vira uma
“ação” pequena e, de tempos em tempos, todas são juntadas num arquivo
consolidado (a compactação, que roda a cada 20 edições ou 5 minutos).

Para saber quais ações ainda faltavam aplicar, a leitura usava a hora em que o
arquivo consolidado foi gravado. Só que essa hora é carimbada quando a gravação
**termina**, e o arquivo enviado foi montado **antes** do envio começar. Como o
diário passa de 500 KB, esse envio leva segundos — e tudo que fosse digitado
nesse intervalo ficava com hora anterior ao carimbo novo, sendo descartado por
todas as leituras seguintes.

Havia ainda um agravante no próprio aparelho: ao terminar, a compactação
reescrevia a tela com o estado capturado no início, apagando em silêncio o que
tinha sido digitado durante o envio.

## Correção realizada

- O arquivo consolidado passa a registrar **até qual ação** ele realmente
  absorveu, em vez de depender da hora de gravação. Nada mais é descartado por
  ter sido digitado durante um envio.
- A compactação agora mescla com o estado atual da tela, não com o de quando
  ela começou. Se houver digitação durante o envio, o que está na tela vence e
  a diferença é enviada logo em seguida.
- As ações já absorvidas passam a ser removidas da fila também quando a
  mesclagem grava na nuvem. Antes ficavam para trás e podiam ser reaplicadas
  por cima de valores mais novos.
- Quando já havia um envio em andamento, a alteração seguinte era descartada
  sem reagendamento. Agora é reagendada.
- O botão **Salvar** agora apenas salva. A pergunta sobre “usar um backup
  existente de pasta”, em que era o *Cancelar* que fazia o salvamento normal,
  foi removida. O envio de backup de pasta virou uma ação separada em
  Configurações, com aviso explícito de que **substitui** o diário.
- Novo botão **Exportar backup (.json)** em Configurações. A função de gravar o
  arquivo já existia no código, mas nenhum botão a chamava: dava para importar
  um backup e não para gerar um.

## Segurança dos dados

Nenhuma proteção foi removida. A mesclagem continua sem apagar turma, aluno,
aula ou nota, e a validação de estrutura continua bloqueando arquivos
inválidos. A mudança é na direção oposta: onde havia dúvida sobre uma ação já
ter sido aplicada, o aplicativo agora prefere aplicá-la de novo (o que reescreve
o item com o mesmo valor) a escondê-la.

## Validações realizadas

- `npm test`: aprovado (4 suítes — sync-safety, sync-engine, sync-e2e, sw-safety).
- Novo teste de linha do tempo (`sync-e2e`) reproduz o caso do dia 01/08 com
  dois aparelhos e um servidor simulado, usando o motor real do aplicativo.
- Verificado que os testes novos têm valor: rodados contra a lógica anterior,
  **reprovam** por asserção, mostrando a aula digitada durante o envio
  desaparecendo do segundo aparelho.
- Funções movidas para o novo módulo comparadas com as versões anteriores
  (obtidas do histórico do git): resultado idêntico em textos com acentuação,
  objetos aninhados e no diff completo.
- `npm run build`: concluído sem erros.
- Aplicativo verificado subindo sem erro de console nem do servidor de
  desenvolvimento.
- `git diff --check`: nenhuma inconsistência.

O aviso do Vite sobre um pacote maior que 500 kB continua sendo apenas uma
recomendação de otimização.

## O que não foi testado

Os caminhos que conversam com o Supabase de verdade não foram exercitados: isso
exigiria entrar na conta do professor. O que está coberto pelos testes é a
lógica que decide o que aparece e o que fica de fora — exatamente onde estava a
falha. O transporte em si (envio e busca) não foi alterado nesta sessão.

## Recomendação de uso

Ao clicar em **Salvar**, evite digitar enquanto a mensagem “Salvando...”
estiver visível. O aplicativo agora preserva o que for digitado nesse intervalo,
mas esperar continua sendo o caminho mais previsível.

## Publicação online

Os commits desta sessão foram enviados para a branch `main`, ligada à
publicação automática da Vercel. Nos aparelhos, feche e abra o aplicativo
novamente; se a versão anterior ainda aparecer, recarregue a página duas vezes
para o service worker instalar os arquivos novos. Não use **“Limpar dados do
site”**, pois isso também apaga a cópia local do diário.
