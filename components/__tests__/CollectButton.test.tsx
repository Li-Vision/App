import AsyncStorage from "@react-native-async-storage/async-storage";
import { ActivityIndicator } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";
import { AppThemeProvider } from "@/context/ThemeContext";
import CollectButton from "../CollectButton";

function renderButton(props: Partial<React.ComponentProps<typeof CollectButton>> = {}) {
  const onPress = jest.fn();
  const utils = render(
    <AppThemeProvider>
      <CollectButton
        icon="camera"
        label="Capturar"
        busy={false}
        busyLabel="Salvando..."
        onPress={onPress}
        {...props}
      />
    </AppThemeProvider>,
  );
  return { ...utils, onPress };
}

// O provider de tema lê a preferência salva; o mock do projeto não devolve Promise.
beforeEach(() => {
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
});

describe("CollectButton", () => {
  it("pronto: mostra o texto normal e aceita toque", () => {
    const { getByText, onPress } = renderButton();
    fireEvent.press(getByText("Capturar"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("ocupado: troca o texto, mostra o spinner e NÃO aceita toque", () => {
    const { getByText, queryByText, getByRole, onPress, UNSAFE_getByType } = renderButton({ busy: true });

    expect(getByText("Salvando...")).toBeTruthy();
    expect(queryByText("Capturar")).toBeNull();
    expect(getByRole("button").props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();

    fireEvent.press(getByRole("button"));
    expect(onPress).not.toHaveBeenCalled();
  });
});
