interface ClipboardWriter {
  writeText(text: string): Promise<void>;
}

interface CopyEnvironment {
  clipboard?: ClipboardWriter;
  document?: Document;
}

export async function copyTextToClipboard(text: string, environment: CopyEnvironment = {}): Promise<boolean> {
  const clipboard = environment.clipboard ?? browserClipboard();
  if (clipboard) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the textarea fallback for restricted clipboard contexts.
    }
  }

  return copyTextWithTemporaryTextarea(text, environment.document ?? browserDocument());
}

function browserClipboard(): ClipboardWriter | undefined {
  if (typeof navigator === "undefined") return undefined;
  return navigator.clipboard;
}

function browserDocument(): Document | undefined {
  if (typeof document === "undefined") return undefined;
  return document;
}

function copyTextWithTemporaryTextarea(text: string, documentRef: Document | undefined): boolean {
  if (!documentRef?.body) return false;
  const textarea = documentRef.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  documentRef.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    return documentRef.execCommand("copy");
  } finally {
    documentRef.body.removeChild(textarea);
  }
}
