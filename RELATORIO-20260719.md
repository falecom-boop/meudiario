# Relatório de trabalho — 18–19/07/2026

## Login e segurança
- Login trocado de local (usuário/senha só no aparelho) para autenticação
  real, com e-mail e senha, cada professor com o próprio diário isolado.
- Recuperação de senha por e-mail de verdade (antes era uma senha mestra
  fixa no código).
- Exclusão de turma agora pede a senha do próprio professor para confirmar
  (antes era uma senha de administrador compartilhada).
- Corrigida uma vulnerabilidade de segurança conhecida numa biblioteca usada
  para importar planilhas Excel.
- PIN local no Android continua existindo, só para destravar o app mais
  rápido — quem garante a segurança de verdade é o login por e-mail/senha.

## Marca "Meu Diário"
- Nome, ícone (com fundo removido) e paleta de cores atualizados.
- Removida toda referência à marca antiga (CAp UFRJ).
- "Versão 2" passou a aparecer na tela.
- A interface não menciona mais o nome do serviço técnico usado por trás da
  sincronização — só fala em "sincronização automática em nuvem".

## Correção de um bug grave de perda de dado
- Identificado e corrigido o motivo de a tela "revisar arquivo" aparecer
  sempre ao reabrir o app, e de uma alteração real ter se perdido: o app
  não estava lendo corretamente o formato salvo localmente.

## Reescrita de como o app salva (a mudança mais importante)
- Antes: toda edição enviava o diário inteiro para a nuvem — arquivo grande
  demais pra garantir o envio se a aba fechasse rápido demais.
- Agora: cada edição salva só o que mudou (poucos KB), dentro do limite que
  o navegador garante entregar mesmo se a aba fechar na hora. Periodicamente
  essas alterações pequenas são juntadas num arquivo completo salvo na nuvem.
- Corrigido também um bug em que, em situações raras, uma edição podia gerar
  um registro de "remoção" incorreto junto com a alteração real.

## Indicador de salvamento e aviso ao sair
- Novo indicador sempre visível no topo do app: "Tudo salvo", "Salvando..."
  ou "Falha ao salvar" — para o professor saber, a qualquer momento, se pode
  sair com segurança.
- Se sair da tela com algo ainda pendente de enviar, o app tenta salvar
  assim que a tela volta a ficar visível, sem precisar clicar em nada.
- Corrigido um bug em que o aviso do navegador "Sair do site? As alterações
  podem não ser salvas" aparecia mesmo com tudo já salvo — o aviso agora
  reflete o estado real do indicador.

## Validações realizadas
- `npm run build` sem erros em todas as etapas.
- Testes ao vivo com contas de teste descartáveis: cadastro, login, criação
  de turma, fechar/reabrir aba, simulação de minimizar o app, e verificação
  direta no banco de dados de que nada duplicou ou se perdeu.
- Confirmado ao vivo em `https://meudiario-zeta.vercel.app` que cada entrega
  foi publicada (o Vercel atualiza sozinho a cada envio para o repositório).

## Estado atual
- Tudo publicado e funcionando na versão online.
- Nenhuma alteração pendente de subir.

## Pontos para observar no uso real
- Testar por alguns dias em uso normal (lançar notas, faltas, recuperação)
  para confirmar que o indicador de salvamento e a sincronização entre
  aparelhos (celular e computador) se comportam bem no dia a dia.
- O aplicativo Android (.apk) ainda não foi gerado de novo com essas
  mudanças — só a versão web está atualizada.
