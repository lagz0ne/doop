import type { Catalog } from '..'

export const settings: Catalog['settings'] = {
  sectionLabel: 'Configurações',
  backToCanvases: 'Voltar aos canvases',
  backToCanvas: 'Voltar ao canvas',
  canvases: 'Canvases',
  canvas: 'Canvas',

  generalTitle: 'Geral',
  generalBlurb: 'Deixe o Doop do jeito que você gosta neste navegador.',
  homeDashboardTitle: 'Painel inicial',
  homeDashboardDescription: 'Escolha o que aparece no seu painel inicial neste navegador.',
  showPromptBox: 'Mostrar a caixa de prompt',
  showPromptBoxHint: 'Comece um design a partir de um prompt no painel inicial.',
  agentTitle: 'Doop Agent',
  agentBlurb: 'Suas conexões, e a que o agente usa quando ninguém escolhe: comentários, @menções e automações.',
  fontsTitle: 'Fontes',
  fontsBlurb: 'Suas próprias fontes, para criar nos seus canvases pessoais.',
  keysTitle: 'Chaves de agente',
  keysBlurb: 'Credenciais bearer que deixam agentes sem interface desenharem em seu nome.',
  webhooksTitle: 'Webhooks',
  webhooksBlurb: 'Chamadas HTTP para os seus sistemas quando algo acontece em um canvas que você pode abrir.',
  accountTitle: 'Sua conta',
  accountTab: 'Conta',
  accountBlurb: 'Quem você é em cada canvas — e como voltar a entrar neste.',
  appearanceTitle: 'Aparência',
  appearanceBlurb:
    'Como o Doop aparece neste navegador: claro ou escuro e como o editor do canvas organiza seus painéis.',

  freeTasksLeftLabel: 'Tarefas gratuitas restantes do Doop Agent',
  meterGeminiCloud: 'Piloto do Gemini na nuvem selecionado — conexão gerenciada pelo seu operador.',
  meterNoFreeTasks: 'Este servidor não oferece tarefas gratuitas — conecte uma conta para usar o Doop Agent.',
  meterUsedUp: 'Suas tarefas gratuitas acabaram.',
  meterLeft: {
    one: '{left} de {count} tarefa gratuita restante.',
    other: '{left} de {count} tarefas gratuitas restantes.',
  },

  themeTitle: 'Tema',
  themeDescription:
    'Claro ou escuro, em todos os canvases e páginas deste navegador. Sistema segue o seu sistema operacional e muda sempre que ele mudar.',
  themeRow: 'Aparência',
  themeAria: 'Tema',
  themeSystem: 'Sistema',
  themeLight: 'Claro',
  themeDark: 'Escuro',
  themeFollowingSystem: 'Seguindo o sistema — {resolved} agora.',
  themeResolvedLight: 'claro',
  themeResolvedDark: 'escuro',
  themeSetByHand: 'Definido manualmente — a configuração do sistema é ignorada.',

  languageTitle: 'Idioma',
  languageDescription:
    'O idioma em que as telas do Doop aparecem neste navegador. Enquanto você não escolher um, vale o padrão configurado neste servidor.',
  languageRow: 'Idioma',
  languageAria: 'Idioma',
  languagePicked: 'Escolhido neste navegador.',
  languageServerDefault: 'Padrão do servidor — escolha um para mantê-lo neste navegador.',

  panelsTitle: 'Painéis do canvas',
  panelsDescription:
    'Como o editor do canvas organiza Camadas, o inspetor e Agentes neste navegador. Painéis flutuantes ficam sobre o canvas; painéis fixos encostam nas bordas da janela, com o canvas entre eles.',
  panelsRow: 'Layout',
  panelsAria: 'Painéis do canvas',
  panelsFloating: 'Flutuantes',
  panelsDocked: 'Fixos',
  panelsFloatingNote: 'Os painéis flutuam sobre o canvas.',
  panelsDockedNote: 'Os painéis estão fixos nas bordas.',

  rendererTitle: 'Renderizador do canvas',
  rendererDescription:
    'Como este navegador desenha um canvas. Auto deixa o teste de renderização medir o que é mais fluido aqui e mantê-lo; uma escolha o substitui. Lido quando um canvas abre pela primeira vez na página.',
  rendererGpuRow: 'Camada GPU',
  rendererGpuAria: 'Camada GPU',
  rendererZoomRow: 'Imagens no zoom',
  rendererZoomAria: 'Imagens no zoom',
  rendererLabelRow: 'Rótulo',
  rendererLabelNote: 'Mostra qual renderizador está desenhando, ao lado do controle de zoom.',
  rendererGpuNote:
    'Frames longe da vista desenhados em um canvas WebGL2. Ligado precisa de uma GPU de hardware; “Ligado, GL por software também” serve para medir sem uma.',
  rendererZoomNote: 'Os frames mostram a imagem salva enquanto o zoom se move e voltam ao vivo quando ele para.',
  rendererReloadNow: 'Recarregar agora',
}
