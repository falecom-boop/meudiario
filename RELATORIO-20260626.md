# Relatório de trabalho — 26/06/2026

## Versão 1.2
- Gerado APK de teste da versão 1.2.
- Destino solicitado: `G:\Meu Drive\Diario versão 1.2`.

## Melhorias pedagógicas e visuais
- A listagem de alunos passou a exibir a média original do trimestre e, quando aplicável, a média após recuperação.
- O botão `Informações` do aluno ganhou compartilhamento/exportação visual.
- O relatório do aluno agora é gerado em PDF com a aparência da tela de informações, incluindo cartões, indicadores e dados trimestrais.
- No computador, o PDF abre o seletor `Salvar como`; no Android, abre o compartilhamento do sistema.

## Proteção e sincronização local
- Fortalecido o formato de backup:
  - validação da estrutura do arquivo;
  - hash SHA-256 de integridade;
  - bloqueio de arquivos alterados ou estruturalmente corrompidos;
  - proteção adicional para restaurações que reduziriam dados.
- Substituído o fluxo visual de `Backup/Sincronizar` por `Salvar`.
- Criada configuração local de pasta de sincronização:
  - cada dispositivo escolhe e guarda apenas seu próprio caminho/permissão;
  - essa configuração não entra no arquivo do diário;
  - o app cria a subpasta `Diario de Classe - Dados protegidos`;
  - ao abrir, carrega automaticamente o arquivo mais recente da pasta;
  - ao salvar, atualiza `diario-atual.json` e preserva quatro versões de segurança.
- Implementado acesso persistente à pasta no PC (Chrome/Edge) e no Android pelo seletor de pasta do sistema.
- Adicionada trava cooperativa de edição entre dispositivos:
  - enquanto um dispositivo usa a pasta, outro fica bloqueado;
  - a trava é renovada durante o uso e expira em até 20 minutos se o app fechar inesperadamente;
  - salvar exige que a trava pertença ao dispositivo atual.

## Comunicação com o professor
- Avisos do app agora podem ser fechados.
- Ao carregar a pasta sincronizada, o aviso informa data, hora e tipo do dispositivo do último salvamento.

## Validações realizadas
- `npm run build` concluído com sucesso.
- Sincronização dos arquivos web para Android concluída.
- `:app:assembleDebug` concluído com sucesso usando JDK 21.

## Pontos para teste em uso real
- Configurar a mesma pasta do Google Drive no tablet e no computador.
- Confirmar o carregamento automático do arquivo mais recente em ambos.
- Testar a trava abrindo a mesma pasta em dois dispositivos.
- Testar o PDF compartilhado/salvo com informações extensas de aluno.
