import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render } from "@testing-library/react-native";
import { AppThemeProvider } from "@/context/ThemeContext";
import "@/services/i18n";
import GesturePicker from "../GesturePicker";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("expo-haptics", () => ({ selectionAsync: jest.fn(() => Promise.resolve()) }));

const STATS = { A: 459, B: 470, C: 464, M: 75, E: 275 };

function renderPicker(props: Partial<React.ComponentProps<typeof GesturePicker>> = {}) {
  const onChange = jest.fn();
  const utils = render(
    <AppThemeProvider>
      <GesturePicker
        value="B"
        onChange={onChange}
        stats={STATS}
        loading={false}
        hasDataset
        unit="samples"
        datasetName="ALFABETO_HOLISTICO"
        {...props}
      />
    </AppThemeProvider>,
  );
  return { ...utils, onChange };
}

beforeEach(() => {
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
});

describe("GesturePicker", () => {
  it("mostra o gesto atual com a contagem dele", () => {
    const { getByText } = renderPicker();
    expect(getByText("B")).toBeTruthy();
    expect(getByText("470 amostras")).toBeTruthy();
  });

  it("as setas passam para o gesto vizinho em ordem alfabética", () => {
    const { getByLabelText, onChange } = renderPicker();
    fireEvent.press(getByLabelText("Próximo gesto"));
    expect(onChange).toHaveBeenLastCalledWith("C");
    fireEvent.press(getByLabelText("Gesto anterior"));
    expect(onChange).toHaveBeenLastCalledWith("A");
  });

  it("avisa quando o gesto escolhido tem poucas amostras", () => {
    const { getByText } = renderPicker({ value: "M" });
    expect(getByText("75 amostras · poucas amostras")).toBeTruthy();
  });

  it("a grade lista todos os gestos com contagem e escolhe ao tocar", () => {
    jest.useFakeTimers();
    const { getByText, getByLabelText, onChange } = renderPicker();
    fireEvent.press(getByLabelText(/^Gesto: B/));
    act(() => { jest.runAllTimers(); });

    expect(getByText("Escolher gesto")).toBeTruthy();
    expect(getByText("5 gestos em ALFABETO_HOLISTICO")).toBeTruthy();
    expect(getByLabelText("M, 75 amostras, poucas amostras")).toBeTruthy();
    expect(getByText(/Poucas amostras em relação/)).toBeTruthy();

    fireEvent.press(getByLabelText("E, 275 amostras"));
    expect(onChange).toHaveBeenLastCalledWith("E");
    jest.useRealTimers();
  });

  it("a busca oferece criar um gesto que ainda não existe", () => {
    jest.useFakeTimers();
    const { getByText, getByLabelText, getByPlaceholderText, onChange } = renderPicker();
    fireEvent.press(getByLabelText(/^Gesto: B/));
    act(() => { jest.runAllTimers(); });

    fireEvent.changeText(getByPlaceholderText("Buscar ou criar gesto"), " tudo bem ");
    fireEvent.press(getByText("Criar \"TUDO BEM\""));
    expect(onChange).toHaveBeenLastCalledWith("TUDO BEM");
    jest.useRealTimers();
  });

  it("travado (gravando), não troca de gesto", () => {
    const { getByLabelText, onChange } = renderPicker({ locked: true });
    fireEvent.press(getByLabelText("Próximo gesto"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("sem dataset, pede para escolher um primeiro", () => {
    const { getByText } = renderPicker({ hasDataset: false, stats: {}, value: "" });
    expect(getByText("Escolha um dataset primeiro")).toBeTruthy();
  });
});
