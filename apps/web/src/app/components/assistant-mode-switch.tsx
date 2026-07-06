import Link from "next/link";

import styles from "./assistant-mode-switch.module.css";

type AssistantMode = "assistant" | "voice";

type AssistantModeSwitchProps = {
  active: AssistantMode;
};

const modes: Array<{
  href: string;
  label: string;
  value: AssistantMode;
}> = [
  { href: "/assistant", label: "Assistant", value: "assistant" },
  { href: "/voice-vapi", label: "Voice assistant", value: "voice" },
];

export function AssistantModeSwitch({ active }: AssistantModeSwitchProps) {
  return (
    <nav className={styles.switcher} aria-label="Assistant mode">
      {modes.map((mode) => {
        const isActive = mode.value === active;

        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className={isActive ? styles.activeLink : styles.link}
            href={mode.href}
            key={mode.value}
          >
            {mode.label}
          </Link>
        );
      })}
    </nav>
  );
}
