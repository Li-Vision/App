import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Text,
  DeviceEventEmitter,
  Dimensions,
  Animated,
  PanResponder,
} from "react-native";
import { WebView } from "react-native-webview";
import { MaterialIcons } from "@expo/vector-icons";
import { usePathname } from "expo-router";
import { useAppTheme } from "@/context/ThemeContext";
import { AppColorTokens } from "@/constants/theme";
import { report } from "@/services/errorReporter";

const { width: screenWidth, height: screenHeight } = Dimensions.get("window");

// Dimensoes da janela flutuante do VLibras.
//
// Duas regras do widget, ambas medidas em runtime:
//  1. Tem LARGURA MINIMA de 260 CSS px. Num viewport menor ele nao encolhe —
//     transborda (viewport 195 => widget de 260 comecando em x=-73).
//  2. A ALTURA acompanha a do WebView quase por inteiro (desconto de ~6px).
//
// A propriedade CSS `zoom` NAO serve para encolhe-lo: o WebView do Android a
// ignora (getComputedStyle devolvia zoom=1 mesmo com a regra declarada).
// Por isso o WebView recebe a largura inteira que o widget exige e a reducao
// visual e' feita com transform:scale no React Native (ver styles.webview).
const WEBVIEW_W = 276; // 260 do widget + 16 de folga (ele nasce em x=8)
const WEBVIEW_H = 262; // *0.75 = ~196 de altura util na janela
// Ajuste a ALTURA por WEBVIEW_H e a largura por WEBVIEW_W. Mexer em SCALE muda
// os dois eixos de uma vez.
const SCALE = 0.75;
const BORDER = 1;
const HEADER_H = 35; // barra "Acessibilidade" — medido via onLayout (34.67)
// A janela e' exatamente cabecalho + WebView escalado.
//
// A faixa escura que aparecia sob os controles vinha do WebView herdar a altura
// do container: com 197 disponiveis ele desenhava 197*0.75 = 148, sobrando 49.
// Por isso styles.webview usa position:absolute — assim mantem WEBVIEW_H
// integral, desenha WEBVIEW_H*SCALE e preenche o container por completo.
const WINDOW_W = Math.round(WEBVIEW_W * SCALE) + BORDER * 2;
const WINDOW_H = Math.round(WEBVIEW_H * SCALE) + HEADER_H + BORDER * 2;

