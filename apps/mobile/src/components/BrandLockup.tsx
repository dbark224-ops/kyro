import { Image, StyleSheet, View } from "react-native";

export function BrandLockup() {
  return (
    <View style={styles.container}>
      <Image
        accessibilityIgnoresInvertColors
        resizeMode="contain"
        source={require("../../assets/kyro-icon.png")}
        style={styles.logo}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "flex-start",
  },
  logo: {
    height: 31,
    width: 31
  }
});
