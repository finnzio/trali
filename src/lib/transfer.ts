type TransferProvider = {
  id: string;
  name: string;
  type: string;
  endpoint: string;
  model: string;
};

type TransferStyle = {
  id: string;
  name: string;
  prompt: string;
};

type TransferLanguagePair = {
  id: string;
  source: string;
  target: string;
};

export type SettingsTransfer = {
  interfaceLanguage: string;
  theme: string;
  themeColor: string;
  radius: string;
  shortcut: string;
  closeBehavior: string;
  defaultTargetLanguage: string;
  providers: TransferProvider[];
  styles: TransferStyle[];
  languagePairs: TransferLanguagePair[];
};

function tomlString(value: string) {
  return JSON.stringify(value);
}

export function serializeSettings(settings: SettingsTransfer) {
  const lines = [
    "version = 1",
    `interface_language = ${tomlString(settings.interfaceLanguage)}`,
    `theme = ${tomlString(settings.theme)}`,
    `theme_color = ${tomlString(settings.themeColor)}`,
    `radius = ${tomlString(settings.radius)}`,
    `shortcut = ${tomlString(settings.shortcut)}`,
    `close_behavior = ${tomlString(settings.closeBehavior)}`,
    `default_target_language = ${tomlString(settings.defaultTargetLanguage)}`,
  ];

  for (const provider of settings.providers) {
    lines.push(
      "",
      "[[providers]]",
      `id = ${tomlString(provider.id)}`,
      `name = ${tomlString(provider.name)}`,
      `type = ${tomlString(provider.type)}`,
      `endpoint = ${tomlString(provider.endpoint)}`,
      `model = ${tomlString(provider.model)}`,
    );
  }

  for (const style of settings.styles) {
    lines.push(
      "",
      "[[styles]]",
      `id = ${tomlString(style.id)}`,
      `name = ${tomlString(style.name)}`,
      `prompt = ${tomlString(style.prompt)}`,
    );
  }

  for (const pair of settings.languagePairs) {
    lines.push(
      "",
      "[[language_pairs]]",
      `id = ${tomlString(pair.id)}`,
      `source = ${tomlString(pair.source)}`,
      `target = ${tomlString(pair.target)}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

export function parseSettings(text: string): SettingsTransfer {
  const result: SettingsTransfer = {
    interfaceLanguage: "zh-CN",
    theme: "auto",
    themeColor: "green",
    radius: "default",
    shortcut: "CommandOrControl+Shift+Space",
    closeBehavior: "tray",
    defaultTargetLanguage: "en",
    providers: [],
    styles: [],
    languagePairs: [],
  };
  let current: Record<string, string> | null = null;

  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line === "[[providers]]") {
      current = {};
      result.providers.push(current as TransferProvider);
      continue;
    }
    if (line === "[[styles]]") {
      current = {};
      result.styles.push(current as TransferStyle);
      continue;
    }
    if (line === "[[language_pairs]]") {
      current = {};
      result.languagePairs.push(current as TransferLanguagePair);
      continue;
    }
    const match = /^([a-z_]+)\s*=\s*(.+)$/u.exec(line);
    if (!match) continue;
    const [, key, encoded] = match;
    const value = encoded.startsWith('"') ? JSON.parse(encoded) : encoded;
    if (current) {
      current[key] = String(value);
    } else if (key === "interface_language") {
      result.interfaceLanguage = String(value);
    } else if (key === "theme") {
      result.theme = String(value);
    } else if (key === "theme_color") {
      result.themeColor = String(value);
    } else if (key === "radius") {
      result.radius = String(value);
    } else if (key === "shortcut") {
      result.shortcut = String(value);
    } else if (key === "close_behavior") {
      result.closeBehavior = String(value);
    } else if (key === "default_target_language") {
      result.defaultTargetLanguage = String(value);
    }
  }

  return result;
}

function csvCell(value: string) {
  return `"${value.split('"').join('""')}"`;
}

export function serializeGlossary(
  languages: string[],
  rows: Array<Record<string, string>>,
) {
  return [
    languages.map(csvCell).join(","),
    ...rows.map((row) =>
      languages.map((language) => csvCell(row[language] ?? "")).join(","),
    ),
  ].join("\r\n");
}

export function parseGlossary(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  row.push(cell);
  if (row.some(Boolean)) rows.push(row);

  return { languages: rows[0] ?? [], rows: rows.slice(1) };
}

export function downloadText(
  filename: string,
  content: string,
  type: string,
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
