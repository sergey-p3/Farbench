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

  const documentRef = environment.document ?? browserDocument();
  return copyTextWithCopyEvent(text, documentRef) || copyTextWithTemporaryTextarea(text, documentRef);
}

function browserClipboard(): ClipboardWriter | undefined {
  if (typeof navigator === "undefined") return undefined;
  return navigator.clipboard;
}

function browserDocument(): Document | undefined {
  if (typeof document === "undefined") return undefined;
  return document;
}

function copyTextWithCopyEvent(text: string, documentRef: Document | undefined): boolean {
  if (!documentRef?.addEventListener || !documentRef.removeEventListener || !documentRef.execCommand) return false;
  let copied = false;
  const handleCopy = (event: ClipboardEvent) => {
    event.clipboardData?.setData("text/plain", text);
    event.preventDefault();
    copied = true;
  };

  documentRef.addEventListener("copy", handleCopy);
  try {
    return documentRef.execCommand("copy") && copied;
  } finally {
    documentRef.removeEventListener("copy", handleCopy);
  }
}

function copyTextWithTemporaryTextarea(text: string, documentRef: Document | undefined): boolean {
  if (!documentRef?.body) return false;
  const textarea = documentRef.createElement("textarea") as Partial<HTMLTextAreaElement>;
  if (
    !textarea ||
    typeof textarea.focus !== "function" ||
    typeof textarea.select !== "function" ||
    typeof textarea.setAttribute !== "function" ||
    !textarea.style
  ) {
    return false;
  }
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  documentRef.body.appendChild(textarea as Node);
  textarea.focus();
  textarea.select();
  try {
    return documentRef.execCommand("copy");
  } finally {
    documentRef.body.removeChild(textarea as Node);
  }
}