const makeVlibrasHtml = (colors: AppColorTokens) => `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    /* NAO use a propriedade zoom aqui: o WebView do Android a ignora (medido
       em runtime, getComputedStyle devolvia zoom=1 mesmo com a regra
       declarada), e o viewport continuava valendo a largura nativa do WebView.
       O encolhimento e' feito com transform:scale no React Native
       (ver styles.webview). */
    html, body {
      width: 100%;
      height: 100%;
      background: ${colors.surface};
      overflow: hidden;
    }
    #status {
      color: ${colors.text.secondary}; font-family: sans-serif; text-align: center;
      position: absolute; width: 100%; top: 40%; z-index: 9999;
    }
    
    /* NAO adianta estilizar [vw] / .vpw-* : o widget desta versao vive num
       shadow DOM (div#vlibras-app-root) e ignora CSS externo — medido em
       runtime, nem estilo inline com !important o move. O tamanho e' resolvido
       pelas constantes WEBVIEW_W/WEBVIEW_H e pelo scale em styles.webview. */
  </style>
</head>
<body>
  <p id="status">...</p>
  <div vw class="enabled">
    <div vw-access-button class="active"></div>
    <div vw-plugin-wrapper>
      <div class="vw-plugin-top-wrapper"></div>
    </div>
  </div>

  <script src="https://vlibras.gov.br/app/vlibras-plugin.js"></script>
  <script>
    // Suprime alertas e o overlay de erro que poluem a tela, mas REPASSA a
    // mensagem para o app: silenciar console.error por completo escondia
    // falhas de carregamento do plugin, e o sintoma virava um indicador de
    // carregamento eterno sem nenhuma pista do motivo.
    (function() {
      window.alert = function() {};
      function report(kind, args) {
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'log', level: kind,
            message: Array.prototype.map.call(args, String).join(' '),
          }));
        } catch (e) {}
      }
      window.onerror = function(msg, src, line) {
        report('error', [msg + ' @' + src + ':' + line]);
        return true;
      };
      console.error = function() { report('error', arguments); };
      console.warn = function() { report('warn', arguments); };
    })();

    // Ponto único de falha: avisa o app E mostra o motivo na própria janela,
    // para o usuário nunca ficar diante de um carregamento sem explicação.
    function fail(reason) {
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'log', level: 'error', message: reason,
        }));
      } catch (e) {}
      var el = document.getElementById('status');
      if (el) {
        el.style.display = 'block';
        el.textContent = 'VLibras indisponivel';
      }
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'failed' }));
      } catch (e) {}
    }

    if (!window.VLibras) {
      // Sem o plugin não há o que inicializar; seguir daqui só produziria um
      // TypeError que mascararia a causa real (o script não carregou).
      fail('plugin do VLibras nao carregou — script bloqueado ou servico indisponivel');
    } else {
      // SEM declaracao var: o bundle do VLibras ja declara a variavel widget no escopo global e
      // uma segunda declaração dispara um erro de identificador ja declarado -
      // SyntaxError que aborta ESTE script inteiro antes de
      // qualquer linha rodar, deixando o widget sem inicialização e sem erro
      // visível (nem os timeouts abaixo chegavam a ser armados).
      window.__liVisionWidget = new window.VLibras.Widget('https://vlibras.gov.br/app');
    }

    // Marca cada etapa do carregamento. Sem isso, uma etapa que não acontece é
    // indistinguível de uma que acontece e falha em silêncio — foi o que fez o
    // diagnóstico girar em falso: o widget carregava, mas nada dizia até onde.
    function step(name) {
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'log', level: 'warn', message: 'etapa: ' + name,
        }));
      } catch (e) {}
    }

    function openPlayer() {
      var accessBtn = document.querySelector('[vw-access-button]');
      var wrapper = document.querySelector('[vw-plugin-wrapper]');
      var vwEl = document.querySelector('[vw]');

      // Retornar aqui sem avisar deixava o fluxo morto: nenhum timeout era
      // armado, então nem 'ready' nem 'failed' jamais chegariam.
      if (!accessBtn || !wrapper) {
        fail('estrutura do widget ausente (accessBtn=' + !!accessBtn + ', wrapper=' + !!wrapper + ')');
        return;
      }
      step('openPlayer');

      accessBtn.classList.add('active');
      wrapper.classList.add('active');
      if (vwEl) vwEl.classList.add('active');
      accessBtn.style.setProperty('display', 'none', 'important');
      
      // O avatar NAO vira um <canvas> nem um <iframe> nesta versao: medido em
      // runtime (tela de transcricao), o [vw-plugin-wrapper] fica
      // permanentemente vazio e nenhum canvas/iframe nasce. Esperar por um
      // elemento no DOM nunca terminava — o widget so' "aparecia" quando o
      // timeout de 60s do lado nativo derrubava o overlay.
      //
      // Quem conhece o estado real e' o proprio player: plugin.player expoe
      // isLoaded/isMounted/isBroken (medido: isLoaded=true, isMounted=true,
      // status='playing', avatar='icaro' em ~7s).
      var tries = 0;
      var waitPlayer = setInterval(function() {
        var player = (window.plugin && window.plugin.player) || null;

        if (player && player.isBroken) {
          clearInterval(waitPlayer);
          fail('o player do VLibras reportou falha (isBroken) — assets podem estar bloqueados');
          return;
        }

        if (player && player.isLoaded && player.isMounted) {
          clearInterval(waitPlayer);
          step('avatar pronto (player.isLoaded)');
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
        } else if (++tries > 150) { // ~45s
          clearInterval(waitPlayer);
          fail('o player do VLibras nao ficou pronto em 45s :: plugin=' +
            (window.plugin ? Object.keys(window.plugin).join('|') : 'ausente'));
        }
      }, 300);
    }

    var readyTries = 0;
    var checkReady = setInterval(function() {
      var accessBtn = document.querySelector('[vw-access-button]');
      // Ver o comentario extenso na tela de transcricao: o accessBtn e' HTML
      // ESTATICO desta pagina, entao existe desde a primeira iteracao — muito
      // antes de o bundle do VLibras registrar os listeners de clique. Disparar
      // os eventos so' com base nele os perde em silencio, e o player so' abre
      // com um toque manual. window.plugin e' criado pelo bundle e marca o
      // instante em que o widget passa a responder.
      var pluginPronto = !!window.plugin;

      if (accessBtn && pluginPronto) {
        clearInterval(checkReady);
        document.getElementById('status').style.display = 'none';
        // Alguns builds do widget só reagem a um evento de ponteiro completo;
        // o .click() sozinho deixava o player fechado, exigindo toque manual.
        try {
          ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach(function(type) {
            accessBtn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
          });
        } catch (e) {
          accessBtn.click();
        }
        setTimeout(openPlayer, 300);
      } else if (++readyTries > 150) { // ~45s
        clearInterval(checkReady);
        fail('widget do VLibras nao inicializou em 45s (accessBtn=' + !!accessBtn + ', plugin=' + pluginPronto + ')');
      }
    }, 300);

    function translateText(text) {
      try {
        // plugin.player.translate EXISTE nesta versao — medido em runtime, o
        // player expoe translate/play/stop/setSpeed. O fallback por selecao de
        // texto que existia aqui partia da premissa oposta (de que Player teria
        // saido da API publica) e nunca chegava a executar.
        // O metodo de traducao fica em window.plugin.translate, NAO em
        // plugin.player.translate. Medido em runtime: as funcoes do player sao
        // play/playStatic/send/stop/... e nenhuma delas e' translate; a unica
        // funcao do plugin e' justamente translate. (A chave 'translate' que
        // aparece listada no player e' propriedade de dados, nao metodo — foi
        // o que induziu ao caminho errado antes.)
        var p = window.plugin || {};
        if (typeof p.translate !== 'function') {
          fail('player do VLibras indisponivel para traducao');
          return;
        }
        p.translate(text);
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'translating' }));
      } catch (e) {
        fail('erro ao traduzir: ' + (e && e.message ? e.message : e));
      }
    }
  </script>
</body>
</html>
`;

