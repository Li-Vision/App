/**
 * Tela de diagnóstico do canal de POSE.
 *
 * Existe para responder objetivamente, com números crus na tela, por que o
 * esqueleto do busto não corresponde ao corpo real — em vez de inferir a causa
 * a partir de prints.
 *
 * O que ela mostra, sem nenhum filtro entre o plugin e a tela:
 *
 *  1. Os valores normalizados de ombros/cotovelos/pulsos e do nariz, do jeito
 *     que o plugin nativo os devolve (após espelhamento, igual à cam).
 *  2. Se `visibility` chega preenchida ou ausente.
 *  3. O veredito de `isPosePlausible()` para o frame atual.
 *  4. Um overlay em duas versões desenhadas com os MESMOS dados:
 *       • CRU   — todos os 33 pontos, sem filtro algum;
 *       • BUSTO — só os ossos do tronco/braços, como na tela da câmera.
 *     Se o desenho "CRU" acompanha o corpo mas o "BUSTO" não, o problema está
 *     nos índices/conexões. Se nenhum dos dois acompanha, o problema está nos
 *     dados vindos do modelo.
 *  5. Dimensões da imagem de inferência vs. as da view, que é o que determina
 *     o mapeamento do crop "cover".
 */

import { useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions } from "react-native";
import { Camera, useCameraDevice, useFrameProcessor, useCameraPermission } from "react-native-vision-camera";
import { Worklets } from "react-native-worklets-core";
import { MaterialIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import {
  detectHandLandmarks,
  HolisticDetectionResult,
  PoseLandmarkIndex,
} from "@/services/handLandmarkerPlugin";
import { transformPoint, makeCoverMapper, isPosePlausible } from "@/services/holisticFeatures";

type P = { x: number; y: number; z: number; visibility?: number };

const WATCH: { idx: number; nome: string }[] = [
  { idx: PoseLandmarkIndex.NOSE, nome: "nariz" },
  { idx: PoseLandmarkIndex.LEFT_SHOULDER, nome: "ombro E" },
  { idx: PoseLandmarkIndex.RIGHT_SHOULDER, nome: "ombro D" },
  { idx: PoseLandmarkIndex.LEFT_ELBOW, nome: "cotov. E" },
  { idx: PoseLandmarkIndex.RIGHT_ELBOW, nome: "cotov. D" },
  { idx: PoseLandmarkIndex.LEFT_WRIST, nome: "pulso E" },
  { idx: PoseLandmarkIndex.RIGHT_WRIST, nome: "pulso D" },
];

const BUSTO: [number, number][] = [
  [PoseLandmarkIndex.LEFT_SHOULDER, PoseLandmarkIndex.RIGHT_SHOULDER],
  [PoseLandmarkIndex.LEFT_SHOULDER, PoseLandmarkIndex.LEFT_ELBOW],
  [PoseLandmarkIndex.LEFT_ELBOW, PoseLandmarkIndex.LEFT_WRIST],
  [PoseLandmarkIndex.RIGHT_SHOULDER, PoseLandmarkIndex.RIGHT_ELBOW],
  [PoseLandmarkIndex.RIGHT_ELBOW, PoseLandmarkIndex.RIGHT_WRIST],
];

const fmt = (n: number | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? n.toFixed(3) : "—";

export default function PoseDebugScreen() {
  const [pose, setPose] = useState<P[]>([]);
  const [poseErr, setPoseErr] = useState<string | null>(null);
  const [handsCount, setHandsCount] = useState(0);
  const [img, setImg] = useState<{ width: number; height: number } | null>(null);
  const [espelhar, setEspelhar] = useState(true);
  const [modo, setModo] = useState<"cru" | "busto">("cru");
  const [congelado, setCongelado] = useState(false);
  const congeladoRef = useRef(congelado);
  congeladoRef.current = congelado;

  const device = useCameraDevice("front");
  const { hasPermission, requestPermission } = useCameraPermission();
  if (!hasPermission) requestPermission();

  const { width: screenWidth } = Dimensions.get("window");
  const CAM_W = screenWidth - 24;
  const CAM_H = Math.round(CAM_W * 4 / 3);

  const cover = useMemo(() => makeCoverMapper(img, CAM_W, CAM_H), [img, CAM_W, CAM_H]);

  const onResult = Worklets.createRunOnJS((r: HolisticDetectionResult) => {
    if (congeladoRef.current) return;
    setHandsCount(r?.hands?.length ?? 0);
    setPoseErr((r as any)?.poseError ?? null);
    if (r?.imageWidth && r?.imageHeight) {
      setImg((prev) =>
        prev && prev.width === r.imageWidth && prev.height === r.imageHeight
          ? prev
          : { width: r.imageWidth!, height: r.imageHeight! },
      );
    }
    const raw = (r?.pose ?? []) as P[];
    // Espelhamento opcional: é exatamente o que a cam aplica. Poder desligar
    // aqui responde se o eixo X da pose está invertido em relação às mãos.
    setPose(espelhar ? (raw.map(transformPoint) as P[]) : raw);
  });

  const lastSync = Worklets.createSharedValue(0);
  const frameProcessor = useFrameProcessor((frame) => {
    "worklet";
    const now = performance.now();
    if (now - lastSync.value < 150) return;
    lastSync.value = now;
    try {
      const r = detectHandLandmarks(frame);
      if (r) onResult(r);
    } catch {}
  }, [lastSync]);

  const plausivel = isPosePlausible(pose);
  const temVisibility = pose.length > 0 && typeof pose[0]?.visibility === "number";

  const ls = pose[PoseLandmarkIndex.LEFT_SHOULDER];
  const rs = pose[PoseLandmarkIndex.RIGHT_SHOULDER];
  const larguraOmbros = ls && rs ? Math.abs(ls.x - rs.x) : undefined;

  return (
    <View style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={26} color="#00e5ff" />
        </TouchableOpacity>
        <Text style={s.title}>Diagnóstico de Pose</Text>
      </View>

      <View style={[s.cam, { width: CAM_W, height: CAM_H }]}>
        {device && hasPermission ? (
          <Camera
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={!congelado}
            pixelFormat="rgb"
            frameProcessor={frameProcessor}
          />
        ) : (
          <Text style={s.dim}>Sem câmera/permissão</Text>
        )}

        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {/* CRU: todos os 33 pontos, sem filtro */}
          {modo === "cru" && pose.map((p, i) => (
            <View
              key={`raw-${i}`}
              style={{
                position: "absolute",
                left: cover.toX(p.x) - 3,
                top: cover.toY(p.y) - 3,
                width: 6, height: 6, borderRadius: 3,
                backgroundColor: WATCH.some(w => w.idx === i) ? "#ff4081" : "rgba(0,229,255,0.85)",
              }}
            />
          ))}

          {/* BUSTO: os mesmos ossos da tela da câmera */}
          {modo === "busto" && BUSTO.map(([a, b], i) => {
            const pa = pose[a], pb = pose[b];
            if (!pa || !pb) return null;
            const ax = cover.toX(pa.x), ay = cover.toY(pa.y);
            const bx = cover.toX(pb.x), by = cover.toY(pb.y);
            const len = Math.hypot(bx - ax, by - ay);
            const ang = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
            return (
              <View
                key={`bone-${i}`}
                style={{
                  position: "absolute",
                  left: (ax + bx) / 2 - len / 2,
                  top: (ay + by) / 2 - 1.5,
                  width: len, height: 3, backgroundColor: "#4caf50",
                  transform: [{ rotate: `${ang}deg` }],
                }}
              />
            );
          })}
          {modo === "busto" && WATCH.map(({ idx }) => {
            const p = pose[idx];
            if (!p) return null;
            return (
              <View
                key={`pt-${idx}`}
                style={{
                  position: "absolute",
                  left: cover.toX(p.x) - 5, top: cover.toY(p.y) - 5,
                  width: 10, height: 10, borderRadius: 5,
                  backgroundColor: "#ff4081", borderWidth: 1.5, borderColor: "#fff",
                }}
              />
            );
          })}
        </View>
      </View>

      <View style={s.botoes}>
        <TouchableOpacity
          style={[s.btn, modo === "cru" && s.btnOn]}
          onPress={() => setModo(modo === "cru" ? "busto" : "cru")}
        >
          <Text style={[s.btnTxt, modo === "cru" && s.btnTxtOn]}>
            {modo === "cru" ? "33 pontos" : "só busto"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.btn, espelhar && s.btnOn]}
          onPress={() => setEspelhar(v => !v)}
        >
          <Text style={[s.btnTxt, espelhar && s.btnTxtOn]}>
            {espelhar ? "espelhado" : "sem espelho"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.btn, congelado && s.btnFreeze]}
          onPress={() => setCongelado(v => !v)}
        >
          <Text style={[s.btnTxt, congelado && s.btnTxtOn]}>
            {congelado ? "congelado" : "congelar"}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={s.painel} contentContainerStyle={{ paddingBottom: 28 }}>
        <View style={s.linha}>
          <Text style={s.rot}>imagem inferência</Text>
          <Text style={s.val}>{img ? `${img.width}×${img.height}` : "—"}</Text>
        </View>
        <View style={s.linha}>
          <Text style={s.rot}>view (overlay)</Text>
          <Text style={s.val}>{CAM_W}×{CAM_H}</Text>
        </View>
        <View style={s.linha}>
          <Text style={s.rot}>pontos de pose</Text>
          <Text style={[s.val, pose.length === 33 ? s.ok : s.bad]}>{pose.length}/33</Text>
        </View>
        <View style={s.linha}>
          <Text style={s.rot}>mãos detectadas</Text>
          <Text style={s.val}>{handsCount}</Text>
        </View>
        <View style={s.linha}>
          <Text style={s.rot}>visibility vem?</Text>
          <Text style={[s.val, temVisibility ? s.ok : s.warn]}>
            {temVisibility ? `sim (${fmt(pose[0]?.visibility)})` : "NÃO (ausente)"}
          </Text>
        </View>
        <View style={s.linha}>
          <Text style={s.rot}>largura ombros</Text>
          <Text style={s.val}>{fmt(larguraOmbros)}</Text>
        </View>
        <View style={s.linha}>
          <Text style={s.rot}>isPosePlausible</Text>
          <Text style={[s.val, plausivel ? s.ok : s.bad]}>{plausivel ? "SIM" : "NÃO"}</Text>
        </View>
        {poseErr && (
          <View style={s.linha}>
            <Text style={s.rot}>poseError</Text>
            <Text style={[s.val, s.bad]} numberOfLines={3}>{poseErr}</Text>
          </View>
        )}

        <Text style={s.sub}>Pontos-chave (normalizado 0–1)</Text>
        <View style={s.thead}>
          <Text style={[s.th, { flex: 1.4 }]}>ponto</Text>
          <Text style={s.th}>x</Text>
          <Text style={s.th}>y</Text>
          <Text style={s.th}>vis</Text>
        </View>
        {WATCH.map(({ idx, nome }) => {
          const p = pose[idx];
          const fora = p && (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1);
          return (
            <View key={idx} style={s.trow}>
              <Text style={[s.td, { flex: 1.4 }, s.tdNome]}>{nome}</Text>
              <Text style={[s.td, fora && s.bad]}>{fmt(p?.x)}</Text>
              <Text style={[s.td, fora && s.bad]}>{fmt(p?.y)}</Text>
              <Text style={s.td}>{fmt(p?.visibility)}</Text>
            </View>
          );
        })}

        <Text style={s.dica}>
          Fique de frente, com a cabeça e os ombros visíveis, e toque em “congelar”.
          {"\n\n"}
          • Se em “33 pontos” a nuvem acompanha o corpo, o modelo e o mapeamento estão certos.
          {"\n"}
          • Se a nuvem acompanha mas “só busto” não, o problema está nos índices/conexões.
          {"\n"}
          • Se nem a nuvem acompanha, o modelo está recebendo a imagem errada.
          {"\n"}
          • “ombro E” deve ficar à esquerda na tela e ter x menor que “ombro D”.
        </Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0d1117" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, paddingTop: 44 },
  title: { color: "#e6edf3", fontSize: 17, fontWeight: "700" },
  cam: { alignSelf: "center", borderRadius: 12, overflow: "hidden", backgroundColor: "#000" },
  dim: { color: "#8b949e", textAlign: "center", marginTop: 40 },
  botoes: { flexDirection: "row", gap: 8, justifyContent: "center", paddingVertical: 10 },
  btn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: "#30363d" },
  btnOn: { backgroundColor: "rgba(0,229,255,0.15)", borderColor: "#00e5ff" },
  btnFreeze: { backgroundColor: "rgba(255,64,129,0.18)", borderColor: "#ff4081" },
  btnTxt: { color: "#8b949e", fontSize: 12.5, fontWeight: "600" },
  btnTxtOn: { color: "#fff" },
  painel: { flex: 1, paddingHorizontal: 16 },
  linha: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: "#1c2128" },
  rot: { color: "#8b949e", fontSize: 13 },
  val: { color: "#e6edf3", fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"], maxWidth: "60%", textAlign: "right" },
  ok: { color: "#3fb950" },
  bad: { color: "#f85149" },
  warn: { color: "#d29922" },
  sub: { color: "#00e5ff", fontSize: 12, fontWeight: "700", marginTop: 18, marginBottom: 6, letterSpacing: 0.6 },
  thead: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#30363d", paddingBottom: 4 },
  th: { flex: 1, color: "#6e7681", fontSize: 11, fontWeight: "700" },
  trow: { flexDirection: "row", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: "#161b22" },
  td: { flex: 1, color: "#c9d1d9", fontSize: 12.5, fontVariant: ["tabular-nums"] },
  tdNome: { color: "#8b949e" },
  dica: { color: "#6e7681", fontSize: 12, lineHeight: 18, marginTop: 16 },
});
