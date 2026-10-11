const React = require("react");
const RN = require("react-native");
const { bodyFamily, boldFamily, fontsReady, isBoldWeight } = require("./fonts");
const { colors, primary } = require("./colors");

function withFace(style) {
  if (!fontsReady()) return style;
  const flat = RN.StyleSheet.flatten(style) || {};
  if (flat.fontFamily) return style;
  const next = {
    fontFamily: isBoldWeight(flat.fontWeight) ? boldFamily : bodyFamily,
    fontWeight: "400",
  };
  if (flat.fontSize == null) next.fontSize = 15;
  return [style, next];
}

const Text = React.forwardRef(function LaypText(props, ref) {
  return React.createElement(RN.Text, { ...props, ref, style: withFace(props.style) });
});
Text.displayName = "Text";

const TextInput = React.forwardRef(function LaypTextInput(props, ref) {
  return React.createElement(RN.TextInput, {
    ...props,
    ref,
    cursorColor: props.cursorColor ?? colors.label,
    selectionColor: props.selectionColor ?? primary,
    style: withFace(props.style),
  });
});
TextInput.displayName = "TextInput";

module.exports = new Proxy(RN, {
  get(target, prop, receiver) {
    if (prop === "Text") return Text;
    if (prop === "TextInput") return TextInput;
    return Reflect.get(target, prop, receiver);
  },
});
