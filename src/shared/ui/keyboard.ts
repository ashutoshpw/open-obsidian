export type KeyboardCommandId = "command-palette" | "quick-switcher" | "save-note";

export type KeyboardShortcut = {
  command: KeyboardCommandId;
  key: string;
  label: string;
};

export type KeyboardInput = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
};

export const KEYBOARD_SHORTCUTS: readonly KeyboardShortcut[] = [
  {command: "command-palette", key: "k", label: "Meta/Ctrl-K"},
  {command: "quick-switcher", key: "p", label: "Meta/Ctrl-P"},
  {command: "quick-switcher", key: "o", label: "Meta/Ctrl-O"},
  {command: "save-note", key: "s", label: "Meta/Ctrl-S"},
];

export function resolveKeyboardCommand(input: KeyboardInput): KeyboardCommandId | undefined {
  if (!(input.metaKey || input.ctrlKey)) return undefined;
  const key = input.key.toLocaleLowerCase();
  return KEYBOARD_SHORTCUTS.find((shortcut) => shortcut.key === key)?.command;
}
