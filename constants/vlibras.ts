/**
 * Versão fixa do widget do VLibras.
 *
 * `https://vlibras.gov.br/app/...` redireciona para a versão mais nova do
 * jsDelivr, e o governo muda o funcionamento do widget entre versões (a 7.x
 * deixou de montar o player sozinho e quebrou a transcrição). Apontar direto
 * para a tag impede que o app mude de comportamento sem um novo build.
 *
 * Para atualizar: troque VLIBRAS_VERSION, teste a tela de transcrição e o
 * botão flutuante. O dicionário e a tradução continuam nos servidores do
 * VLibras (vlibras.gov.br) e não ficam congelados.
 */
export const VLIBRAS_VERSION = "7.12.2";
export const VLIBRAS_BASE = `https://cdn.jsdelivr.net/gh/spbgovbr-vlibras/vlibras-portal@v${VLIBRAS_VERSION}/app`;

/**
 * Caminho passado ao `new VLibras.Widget(...)`. NÃO pode ser o jsDelivr: o
 * avatar roda num iframe de `${path}/unity/index.html`, e o jsDelivr serve
 * arquivos .html como `text/plain` (com nosniff), então o iframe nunca monta o
 * Unity e o modal fica carregando para sempre. O vlibras.gov.br entrega esse
 * HTML como text/html e redireciona os demais arquivos (js, imagens) para o
 * próprio jsDelivr da versão atual.
 */
export const VLIBRAS_WIDGET_PATH = "https://vlibras.gov.br/app";