export const VLibrasController = {
  translate: (text: string) => {
    if (!text) return;
    DeviceEventEmitter.emit("VLIBRAS_TRANSLATE", text);
  },
  show: () => {
    DeviceEventEmitter.emit("VLIBRAS_SHOW");
  },
  // Oculta/reexibe o botão flutuante — usado quando um modal abre por cima,
  // pois o botão (bottom/right, zIndex alto) capturava toques do modal.
  setButtonHidden: (hidden: boolean) => {
    DeviceEventEmitter.emit("VLIBRAS_HIDE_BUTTON", hidden);
  },
};

export default function GlobalVLibras() {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => makeVLibrasStyles(colors), [colors]);
  const vlibrasHtml = React.useMemo(() => makeVlibrasHtml(colors), [colors]);
  const [visible, setVisible] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [buttonHidden, setButtonHidden] = useState(false);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const webViewRef = useRef<WebView>(null);
  const pathname = usePathname();
  
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Posição da janela (deslocamento a partir do canto inferior direito).
  // pan.x negativo move para a esquerda; pan.y negativo move para cima.
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  // Guarda o deslocamento acumulado entre gestos de arraste.
  const panOffset = useRef({ x: 0, y: 0 });

  // Limites de movimento para manter a janela dentro da tela.
  const BASE_RIGHT = 20;
  const BASE_BOTTOM = 100;
  const minX = -(screenWidth - WINDOW_W - BASE_RIGHT); // até a borda esquerda
  const maxX = BASE_RIGHT; // até a borda direita
  const minY = -(screenHeight - WINDOW_H - BASE_BOTTOM); // até o topo
  const maxY = BASE_BOTTOM; // até a borda inferior

  const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), max);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) =>
        Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3,
      onPanResponderGrant: () => {
        pan.setOffset({ x: panOffset.current.x, y: panOffset.current.y });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: (_evt, gesture) => {
        const nextX = clamp(panOffset.current.x + gesture.dx, minX, maxX);
        const nextY = clamp(panOffset.current.y + gesture.dy, minY, maxY);
        pan.setValue({ x: nextX - panOffset.current.x, y: nextY - panOffset.current.y });
      },
      onPanResponderRelease: (_evt, gesture) => {
        panOffset.current = {
          x: clamp(panOffset.current.x + gesture.dx, minX, maxX),
          y: clamp(panOffset.current.y + gesture.dy, minY, maxY),
        };
        pan.flattenOffset();
      },
    })
  ).current;

  // Hides button on transcription to avoid redundancy
  const isTranscriptionScreen = pathname === "/transcription" || pathname === "/(tabs)/transcription";

  // Declarado antes de handleTranslate: este o chama para abrir a janela
  // quando um texto e' tocado com o widget fechado.
  const showWidget = useCallback(() => {
    setVisible(true);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  const handleTranslate = useCallback((text: string) => {
    // A janela NUNCA abre sozinha a partir de um gesto em texto: quem a abre e'
    // o botao flutuante. Abrir aqui fazia o painel "Acessibilidade" subir por
    // cima da tela a cada toque num texto qualquer.
    if (!visible) return;

    if (isReady && webViewRef.current) {
      const escaped = text.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, " ");
      webViewRef.current.injectJavaScript(`translateText('${escaped}'); true;`);
    } else {
      setPendingText(text);
    }
  }, [visible, isReady]);

  const hideWidget = () => {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setVisible(false));
  };

  useEffect(() => {
    const subTranslate = DeviceEventEmitter.addListener("VLIBRAS_TRANSLATE", handleTranslate);
    const subShow = DeviceEventEmitter.addListener("VLIBRAS_SHOW", showWidget);
    const subHide = DeviceEventEmitter.addListener("VLIBRAS_HIDE_BUTTON", (hidden: boolean) =>
      setButtonHidden(hidden)
    );
    return () => {
      subTranslate.remove();
      subShow.remove();
      subHide.remove();
    };
  }, [handleTranslate]);

  useEffect(() => {
    if (visible && isReady && pendingText && webViewRef.current) {
      const escaped = pendingText.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, " ");
      webViewRef.current.injectJavaScript(`translateText('${escaped}'); true;`);
      setPendingText(null);
    }
  }, [visible, isReady, pendingText]);

  // Rede de segurança do lado nativo: se nem o <script> do VLibras baixar,
  // NENHUM código de dentro do WebView roda — nem os timeouts dele. Este
  // temporizador é o único que sobrevive a esse caso.
  useEffect(() => {
    if (!visible || isReady) return;
    const timer = setTimeout(() => {
      setIsReady(true);
      report("VLibras", "nao respondeu em 60s — verifique a conexao ou tente novamente", {
        detail: "Nenhuma mensagem recebida do WebView; o script do plugin provavelmente nao carregou.",
      });
    }, 60000);
    return () => clearTimeout(timer);
  }, [visible, isReady]);

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === "ready") setIsReady(true);
      // Desiste: para o indicador de carregamento. Sem isto o spinner giraria
      // indefinidamente mesmo depois de o WebView já saber que falhou.
      else if (data.type === "failed") setIsReady(true);
      // Erros de dentro do WebView chegam aqui — sem isto, uma falha do plugin
      // fica invisível e o widget apenas nunca sai do carregamento.
      else if (data.type === "log") {
        // Rastreamento de etapa é DIAGNÓSTICO, não erro: vai só para o console.
        // Mandá-lo ao modal enchia a lista com dezenas de entradas por
        // abertura (o poll emite uma por segundo) e reabria o modal sem parar.
        if (String(data.message).startsWith("etapa:")) {
          console.log("[VLibras]", data.message);
        } else {
          report("VLibras", data.message, {
            severity: data.level === "warn" ? "warning" : "error",
          });
        }
      }
    } catch (e) {}
  };

  if (!visible) {
    if (isTranscriptionScreen || buttonHidden) return null;
    return (
      <View style={styles.container} pointerEvents="box-none">
        <TouchableOpacity style={styles.floatingBtn} onPress={showWidget} activeOpacity={0.8}>
          {/* Ícone escuro fixo por design: o fundo do botão é sempre ciano nos dois temas */}
          <MaterialIcons name="sign-language" size={28} color="#081018" />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container} pointerEvents="box-none">
      {visible && (
        <Animated.View
          style={[
            styles.window,
            {
              opacity: fadeAnim,
              transform: [{ translateX: pan.x }, { translateY: pan.y }],
            },
          ]}
        >
          <View style={styles.windowHeader} {...panResponder.panHandlers}>
            <MaterialIcons name="drag-indicator" size={16} color={colors.text.secondary} />
            <MaterialIcons name="accessibility" size={14} color={colors.primary} />
            <Text style={styles.windowTitle}>Acessibilidade</Text>
            <TouchableOpacity onPress={hideWidget} style={styles.closeBtn}>
              <MaterialIcons name="close" size={18} color={colors.text.primary} />
            </TouchableOpacity>
          </View>

          <View style={styles.webviewContainer}>
            <WebView
              ref={webViewRef}
              // `baseUrl` dá à página uma ORIGEM real. Sem ele o HTML inline
              // roda em about:blank (origem nula), e o WebView bloqueia o
              // <script src="https://vlibras.gov.br/..."> como conteúdo
              // cross-origin — o plugin nunca carrega e o widget fica preso no
              // indicador de carregamento. Apontar para o próprio domínio do
              // VLibras torna a requisição same-origin.
              source={{ html: vlibrasHtml, baseUrl: "https://vlibras.gov.br" }}
              originWhitelist={["https://*", "http://*", "about:*"]}
              style={styles.webview}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              // O plugin do VLibras baixa assets (modelo 3D, dicionário) de
              // origens do próprio serviço; sem isto o Android bloqueia parte
              // deles quando a página base é https.
              mixedContentMode="always"
              onMessage={handleMessage}
              onError={(e) => console.warn("[VLibras] erro no WebView:", e.nativeEvent?.description)}
              onHttpError={(e) => console.warn("[VLibras] HTTP", e.nativeEvent?.statusCode, e.nativeEvent?.url)}
              // Marcos do ciclo de vida do WebView, do lado nativo: dizem se o
              // HTML chegou a ser carregado, independentemente de o JS de
              // dentro dele conseguir ou não postar mensagens.
              onLoadStart={() => console.log("[VLibras] WebView onLoadStart")}
              onLoadEnd={() => console.log("[VLibras] WebView onLoadEnd")}
              scrollEnabled={false}
            />
            {!isReady && (
              // pointerEvents="none": o overlay é só um indicador visual. Sem
              // isto ele interceptava os toques destinados ao widget — e como
              // é opaco, também escondia um avatar que já havia carregado,
              // fazendo parecer que o VLibras só aparecia após o timeout.
              <View style={styles.loadingOverlay} pointerEvents="none">
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            )}
          </View>
        </Animated.View>
      )}
    </View>
  );
}

