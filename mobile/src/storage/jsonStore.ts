import * as FileSystem from "expo-file-system/legacy";

const BASE_DIR = `${FileSystem.documentDirectory ?? ""}guide-helper-mobile`;

function fileUri(fileName: string) {
  return `${BASE_DIR}/${fileName}`;
}

async function ensureBaseDirectory() {
  const info = await FileSystem.getInfoAsync(BASE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(BASE_DIR, { intermediates: true });
  }
}

export async function readJsonFile<T>(fileName: string): Promise<T | null> {
  const uri = fileUri(fileName);
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) {
    return null;
  }

  const content = await FileSystem.readAsStringAsync(uri);
  if (!content.trim()) {
    return null;
  }

  return JSON.parse(content) as T;
}

export async function writeJsonFile<T>(fileName: string, value: T): Promise<void> {
  await ensureBaseDirectory();
  await FileSystem.writeAsStringAsync(fileUri(fileName), JSON.stringify(value));
}

export async function deleteJsonFile(fileName: string): Promise<void> {
  const uri = fileUri(fileName);
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) {
    return;
  }

  await FileSystem.deleteAsync(uri, { idempotent: true });
}
