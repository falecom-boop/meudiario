# Relatório de trabalho — 29/07/2026

## O problema relatado
As aulas foram cadastradas três vezes ao longo do dia e nenhuma delas aparecia
depois, mesmo com o app avisando que tudo tinha sido salvo.

## O que estava acontecendo
O aviso de "salvo" estava **certo**. Suas aulas foram gravadas na nuvem nas
três vezes — o que quebrou foi a **leitura**, não o salvamento.

O app tem um componente que guarda uma cópia dos arquivos no aparelho, pra
funcionar sem internet e poder ser instalado como aplicativo. Esse componente
estava guardando cópia de coisa demais: além dos arquivos do site, ele passou a
guardar também as **respostas do servidor com o seu diário**. A partir da
primeira vez que você abriu o app, ele passou a devolver sempre aquela mesma
cópia congelada, ignorando tudo que foi salvo depois.

Ou seja: você salvava, o servidor recebia e guardava, mas ao reabrir o app o
aparelho mostrava a foto antiga. Por isso parecia que nada tinha sido salvo.

Esse componente entrou no ar no dia 20/07. Antes disso ele existia no projeto
mas nunca chegava a rodar de verdade (um erro de configuração que foi corrigido
naquele dia). A correção daquele erro foi, sem querer, o que colocou este
problema em funcionamento.

## O que foi corrigido
- **A cópia local agora só guarda arquivos do site** — nunca as respostas do
  servidor com o seu diário. Toda leitura de dados vai buscar a informação de
  verdade, sempre.
- **A página do app agora vem sempre da internet primeiro**, usando a cópia
  local só quando você está sem conexão. Antes, quem já tinha o app instalado
  ficava preso numa versão antiga: atualizações simplesmente não chegavam.
- **Segundo problema, encontrado na mesma investigação**: em uma situação
  específica (quando ainda não existe um backup completo salvo no servidor), o
  app descartava todas as edições pendentes e mostrava o diário vazio, mesmo
  com tudo gravado. Agora ele reconstrói o diário a partir dessas edições.

## Proteção pra não acontecer de novo
Foi criado um teste automático que carrega esse componente e reprova a
alteração se alguém voltar a deixá-lo interferir na leitura dos dados. Conferi
que o teste realmente pega o erro: rodado contra a versão com o problema, ele
falha; contra a versão corrigida, passa. Um teste que não reprova o erro que
deveria pegar não serve pra nada, então essa verificação era necessária.

## Validações realizadas
- `npm run build` sem erros.
- Os dois testes automáticos do projeto passando (o de sincronização, que já
  existia, e o novo).
- App aberto localmente sem nenhum erro no console.

## Como recuperar suas aulas
Depois que a atualização for publicada, abra o site e **recarregue a página
duas vezes**. A primeira instala a versão corrigida e apaga a cópia velha; a
segunda já carrega tudo atualizado. Suas aulas devem reaparecer.

Se ainda faltar alguma coisa, o app guarda um histórico de até 30 backups — dá
pra restaurar de lá.

⚠️ **Não use a opção "Limpar dados do site" do Chrome.** Ela apagaria também a
cópia local do seu diário guardada no navegador. Recarregar a página duas vezes
resolve sem risco nenhum.

## Estado atual
- Correção publicada. A versão online se atualiza sozinha a cada envio.
- Nenhuma alteração pendente de subir.

## Pontos para observar no uso real
- **Confirmar que suas aulas voltaram.** Essa é a verificação mais importante —
  vale conferir logo, com o histórico de backups à mão caso falte algo.
- Durante a investigação apareceram dois pontos menores que ainda podem causar
  perda de alteração em situações raras (questão de segundos, quando o app está
  juntando as alterações pequenas num backup completo). Não foram mexidos agora
  pra não misturar coisas com a correção urgente, mas estão anotados e podem
  ser tratados numa próxima sessão.
- O aplicativo Android (.apk) continua sem ser gerado de novo — só a versão web
  está atualizada.