function makeVLibrasStyles(colors: AppColorTokens) {
  return StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
  },
  floatingBtn: {
    position: "absolute",
    bottom: 100,
    right: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.primary,
    justifyContent: "center",
    alignItems: "center",
    elevation: 8,
    zIndex: 9999,
  },
  window: {
    position: "absolute",
    bottom: 100,
    right: 20,
    // O widget do VLibras tem tamanho PROPRIO e fixo (260x373, medido em
    // runtime) e nao se adapta ao container. Com os 220x300 anteriores ele
    // ficava espremido: sobrava faixa escura de um lado e estourava a borda
    // arredondada do outro. Estas medidas o acomodam por inteiro.
    width: WINDOW_W,
    height: WINDOW_H,
    backgroundColor: colors.surface,
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.primary,
    elevation: 10,
  },
  windowHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.surfaceAlt,
    gap: 6,
  },
  windowTitle: {
    color: colors.text.primary,
    fontSize: 10,
    fontWeight: "bold",
    flex: 1,
  },
  closeBtn: {
    padding: 2,
  },
  webviewContainer: {
    // Altura do conteudo REALMENTE DESENHADO (WEBVIEW_H * SCALE).
    height: Math.round(WEBVIEW_H * SCALE),
    overflow: "hidden",
  },
  webview: {
    // position:absolute e' essencial: sem ele o WebView herda a altura do
    // container (medido: recebia 197 em vez de 262) e, ao ser escalado, desenha
    // menos ainda — 148 num container de 197, deixando 49px de faixa escura.
    // Absoluto, ele mantem WEBVIEW_H integral e o excedente e' cortado pelo
    // overflow do container.
    position: "absolute",
    top: 0,
    left: 0,
    width: WEBVIEW_W,
    height: WEBVIEW_H,
    transform: [{ scale: SCALE }],
    // Ancorar no canto evita as margens negativas que a origem padrao (centro)
    // exigiria — qualquer erro naquela conta reaparecia como faixa vazia.
    transformOrigin: "top left",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surface,
    // OPACO: mesma cor da janela, entao o carregamento nao deixa o widget
    // aparecer por tras. Ver o comentario em transcription.styles.ts — a falha
    // do sinal de "pronto" que motivava o translucido foi corrigida, e o
    // timeout de 60s segue como rede de seguranca.
    justifyContent: "center",
    alignItems: "center",
  },
  });
}
