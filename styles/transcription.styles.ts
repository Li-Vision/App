import { StyleSheet } from "react-native";
import { AppColorTokens, AppRadius, AppSpacing } from "@/constants/theme";

export function makeTranscriptionStyles(colors: AppColorTokens, scheme: "light" | "dark" = "dark") {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundAlt },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: AppSpacing.xl,
    paddingTop: 12,
    paddingBottom: 12,
  },
  title: { color: colors.text.primary, fontSize: 22, fontWeight: "800" },
  inputArea: { paddingHorizontal: AppSpacing.xl },
  inputContainer: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: AppRadius.xl,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    overflow: "hidden",
  },
  input: {
    color: colors.text.primary,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: AppSpacing.sm,
    minHeight: 60,
    maxHeight: 100,
    textAlignVertical: "top",
  },
  inputFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  charCount: { color: colors.text.secondary, fontSize: 12 },
  translateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: AppSpacing.xl,
    paddingVertical: AppSpacing.sm,
    borderRadius: 10,
  },
  translateBtnDisabled: { backgroundColor: colors.surfaceAlt, opacity: 0.5 },
  // O botão fica sobre colors.primary sólido: escuro no light mode (ciano claro/saturado
  // precisa de texto escuro), branco no dark mode (ciano vibrante contrasta melhor com branco).
  translateBtnText: { color: scheme === "dark" ? "#ffffff" : "#081018", fontWeight: "700", fontSize: 14 },
  // O widget do VLibras tem altura PROPRIA (~373px, medido em runtime) e nao
  // se deixa reposicionar: ele vive num shadow DOM e ignorou ate' estilo inline
  // com !important. Em vez de disputar o CSS interno dele, o container passa a
  // ter a altura do widget — assim nao sobra faixa escura embaixo e o conjunto
  // fica centrado pelo proprio layout React (flex:1 no wrapper de fora).
  webviewWrapper: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: AppSpacing.xl,
    marginTop: 12,
  },
  webviewContainer: {
    // Dimensoes FIXAS de propósito. O widget do VLibras se dimensiona a partir
    // do tamanho do WebView (medido: altura do widget = WebView - 7px), entao
    // derivar estas medidas do tamanho do widget cria um loop de realimentacao
    // que encolhe a tela ate' sobrar so' a barra de controles.
    //
    // A largura do widget e' FIXA em 260px (medido em runtime, nao acompanha o
    // container). Com o WebView em 348px sobrava L80/R8 — margens desiguais que
    // jogavam o avatar para a direita. Casando a largura do container com a do
    // widget, ele fica centralizado pelo alignItems do wrapper.
    height: 420,
    width: 276, // 260 do widget + folga lateral para a borda arredondada
    borderRadius: AppRadius.xl,
    overflow: "hidden",
    backgroundColor: colors.backgroundAlt,
  },
  webview: { flex: 1, backgroundColor: colors.backgroundAlt },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
    backgroundColor: colors.backgroundAlt,
    // OPACO: mesma cor do container, entao o carregamento aparece como um painel
    // liso, sem o widget meio visivel por tras.
    //
    // Este overlay ja' foi translucido (opacity 0.9) como salvaguarda: se o
    // sinal de "pronto" falhasse, um overlay opaco esconderia um avatar que ja'
    // estava funcionando. Essa falha era real — o clique automatico era
    // disparado antes de o bundle do VLibras registrar os listeners — e foi
    // corrigida em index.tsx (a espera agora e' por window.plugin, nao pelo
    // botao estatico). O timeout de 60s do lado nativo continua como rede de
    // seguranca: ele libera a tela mesmo que nenhuma mensagem chegue do WebView.
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  loadingText: { color: colors.text.muted, fontSize: 14 },
  subtitleBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: AppSpacing.sm,
    backgroundColor: "rgba(16, 20, 26, 0.85)",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  // Texto fixo: a barra de legenda fica sempre sobre um fundo escuro semitransparente, independente do tema.
  subtitleText: { color: "#dfe2eb", fontSize: 13, flex: 1 },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: AppSpacing.sm,
    paddingHorizontal: AppSpacing.xl,
  },
  footerText: { color: colors.text.secondary, fontSize: 11 },
});
}

export const transcriptionStyles = makeTranscriptionStyles;
