import type { ClipboardEvent } from "react";
import type { RcFile, UploadFile } from "antd/es/upload/interface";
import { ClipboardPaste } from "lucide-react";

let clipboardFileSequence = 0;

/** 提供仅处理图片的剪切板粘贴入口。 */
export function ClipboardImagePaste({
  label,
  onPasteImages
}: {
  label: string;
  onPasteImages: (files: UploadFile[]) => void;
}) {
  return (
    <div
      aria-label={label}
      className="clipboard-image-paste"
      role="group"
      tabIndex={0}
      onClick={(event) => event.currentTarget.focus()}
      onPaste={(event) => {
        const files = clipboardImageFiles(event);
        if (files.length === 0) return;
        event.preventDefault();
        onPasteImages(files);
      }}
    >
      <ClipboardPaste aria-hidden="true" size={16} />
      <span>点击此处后按 ⌘/Ctrl + V 粘贴图片</span>
    </div>
  );
}

/** 将剪切板中的图片文件转换为 Ant Upload 可复用的文件对象。 */
function clipboardImageFiles(event: ClipboardEvent<HTMLElement>): UploadFile[] {
  return Array.from(event.clipboardData.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
    .map((file) => {
      const uid = `clipboard-${Date.now()}-${clipboardFileSequence += 1}`;
      const originFileObj = Object.assign(file, { uid }) as RcFile;
      return {
        uid,
        name: file.name || `clipboard-image-${clipboardFileSequence}`,
        type: file.type,
        size: file.size,
        originFileObj
      };
    });
}
